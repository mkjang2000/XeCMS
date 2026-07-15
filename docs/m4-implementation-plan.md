# XeCMS M4 구현 계획

> 상태: M4-A·M4-B·M4-C1~M4-C5 완료 (2026-07-15)
> 상위 문서: [XeCMS MVP 사양서](./mvp-specification.md)  
> 선행 조건: [M3 Authorization Platform](./m3-authorization-platform.md) 완료

M4는 콘텐츠 애플리케이션 계정과 최소 확장 플랫폼을 완성하는 마지막 MVP
milestone이다. 기능을 작은 미완성 조각으로 흩뜨리지 않고, 사용자 여정과 운영
검증까지 닫히는 세 단계로 진행한다. M4-C는 운영 가능한 제품 경계를 위해 다섯 개의
순차 묶음으로 세분화한다.

## 1. 진행 순서

### M4-A — Identity & Content Realm

> 완료: PostgreSQL·HTTP·Admin/Community Chromium Gate 통과

- auth-enabled Collection
- Global Identity와 Realm Membership
- 콘텐츠 가입·로그인·로그아웃·세션
- Realm Profile Document
- System Identity의 명시적/JIT Content Realm 로그인
- Account Linking
- Realm별 M3 Role, Group, Binding과 Resource Scope
- 명시적인 Realm Full Access
- Identity Realm Admin UI와 Community E2E

완료 기준과 세부 계약은
[M4-A Identity & Content Realm 사양](./m4a-identity-realm-specification.md)을 따른다.

### M4-B — Hook, Event & Worker

> 완료: Unit·PostgreSQL·HTTP·Admin Chromium Gate 통과  
> 상세 계약: [M4-B Hook, Event & Worker 사양](./m4b-event-worker-specification.md)

- lifecycle Hook
- transactional outbox
- commit 이후 Durable Event 전달
- retry/backoff와 idempotency 계약
- Worker lease와 실패 복구
- Job 상태 API와 Admin UI
- Webhook 또는 검색 index 예제 Handler

M4-B는 M4-A의 Identity/Realm event와 M3 Role Binding event도 같은 outbox로
발행하며 source mutation과 한 transaction으로 commit한다.

### M4-C — Administration, Plugin & Productization

> 상세 순서: [M4-C Administration, Plugin & Productization 구현 계획](./m4c-administration-productization-plan.md)

1. **M4-C1 Users & Credentials** — Identity/Membership 관리, credential, session,
   서비스 계정과 API key — **완료**
   상세 계약: [M4-C1 Users & Credentials 상세 사양](./m4c1-user-identity-administration.md)
2. **M4-C2 Sites & System Settings** — Instance/Workspace 진단, Site, Schema lock과
   플랫폼 설정 — **완료**
   상세 계약: [M4-C2 Sites & System Settings 상세 사양](./m4c2-sites-system-settings.md)
3. **M4-C3 Audit & Lifecycle** — 통합 Audit, retention, 정리 preview와 운영 Overview
   — **완료**
   상세 계약: [M4-C3 Unified Audit & Retention 상세 사양](./m4c3-audit-retention.md)
4. **M4-C4 Plugin Platform** — Manifest, 확장 entry, migration, lifecycle과 예제 Plugin
   — **완료**
   상세 계약: [M4-C4 Trusted Plugin Platform 상세 사양](./m4c4-plugin-platform.md)
5. **M4-C5 Operations & Distribution** — CLI/doctor, starter, 설치, upgrade,
   backup/restore와 전체 MVP E2E — **완료**
   상세 계약: [M4-C5 Operations & Distribution 상세 사양](./m4c5-operations-distribution.md)

M4-C1부터 순서대로 각 묶음의 PostgreSQL·HTTP·Admin Chromium Gate를 닫은 뒤 다음
묶음으로 이동한다.

## 2. 공통 작업 방식

각 묶음은 다음 순서로 완결한다.

```text
상세 계약
→ Domain/Application
→ PostgreSQL migration/store
→ HTTP contract/client
→ Admin 또는 사용자 UI
→ unit/integration/Chromium
→ 운영 문서와 완료 판정
```

뒤 묶음의 기반만 미리 만들고 완료 기능처럼 노출하지 않는다. 실패한 migration,
중간 provisioning과 background 작업은 재시도하거나 fail-closed할 수 있는 durable
상태를 남긴다.

## 3. Release Gate

M4의 각 묶음은 다음 Gate를 통과해야 한다.

- TypeScript project reference와 package boundary
- Domain/Application unit test
- 실제 PostgreSQL migration 및 integration test
- REST contract와 보안 회귀
- Admin 또는 콘텐츠 사용자 Chromium E2E
- upgrade 재현성과 실패 후 재시도
- 문서 링크와 제외 범위 검사

M4-C 종료 시 minimal, blog, community starter를 빈 환경에서 실행하고
[MVP 사양서](./mvp-specification.md)의 최종 사용자 시나리오 전체를 검증한다.

## 4. 의도적 제외

- untrusted Plugin sandbox
- Plugin marketplace와 자동 서명·심사
- Plugin hot reload
- 외부 Identity Provider의 완전한 OIDC/SAML 제품화
- 여러 Workspace의 완전한 SaaS multi-tenancy
- explicit Deny와 임의 policy language
