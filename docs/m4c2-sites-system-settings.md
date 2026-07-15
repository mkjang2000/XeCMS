# M4-C2 Sites & System Settings 상세 사양

> 상태: 구현 완료 — Unit·PostgreSQL·HTTP·Admin Chromium Gate 통과 (2026-07-15)
> 상위 계획: [M4-C 구현 계획](./m4c-administration-productization-plan.md)
> 선행 조건: [M4-C1 Users & Credentials](./m4c1-user-identity-administration.md) 완료

## 1. 목표와 경계

Instance 진단, 단일 Workspace 설정과 여러 Site를 콘텐츠 Singleton과 분리해 운영한다.
Site는 권한 Resource이자 콘텐츠 범위이며 Identity Realm과 같은 개념이 아니다.

```text
Instance (read-only diagnostics)
└── Workspace (exactly one)
    ├── Site A
    │   └── bound Collections → Documents
    ├── Site B
    │   └── bound Collections → Documents
    └── Unassigned Collections
```

- MVP는 `wrk_default` 한 개만 제공하지만 모든 record는 `workspaceId`를 보존한다.
- 일반 사이트 콘텐츠 설정은 Singleton Collection으로 관리한다.
- DB URL, session secret, filesystem 경로 원문과 환경 변수는 변경 API를 제공하지 않는다.
- Site와 Realm의 자동 연결, domain routing, locale별 독립 publication은 제외한다.

## 2. Workspace와 Instance 진단

Workspace 설정 record:

```ts
interface WorkspaceSettings {
  id: string;
  displayName: string;
  defaultTimezone: string;
  adminLocale: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
}
```

- timezone은 IANA identifier, Admin locale은 canonical BCP 47 tag다.
- 수정은 `expectedRevision` CAS, `system.settings.update`, 현재 password 재인증을 요구한다.
- Workspace ID와 개수는 변경할 수 없다.

Instance 진단은 node environment, XeCMS/Node/PostgreSQL version, schema mode, Worker 상태,
upload limit, 허용 MIME, origin 수와 storage adapter 종류만 반환한다. DB host·사용자·schema,
secret, storage 절대 경로와 origin 원문은 반환하지 않는다.

## 3. Site 계약

```ts
interface SiteRecord {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  canonicalUrl?: string;
  status: "active" | "archived";
  isDefault: boolean;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt?: string;
}
```

- key는 `[a-z][a-z0-9-]{1,62}[a-z0-9]`, Workspace 안에서 영구적으로 유일하다.
- canonical URL은 `https:` 또는 development의 loopback `http:` origin만 허용하며 path,
  query, fragment, userinfo는 금지한다.
- 정확히 하나의 active default Site를 유지한다. 첫 Site는 자동 default다.
- default Site archive 전에 다른 active Site를 같은 transaction에서 default로 지정해야 한다.
- archive/reactivate는 CAS이며 삭제는 M4-C2에서 제공하지 않는다.
- Site 생성·상태 변경·default 변경과 binding은 Audit/Event를 같은 transaction에 기록한다.

## 4. 콘텐츠 Scope

MVP binding은 Collection 단위 0..1 Site다. Document는 Collection binding을 상속하며 개별
override를 제공하지 않는다. 이 계약으로 Collection과 Document 모두 하나의 Site scope에
연결되면서 같은 Collection 안의 교차 Site relation 복잡성을 피한다.

```text
Workspace Resource
├── Site Resource
│   └── Collection Resource
│       └── Document Resource
└── Content Root Resource
    └── Unassigned Collection Resource
```

- binding 변경은 `expectedSiteRevision`과 현재 authorization policy revision을 요구한다.
- projection은 Site/Collection resource 변경과 settings transaction을 원자적으로 commit한다.
- 다른 Site의 Role Binding은 propagation으로 넘어오지 않는다.
- archived Site에 묶인 Collection의 create/update/publish/move/media attach는 fail-closed한다.
  read/export와 archive/restore 준비는 유지한다.
- Site를 archive해도 기존 Document 상태를 자동 변경하지 않는다.
- Schema apply로 Collection이 제거되면 binding은 제거하고 Site Resource는 보존한다.

## 5. Schema mode

환경 설정 `XECMS_SCHEMA_MODE`:

| mode | 읽기/export | UI draft 편집 | REST draft/apply | Manifest import |
| --- | --- | --- | --- | --- |
| `editable` | 허용 | 허용 | 허용 | 허용 |
| `locked` | 허용 | 금지 | 금지 | 금지 |
| `manifest-only` | 허용 | 금지 | 금지 | 허용 |

- 기본값은 development/test의 `editable`, production의 `locked`다.
- server route 이전의 공통 Application guard에서 검사해 Admin UI, REST, client 또는
  Plugin adapter로 우회할 수 없게 한다.
- 차단 응답은 `SCHEMA_MUTATION_LOCKED` 또는 `SCHEMA_MANIFEST_ONLY` `423`이다.
- UI는 mode와 이유를 표시하고 차단된 버튼을 실행하지 않는다.
- mode는 DB/API에서 변경하지 않는다.

## 6. HTTP 계약

```text
GET    /api/system/diagnostics
GET    /api/workspace/settings
PATCH  /api/workspace/settings
GET    /api/sites
POST   /api/sites
GET    /api/sites/:siteId
PATCH  /api/sites/:siteId
POST   /api/sites/:siteId/archive
POST   /api/sites/:siteId/reactivate
POST   /api/sites/:siteId/default
PUT    /api/sites/:siteId/collections/:collectionId
DELETE /api/sites/:siteId/collections/:collectionId
```

목록과 읽기는 `system.settings.read`, Workspace 수정은 `system.settings.update`를 사용한다.
Site에는 `site.read`, `site.create`, `site.update`, `site.archive`, `site.collection.bind`를
추가한다. 모든 mutation은 System session, Origin/CSRF, Permission과 CAS를 요구하고
Workspace 설정·Site archive/default·binding은 재인증한다. API key는 settings mutation,
Site archive/default와 binding을 수행할 수 없다.

## 7. PostgreSQL migration

`0016_m4c2_sites_settings`:

- `_xecms_workspaces`: display name 호환 유지, timezone, Admin locale, revision/update metadata
- `_xecms_sites`: lifecycle/default/CAS와 Workspace key unique
- `_xecms_collection_sites`: Workspace, Site, Collection 0..1 binding
- Site authorization Resource와 parent projection invariant
- settings/site Audit와 transactional outbox
- C2 Permission catalog와 Owner/Admin 기본 Role upgrade

Migration은 기존 Workspace를 revision 1, `UTC`, `ko-KR`로 backfill한다. 기존 Collection은
unassigned 상태로 유지해 upgrade 직후 권한 parent가 바뀌지 않는다. 재실행은 default,
binding, resource ID와 revision을 바꾸지 않는다.

## 8. Admin Studio

- `Settings / Overview`: masked Instance 진단, Workspace 설정과 Schema mode
- `Settings / Sites`: Site 목록, create/edit, archive/reactivate, default 지정
- Site 상세: 연결 Collection과 authorization scope 이동
- Schema 화면: mode banner와 server 판정에 맞춘 mutation disable
- 위험 dialog: 대상, 영향 Collection 수, default 대체 Site, password 재인증 표시

## 9. 구현 순서

### C2-A Settings foundation

- migration, Workspace CAS와 masked diagnostics
- schema mode server guard와 Admin 표시

### C2-B Site lifecycle

- Site create/update/archive/reactivate/default invariant
- Permission, Audit/Event와 Admin UI

### C2-C Content scope projection

- Collection binding과 authorization resource reparent
- archived Site write guard

### C2-D Acceptance

- PostgreSQL upgrade/idempotency/CAS
- HTTP permission, reauth, schema-lock와 Site isolation
- Chromium Settings/Sites journey

## 10. 완료 조건

- Workspace 설정 CAS와 재인증이 fail-closed한다.
- 진단 응답과 log/Audit에 secret, DB 연결 정보, 절대 storage 경로가 없다.
- active default Site invariant가 동시 요청과 archive 실패에서도 유지된다.
- Site Role scope가 다른 Site 또는 unassigned Collection에 전파되지 않는다.
- archived Site의 콘텐츠 mutation이 모든 API 표면에서 거부된다.
- schema mode가 UI, REST와 Local/Plugin adapter에서 같은 판정을 사용한다.
- migration 재실행과 PostgreSQL·HTTP·Chromium Gate가 통과한다.

완료 검증 결과:

- 전체 저장소: boundary·문서 링크·TypeScript와 기본 테스트 359개 통과
- C2 PostgreSQL/HTTP: migration 재실행, Workspace/Site transaction, 재시작 scope 보존,
  archived write lock과 Schema mode 시나리오 5개 통과
- C2 Chromium: Workspace 수정, Site create/edit/default/archive/reactivate와 locked Schema UI
  사용자 여정 통과, page error 및 5xx 응답 없음

## 11. 제외

- 여러 Workspace 생성·삭제
- domain routing과 TLS 자동화
- locale별 Site publication
- Site 삭제와 cross-Site Collection/Document 이동
- 환경 변수/secret의 Admin 변경
- 환경 간 자동 배포
