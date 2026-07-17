# XeCMS

**UI의 편리함과 코드의 확장성을 함께 제공하는 TypeScript CMS.**

XeCMS는 처음에는 Admin Studio에서 콘텐츠 구조와 데이터를 관리하고, 필요해질수록
선언형 Schema, TypeScript API, 권한 모델과 Plugin으로 확장할 수 있도록 설계된 범용 CMS다.
PostgreSQL을 공식 저장소로 사용하며 Schema부터 Migration, REST API, Admin UI까지 하나의
모델을 공유한다.

> 현재 버전은 **0.4.1**이다. MVP 기능과 전체 검증 체계는 완성됐지만
> `@xecms/*` 패키지와 공식 컨테이너 이미지는 아직 공개 Registry에 배포하지 않았다.
> 지금은 이 저장소를 clone하여 실행하는 방식을 지원한다.

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
- **분리된 Identity Realm** — CMS 운영 계정과 콘텐츠 계정이 Global Identity를 공유할 수
  있지만 Membership, Role과 Scope는 Realm마다 독립적이다.
- **운영 가능한 Runtime** — Transactional Outbox, lease 기반 Worker, Audit, Retention,
  Doctor, Backup/Restore와 readiness probe를 포함한다.
- **Trusted Plugin SDK** — Manifest, 호환성 검사, Migration, Server/Admin extension과
  안전한 lifecycle을 제공한다.

## 빠른 시작

### 요구 사항

- Node.js 22.13 이상
- pnpm 10
- Docker와 Docker Compose

```bash
git clone https://github.com/mkjang2000/XeCMS.git
cd XeCMS
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev:m1
```

실행 후 다음 주소를 사용할 수 있다.

| 용도 | 주소 |
| --- | --- |
| Admin Studio | <http://127.0.0.1:5173/admin/setup> |
| REST API | <http://127.0.0.1:3100/api> |
| Liveness | <http://127.0.0.1:3100/api/live> |
| Readiness | <http://127.0.0.1:3100/api/ready> |

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

권한의 수직축은 누가 누구를 관리할 수 있는지를 결정한다. 같은 Authority Level에 속한
Role들은 우선순위가 같은 수평 관계이므로, Content Administrator와 Security Administrator처럼
서로 다른 책임을 갖되 상대 Role을 임의로 관리하지 못하게 구성할 수 있다. 실제 콘텐츠
접근은 이 서열과 별도로 Realm, Role Binding, Resource Scope와 Constraint를 모두 통과해야 한다.

Admin Studio는 `Basic / Standard / Advanced` 표시 모드를 제공한다. 이 선택은 개인
브라우저에서 메뉴와 기술 정보의 표시량만 바꾸며 실제 권한이나 직접 URL 접근에는 영향을
주지 않는다.

CMS 운영 계정이라는 이유만으로 Content Realm 권한이 자동 부여되지는 않는다. 운영 계정이
콘텐츠 서비스에 로그인하려면 해당 Realm의 Membership과 Role Binding을 별도로 받아야 하며,
Realm Full Access 역시 대상 Realm에서 명시적으로 부여해야 한다.

## Starter와 CLI

Project scaffold는 다음 starter를 제공한다.

| Starter | 용도 |
| --- | --- |
| `minimal` | 빈 Schema에서 Admin Studio로 시작 |
| `blog` | Posts, Pages와 Category hierarchy |
| `community` | 인증 가능한 Members Realm과 Posts |

Registry 배포 후에는 `create-xecms`로 독립 프로젝트를 생성할 수 있다. 현재 저장소에서는
CLI와 scaffold 결과를 빌드 및 테스트할 수 있지만, 생성 프로젝트의 일반 설치는
`@xecms/*` 패키지 공개 이후 지원한다.

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

Migration은 forward-only다. Upgrade와 복구 절차는
[운영 Runbook](./docs/operations-runbook.md)을 따른다.

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
Release gate에서는 이 전체 회귀와 Chromium 누적 11개 여정을 함께 검증한다.

## 현재 범위

0.4.1은 MVP 안정화 릴리스다. 다음 항목은 의도적으로 현재 범위에서 제외한다.

- 여러 Workspace를 제공하는 완전한 SaaS multi-tenancy
- 명시적 Deny와 임의 JavaScript policy language
- untrusted Plugin sandbox, marketplace와 hot reload
- PostgreSQL 이외의 공식 Database Adapter
- 외부 Object Storage, PITR/WAL과 zero-downtime migration orchestration
- 완전한 OIDC/SAML 제품화와 Plugin/Container Registry 자동 배포

## 문서

- [문서 인덱스와 관리 원칙](./docs/README.md)
- [시스템 사양](./docs/system-specification.md)
- [개발 가이드](./docs/development-guide.md)
- [운영 Runbook](./docs/operations-runbook.md)
- [릴리스 및 구현 이력](./docs/release-history.md)
- [Custom Admin Apps 사양](./docs/custom-admin-apps-specification.md)
- [Custom Admin Apps 개발 순서](./docs/custom-admin-apps-roadmap.md)
