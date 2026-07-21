# XeCMS

**UI의 편리함과 코드의 확장성을 함께 제공하는 TypeScript CMS.**

XeCMS는 단순한 콘텐츠 관리 도구를 넘어, 여러 사용자 공간과 조직 단위가 서로 다른 권한으로
같은 콘텐츠 모델을 사용하는 애플리케이션을 만들 수 있도록 설계된 범용 CMS다. 처음에는
CMS Studio에서 콘텐츠 구조와 데이터를 관리하고, 필요해질수록 선언형 Schema,
TypeScript API, Realm 권한 모델과 Plugin으로 확장할 수 있다.

PostgreSQL을 공식 저장소로 사용하며 Schema, Migration, REST API, 관리 UI와 권한 판정이
하나의 모델을 공유한다.

> 현재 버전은 **0.5.0**이다. MVP 기능과 전체 검증 체계가 완성되어 있으며, Realm별 콘텐츠
> 접근 상한과 교차 Realm 사용자 관리 위임까지 포함한다.

## 주요 특징

- **점진적인 커스터마이징** — UI, canonical Schema, TypeScript, Plugin 순서로 필요한 만큼
  깊게 확장할 수 있다.
- **완전한 콘텐츠 수명주기** — Draft/Publish, Revision, Restore, soft delete, Media와
  Relation을 기본 제공한다.
- **계층형 콘텐츠** — Tree 기반 콘텐츠, 수동 정렬, 최대 깊이, 이동 검증과 부모 권한
  상속을 지원한다.
- **수직·수평 권한 모델** — Authority Level로 관리 서열을 표현하면서 같은 Level의 서로
  다른 Role은 수평 관계로 유지한다.
- **Resource Scope RBAC** — Site, Collection, Document tree 범위와 필드 단위 읽기·쓰기
  권한을 판정하고 그 이유를 설명한다.
- **Realm별 콘텐츠 접근 상한** — CMS Owner가 `Realm × Collection` 단위 Entitlement를
  설정하며, Realm 내부 권한은 이 상한을 넘어설 수 없다.
- **분리된 Identity Realm** — CMS 운영 계정과 콘텐츠 계정이 Global Identity를 공유할 수
  있지만 Membership, Role과 Scope는 Realm마다 독립적이다.
- **교차 Realm 사용자 관리 위임** — CMS가 관리 가능한 작업의 최대 범위를 열고, 각 Realm
  Owner가 그 범위 안에서 실제 관리자와 역할을 통제한다.
- **Auth Schema 격리** — 인증 Schema는 소유 Realm에서만 직접 접근할 수 있으며, 다른
  Realm에서는 서버가 원천 차단한다. 필요한 계정 관리는 전용 위임 경로로만 수행한다.
- **운영 가능한 Runtime** — Transactional Outbox, lease 기반 Worker, Audit, Retention,
  Doctor, Backup/Restore와 readiness probe를 포함한다.
- **Trusted Plugin SDK** — Manifest, 호환성 검사, Migration, Server/Admin extension과
  안전한 lifecycle을 제공한다.

## 빠른 시작

### 요구 사항

- Node.js 22.13 이상
- pnpm 10 (`corepack enable`)
- PostgreSQL 16 이상 (Docker Compose 제공)

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev:m1
```

현재 공개 Registry 배포 전에는 clone한 저장소나 GitHub Codespaces에서 위 명령을 사용한다.
`pnpm create xecms my-cms`를 사용하는 독립 프로젝트 생성 절차는 패키지 공개 후 제공한다.

실행 후 다음 주소를 사용할 수 있다.

| 용도 | 주소 |
| --- | --- |
| CMS Studio | <http://127.0.0.1:5173/admin/setup> |
| REST API | <http://127.0.0.1:3100/api> |
| Liveness | <http://127.0.0.1:3100/api/live> |
| Readiness | <http://127.0.0.1:3100/api/ready> |

자세한 설치와 첫 요청은 [시작하기](./docs/getting-started.md)를 참고한다.

빈 데이터베이스의 첫 접근은 `/admin/setup`으로 이동한다. 여기서 12자 이상의 비밀번호로
최초 Owner 계정을 생성한다. 실행 환경과 관계없이 초기 계정은 자동 생성되지 않으며,
자동화 테스트도 동일한 Bootstrap API를 사용한다.

## 콘텐츠와 권한 모델

```text
XeCMS Instance
└── Workspace
    ├── Sites
    ├── System Realm ── CMS 운영 계정과 권한
    ├── Content Realms ── 서비스 사용자와 독립 권한
    └── Collections
        └── Documents ── Revisions / Hierarchy / Media / Resource Scope
```

Workspace는 하나의 XeCMS 인스턴스가 관리하는 최상위 경계다. Collection은 Workspace에
공통으로 존재하고 Realm은 이를 복제하지 않는다. 대신 각 Realm이 어떤 Collection에
접근할 수 있는지는 CMS가 정한 Entitlement로 제한된다.

```text
최종 콘텐츠 권한
= Realm 내부 Role / Binding / Scope / Constraint
∩ CMS가 설정한 Realm × Collection Entitlement
```

Entitlement는 권한을 추가하지 않고 상한만 줄인다. 설정이 없거나 판정할 수 없으면
기본적으로 거부한다.

권한의 수직축은 누가 누구를 관리할 수 있는지를 결정한다. 같은 Authority Level에 속한
Role들은 우선순위가 같은 수평 관계이므로, Content Administrator와 Security Administrator처럼
서로 다른 책임을 갖되 상대 Role을 임의로 관리하지 못하게 구성할 수 있다. 실제 콘텐츠
접근은 이 서열과 별도로 Realm, Role Binding, Resource Scope와 Constraint를 모두 통과해야 한다.

CMS Studio는 `Basic / Standard / Advanced` 표시 모드를 제공한다. 이 선택은 개인
브라우저에서 메뉴와 기술 정보의 표시량만 바꾸며 실제 권한이나 직접 URL 접근에는 영향을
주지 않는다.

## Realm과 사용자 관리

CMS 운영 계정이라는 이유만으로 Content Realm 권한이 자동 부여되지는 않는다. 운영 계정이
콘텐츠 서비스에 로그인하려면 해당 Realm의 Membership과 Role Binding을 별도로 받아야 하며,
Realm Full Access 역시 대상 Realm에서 명시적으로 부여해야 한다.

사용자 관리 작업은 영향 범위에 따라 분리된다.

- **Membership 범위 작업** — 소속 부여, 소속 정지·재활성, Realm 역할 변경처럼 특정
  Realm 안에서만 영향을 주는 작업. 해당 Realm의 Owner와 내부 권한 정책이 통제한다.
- **Identity 범위 작업** — 비밀번호 재설정, 계정 비활성화, 세션 폐기, 계정 정보 수정처럼
  여러 Realm에 영향을 줄 수 있는 작업. 대상 Identity의 전체 Membership을 기준으로
  `all(엄격)` 또는 `any(느슨)` 정책을 교차 확인한다.
- **교차 Realm 위임** — CMS Owner는 관리 Realm이 대상 Realm에 수행할 수 있는 작업의
  최대 범위를 연다. 실제 관리자는 Realm Owner가 역할과 권한으로 지정한다.

인증 Schema는 일반 Collection Entitlement의 예외다.

```text
소유 Realm의 Auth Schema
→ 항상 허용, 서버 강제

다른 Realm의 Auth Schema
→ 항상 거부, 서버 강제

타 Realm 사용자 관리
→ Auth Schema 직접 접근이 아니라 전용 사용자 관리 API와 위임 정책 사용
```

따라서 CMS Owner도 다른 Realm의 인증 원장을 일반 콘텐츠처럼 직접 열 수 없다.

## Starter와 CLI

Project scaffold는 다음 starter를 제공한다.

| Starter | 용도 |
| --- | --- |
| `minimal` | 빈 Schema에서 CMS Studio로 시작 |
| `blog` | Posts, Pages와 Category hierarchy |
| `community` | 인증 가능한 Members Realm과 Posts |

`pnpm create xecms`로 독립 프로젝트를 생성할 수 있다.

주요 CLI 계약은 다음과 같다.

```text
xecms dev
xecms migrate
xecms schema validate [file]
xecms schema export [file]
xecms generate types --source file|active
xecms doctor [--json]
xecms backup create <directory>
xecms backup restore <directory> --confirm-empty
```

Migration은 forward-only다. Upgrade와 백업·복구 절차는 [운영 가이드](./docs/operations.md)에서
다룬다. 전체 문서는 [문서 인덱스](./docs/README.md)에서 확인할 수 있다.

## 개발과 검증

일반적인 로컬 검증은 다음 명령으로 실행한다.

```bash
pnpm check
```

전체 release gate는 모든 PostgreSQL 조건부 회귀 테스트, 이전 DB upgrade, 실제
backup/restore, 배포 tarball과 M1부터 M4-C5까지의 격리된 Chromium 사용자 여정을 포함한다.

```bash
pnpm exec playwright install chromium
pnpm verify:m4c5
```

`pnpm test:postgres:all`은 PostgreSQL 조건부 test 파일을 자동 탐색해 직렬 실행한다.
Release gate에서는 이 전체 회귀와 Chromium 누적 사용자 여정을 함께 검증한다.

## 현재 범위

0.5.0은 MVP 안정화 릴리스다. 다음 항목은 의도적으로 현재 범위에서 제외한다.

- 여러 Workspace를 제공하는 완전한 SaaS multi-tenancy
- 명시적 Deny와 임의 JavaScript policy language
- untrusted Plugin sandbox, marketplace와 hot reload
- PostgreSQL 이외의 공식 Database Adapter
- 외부 Object Storage, PITR/WAL과 zero-downtime migration orchestration
- 완전한 OIDC/SAML 제품화와 Plugin/Container Registry 자동 배포

## 문서

- [문서 인덱스](./docs/README.md)
- [시작하기](./docs/getting-started.md) · [핵심 개념](./docs/concepts.md) · [인증](./docs/authentication.md)
- [REST API](./docs/rest-api.md) · [TypeScript SDK](./docs/typescript-sdk.md) · [Schema](./docs/schema.md)
- [운영 가이드](./docs/operations.md) · [확장 개발](./docs/extending.md)

> **배포 상태**: `@xecms/*` 패키지와 공식 컨테이너 이미지의 공개 Registry 배포는 아직
> 진행되지 않았다. 배포 전까지는 이 저장소를 clone한 뒤 위 빠른 시작 절차로 실행한다.
