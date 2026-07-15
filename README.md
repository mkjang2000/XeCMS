# XeCMS

개발자가 UI, 선언형 Schema, SDK 및 Plugin 순서로 점진적으로 확장할 수 있는 범용 CMS 프로젝트다.

**M0 — Domain Prototype**부터 **M4-B — Hook, Event & Worker**까지 완료했다.
현재 XeCMS는 PostgreSQL, REST API, Schema/Migration, 계층형 Content, Media,
Draft/Publish/Revision, 동일 레벨 Role과 Resource Scope 권한을 React Admin Studio까지
하나의 경로로 실행할 수 있다. CMS 운영 계정과 Content Realm 계정은 Global Identity를
공유할 수 있지만, Membership·Subject·Role·Scope는 Realm별로 독립된다. 콘텐츠와
보안 변경은 transactional outbox에 원자적으로 기록되고 lease 기반 Worker가
at-least-once로 처리한다.

## 문서

- [시스템 사양서](./docs/system-specification.md)
- [MVP 사양서](./docs/mvp-specification.md)
- [M0 Domain Prototype](./docs/m0-domain-prototype.md)
- [M1 로컬 실행 및 검증](./docs/m1-development.md)
- [M1 Admin Studio 구현](./docs/m1-admin-studio.md)
- [M2 Content Core 구현 계획](./docs/m2-implementation-plan.md)
- [M2 Document Lifecycle](./docs/m2-document-lifecycle.md)
- [M2 Content Core 운영 및 검증](./docs/m2-content-core.md)
- [M3 Authorization Platform 구현 및 검증](./docs/m3-authorization-platform.md)
- [M4 구현 계획](./docs/m4-implementation-plan.md)
- [M4-A Identity & Content Realm 사양](./docs/m4a-identity-realm-specification.md)
- [M4-B Hook, Event & Worker 사양](./docs/m4b-event-worker-specification.md)
- [M4-C Administration, Plugin & Productization 계획](./docs/m4c-administration-productization-plan.md)
- [M4-C1 Users & Credentials 상세 사양](./docs/m4c1-user-identity-administration.md)
- [M4-C2 Sites & System Settings 상세 사양](./docs/m4c2-sites-system-settings.md)
- [M4-C3 Unified Audit & Retention 상세 사양](./docs/m4c3-audit-retention.md)
- [M4-C4 Trusted Plugin Platform 상세 사양](./docs/m4c4-plugin-platform.md)
- [Admin Studio 사양](./docs/admin-ui-specification.md)
- [Schema IR 사양](./docs/schema-ir-specification.md)
- [Document와 Revision 사양](./docs/document-revision-specification.md)
- [Authorization Evaluation 사양](./docs/authorization-evaluation-specification.md)

## M1 로컬 실행

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev:m1
```

Admin Studio는 `http://127.0.0.1:5173/admin/login`에서 열 수 있다. 로컬 개발
기본 계정은 `admin/admin`이며 `NODE_ENV=development`의 개발 seed에서만
허용된다.

M4-B까지의 누적 검증은 실제 임시 PostgreSQL과 Chromium을 포함한다.

```bash
pnpm exec playwright install chromium
pnpm verify:m4b
```

M4-A Community 검증 화면은 활성화한 Realm key에 따라
`http://127.0.0.1:3100/community/:realmKey`에서 열 수 있다.
