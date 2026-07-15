# M4-C4 Trusted Plugin Platform 상세 사양

> 상태: 완료 — TypeScript·PostgreSQL·HTTP·Admin Chromium Gate 통과 (2026-07-15)
> 상위 계획: [M4-C 구현 계획](./m4c-administration-productization-plan.md)
> 선행 조건: [M4-C3 Unified Audit & Retention](./m4c3-audit-retention.md) 완료

## 1. 목표와 신뢰 경계

XeCMS C4 Plugin은 운영자가 명시적으로 배포한 trusted npm package다. package code는
서버 process와 같은 권한으로 실행되므로 sandbox나 marketplace 심사를 제공하는 것처럼
표현하지 않는다. 대신 설치 전 manifest와 dependency graph를 결정론적으로 검증하고,
DB lifecycle을 preview/CAS/재인증/Audit로 보호한다.

```text
npm package / configured catalog
        ↓ import + manifest validation (startup fail-fast)
Runtime catalog ──────── incompatible/invalid → server startup refusal
        ↓ install preview
Durable Plugin plan (revision + blockers + migration digest)
        ↓ password + CSRF + exact recheck
Plugin migration + state + Audit/Outbox transaction
        ↓ restart required
enabled startup set → Route / Hook / Handler / Admin slot registry
```

- 설치·활성화·비활성화·제거 후 재시작을 요구한다.
- HTTP 요청으로 npm package를 내려받거나 package manager를 실행하지 않는다.
- catalog는 server deployment가 허용한 package만 포함한다.
- runtime import/manifest 자체가 잘못된 package는 상태 DB 접근 전에 startup을 중단한다.

## 2. 공개 SDK와 Version 정책

`@xecms/plugin-sdk`가 C4의 공개 타입 계약이다.

```ts
interface XeCmsPluginManifestV1 {
  manifestVersion: 1;
  id: string;                       // lowercase kebab namespace
  packageName: string;
  version: string;                  // SemVer
  displayName: string;
  description?: string;
  compatibility: {
    core: string;                   // >=0.4.0 <0.5.0 형태
    admin: string;
    sdk: "1.x";
  };
  dependencies?: Record<string, string>;
  serverEntry?: "server";
  adminEntry?: "admin";
  extensions?: {
    permissions?: string[];
    fields?: PluginFieldExtension[];
    routes?: PluginRouteDeclaration[];
    hooks?: string[];
    eventHandlers?: string[];
    adminSlots?: PluginAdminSlotDeclaration[];
  };
  migrations?: PluginMigrationDeclaration[];
  dataTables?: string[];
}
```

- Core/Admin runtime은 C4에서 `0.4.x`, SDK는 `1.x`로 시작한다.
- range parser는 exact SemVer와 `>=a.b.c <x.y.z`, `N.x`만 허용한다. 모호한 npm range는
  거부해 서로 다른 package manager 해석을 만들지 않는다.
- manifest와 runtime export version/id/packageName은 완전히 일치해야 한다.
- dependency는 catalog와 설치 상태 양쪽에서 검사하고 cycle을 거부한다.

## 3. Namespace 규칙

Plugin ID가 `example-greeter`라면 다음을 강제한다.

| 확장 | 형식 |
| --- | --- |
| Permission | `example-greeter.*` |
| Field type | `example-greeter:*` |
| Route ID | `example-greeter.*` |
| HTTP path | `/api/plugins/example-greeter/*` |
| Hook/Handler ID | `example-greeter.*` |
| Admin extension ID | `example-greeter.*` |
| data table | `_xecms_plugin_example_greeter_*` |

core permission, core table, `/api` 임의 경로와 다른 Plugin namespace 등록은 startup 전에
거부한다. 같은 extension ID 중복도 전체 catalog 오류다.

## 4. Runtime Extension

Server entry는 다음 trusted callback을 선언할 수 있다.

- namespaced REST Route와 필요한 Plugin Permission
- 기존 `DocumentLifecycleHookRegistry`에 등록하는 lifecycle Hook
- 기존 durable Worker에 등록하는 Event Handler
- Plugin migration `up/down`
- startup health check

Admin entry는 임의 원격 JavaScript 대신 C4에서 안정화한 declarative slot contract를
사용한다. `operations.overview`, `settings.after`, `dashboard.main` slot에 card/link/status를
등록하며 Admin Studio가 공통 토큰과 접근성 primitive로 렌더링한다. C4 이후 SDK에서
bundle protocol을 추가할 수 있지만 내부 React/CSS class는 공개하지 않는다.

Field extension은 namespaced metadata/validation/widget registration 계약을 제공한다.
C4 예제는 Admin slot과 HTTP Route를 사용하며, custom Field의 실제 schema storage 사용은
동일 registry를 거쳐야 한다.

## 5. 상태 모델과 재시작

```text
catalog-only
   └─ install apply → installed (restartRequired)
installed/disabled
   └─ enable apply  → enabled (restartRequired)
enabled
   └─ disable apply → disabled (restartRequired)
disabled
   └─ uninstall     → catalog-only (restartRequired)
```

DB의 `enabled`는 다음 startup에서 로드할 desired state다. 현재 process에서 실제로 로드된
상태는 `runtimeLoaded`로 별도 응답한다. 둘이 다르면 `restartRequired=true`다. catalog에서
사라진 enabled Plugin은 startup을 fail-closed한다.

Plugin 설정은 JSON object, revision CAS, `plugin.configure`, System session과 password
재인증을 요구한다. 설정 변경도 restart required다.

## 6. Lifecycle Preview와 Apply

```text
POST /api/plugins/plans
GET  /api/plugins/plans/:planId
POST /api/plugins/plans/:planId/apply
```

plan action은 `install | enable | disable | uninstall`이다. 15분 동안 유효하며 manifest
digest, 현재 Plugin revision, dependency, schema/data 사용량, migration 목록과 blocker를
저장한다.

Apply는 다음을 모두 만족해야 한다.

1. `plugin.install`, System session, Origin/CSRF, password 재인증
2. plan 미적용·미만료, manifest digest와 Plugin revision 일치
3. dependency/schema/data 후보를 transaction에서 재계산해 preview와 일치
4. blocker가 없을 때만 migration/state/Audit/Outbox commit
5. migration 실패 시 Plugin state와 migration history도 전체 rollback
6. 같은 plan 재실행은 저장된 적용 결과를 반환

설치 migration은 manifest 순서대로 한 transaction에서 실행하고 `(pluginId, migrationId,
checksum)`을 기록한다. 이미 적용된 ID의 checksum이 달라지면 startup/apply를 거부한다.

## 7. Disable과 Uninstall 안전성

- dependent enabled/installed Plugin이 있으면 disable/uninstall을 거부한다.
- active/draft Schema가 Plugin Field type을 사용하면 disable/uninstall을 거부한다.
- Plugin data row가 있으면 uninstall plan에 `preserve | export | purge` 선택이 필요하다.
- `preserve`: state와 permission만 제거하고 migration/data table은 남긴다.
- `export`: JSON export artifact를 DB에 저장한 뒤 `down` migration을 역순 실행한다.
- `purge`: 명시적 승인 아래 `down` migration을 역순 실행하고 data를 삭제한다.
- export/purge는 disabled Plugin에서만 가능하다.
- disable 상태가 실제 runtime에 반영된 재시작 이후에만 uninstall할 수 있다.
- migration `down`이 없으면 export/purge uninstall을 거부하고 preserve만 허용한다.

Plugin Permission이 Role에 할당되어 있거나 Plugin Route/Field가 사용 중이면 제거하지 않는다.
권한 assignment와 schema reference는 blocker detail로 반환한다.

## 8. PostgreSQL Migration

`0018_m4c4_plugin_platform`:

- `_xecms_plugins`: installed manifest/config/desired state/revision
- `_xecms_plugin_migrations`: ordered migration checksum/history
- `_xecms_plugin_plans`: durable preview/apply result
- `_xecms_plugin_exports`: uninstall export artifact
- `plugin.enable`, `plugin.disable`, `plugin.uninstall` Permission 추가
- owner/administrator Role upgrade
- Plugin lifecycle Outbox를 위한 `plugin` aggregate type

Plugin migration은 core migration table을 직접 수정하지 않으며 전용 history만 사용한다.

## 9. REST와 Admin Studio

```text
GET   /api/plugins/catalog
GET   /api/plugins
GET   /api/plugins/:pluginId
PATCH /api/plugins/:pluginId/config
POST  /api/plugins/plans
GET   /api/plugins/plans/:planId
POST  /api/plugins/plans/:planId/apply
GET   /api/plugins/exports/:exportId
GET   /api/admin/extensions
```

Admin `Plugins` 화면은 catalog/설치 상태, 호환성, dependency, extension, migration과
restart 상태를 표시하고 lifecycle preview → blocker → password apply를 제공한다.
활성화된 declarative slot은 core 화면에서 Plugin 이름과 source를 명확히 표시한다.

## 10. 예제 Plugin

`@xecms/example-plugin` / `example-greeter`:

- permission `example-greeter.greet`
- `GET /api/plugins/example-greeter/hello`
- `operations.overview` Admin status card
- namespaced table migration과 설정 기반 greeting
- uninstall export/purge 검증용 sample row

catalog → install → enable → restart 후 실제 REST Route와 Admin slot을 사용하고 disable 후
restart하면 둘 다 사라지는 흐름을 acceptance test로 고정한다.

## 11. 완료 Gate

- invalid compatibility, namespace, dependency cycle이 DB mutation 전에 거부된다.
- migration failure/checksum drift가 enabled 상태를 만들지 않는다.
- schema/data/dependent/permission blocker가 destructive lifecycle을 막는다.
- preserve/export/purge가 명시적이고 partial uninstall이 없다.
- example Plugin install/enable/restart/route/Admin slot을 PostgreSQL·HTTP·Chromium에서 완주한다.
- 전체 package boundary, production build와 기존 M0~C3 회귀가 통과한다.

## 12. 구현 및 검증 결과

- `@xecms/plugin-sdk` 공개 계약, 결정론적 SemVer/namespace/dependency graph 검증을 추가했다.
- `0018_m4c4_plugin_platform`과 PostgreSQL store가 durable plan, revision CAS,
  migration checksum/history, export artifact, Audit/Outbox를 원자적으로 관리한다.
- trusted catalog, Route/Hook/Event Handler/Admin slot startup registry와 설정·상태 재시작
  경계를 Server에 연결했다.
- Admin Studio에 `Plugins` lifecycle 화면과 `operations.overview` declarative extension
  renderer를 추가했다.
- `@xecms/example-plugin`을 Admin UI에서 설치·활성화·설정한 뒤 재시작하여 실제 Route와
  Admin card가 로드되고, disable 후 재시작하면 제거되는 흐름을 검증했다.
- SDK unit 5개, C4 PostgreSQL/HTTP 4개, Chromium 1개가 통과했다. 전체 회귀는
  Test File 60개(13개 환경 의존 skip), Test 370개(67개 skip), package boundary,
  문서 링크, TypeScript와 production Admin build를 통과했다.
- 독립 재현 명령은 `pnpm verify:m4c4`다.

## 13. 제외

- 원격 marketplace와 요청 중 npm install
- signature/자동 심사
- untrusted code sandbox와 process 격리
- hot reload
- Plugin frontend remote bundle protocol
