# XeCMS 릴리스 및 구현 이력

이 문서는 완료된 milestone의 결과만 보존한다. 세부 구현 계획은 현재 코드와
Git history가 담당하며, 앞으로의 작업은 별도 roadmap에서 관리한다.

## 0.4.1

0.4.1은 M0~M4 MVP 완료 후 안정화 릴리스다.

주요 변경:

- 모든 실행 환경에서 자동 Owner seed 제거
- 최초 실행을 `/admin/setup` Bootstrap으로 통일
- Admin Studio `Basic / Standard / Advanced` 표시 모드 추가
- Owner 역할의 delegatable permission 정합성 보정
- backup/restore 적대적 입력과 호환성 검증 강화
- 전체 PostgreSQL 조건부 test를 release gate에 포함
- hierarchy bulk UPSERT와 Plugin export memory 사용 개선

## M0 — Domain Prototype

완료 범위:

- Schema IR decode, normalization, validation과 diff
- Document aggregate와 immutable revision
- Draft/Publish, lifecycle, deletion 상태 축
- Subject, Role, Authority Level, Scope와 explainable decision
- 동일 레벨 Role의 수평 관계와 delegation 보호

M0는 DB와 UI 없이 순수 TypeScript domain 규칙을 검증했다.

## M1 — Vertical Slice

완료 범위:

- PostgreSQL registry와 migration
- Setup/Login/Session/CSRF
- Schema draft, preview와 apply
- Schema 기반 document list/create/edit
- React Admin Studio와 production same-origin 제공
- 격리 PostgreSQL 및 Chromium E2E

## M2 — Content Core

완료 범위:

- Collection과 Singleton
- 확장 Field, Component, Block, Relation
- Revision history와 restore
- Draft/Publish/Unpublish
- soft delete, trash restore와 purge
- Media upload와 consistency 검사
- 계층형 Document, move preview와 권한 영향

## M3 — Authorization Platform

완료 범위:

- Realm별 Subject, Group, Authority Level, Role과 Binding
- 동일 레벨 Role
- Resource tree와 `self`, `children`, `self-and-children` Scope
- 조건부 Binding과 field-level read/write
- management hierarchy와 delegation 판정
- Policy revision, cache 일관성과 audit
- 역할/바인딩/시뮬레이터 Admin UI

## M4-A — Identity와 Content Realm

완료 범위:

- Global Identity와 Realm Membership 분리
- System Realm과 Content Realm session 격리
- System Identity의 명시적 Content Realm provisioning
- Content signup/login/profile
- Realm Full Access
- Schema 기반 인증 Collection

## M4-B — Hook, Event와 Worker

완료 범위:

- 동기 document lifecycle hook
- transactional outbox
- durable event envelope
- lease 기반 Worker
- retry, dead delivery와 idempotency
- Worker health와 Admin 운영 화면

## M4-C — 운영 제품화

### C1 Users & Credentials

- System/Content Identity 관리
- 초대와 password reset
- session 폐기
- Owner 이전
- service identity와 API key

### C2 Sites & System Settings

- Workspace 설정과 diagnostics
- Site lifecycle
- Site-Collection binding
- Schema mode와 운영 설정

### C3 Unified Audit & Retention

- 여러 source의 통합 Audit
- cursor 조회와 export
- session/outbox/audit retention preview/apply
- 민감정보 redaction

### C4 Trusted Plugin Platform

- versioned Plugin SDK와 manifest
- trusted runtime catalog
- migration과 configuration
- lifecycle preview/apply
- disable/uninstall blocker
- server route, hook, event handler와 Admin slot

### C5 Operations & Distribution

- CLI와 starter
- doctor, liveness와 readiness
- backup/restore
- forward-only upgrade 절차
- distribution artifact 검증

## MVP 사후 P0~P2 점검

점검일: 2026-07-16

| 항목 | 결과 |
| --- | --- |
| Restore integrity 실패 후 media root 잔존 | 수정 완료 |
| Retention candidate count만 검증 | exact candidate digest로 수정 |
| Release gate의 PostgreSQL suite 누락 | 전체 자동 탐색·직렬 실행 |
| Backup manifest path 우회 | 고정 artifact 이름 검증 |
| TAR symlink/hardlink | 일반 파일·디렉터리 외 거부 |
| Backup 미래 version 복원 | 같은 0.4 line의 현재 patch 이하만 허용 |
| Hierarchy 전체 snapshot 비용 | changed-node bulk UPSERT, closure 최적화는 후속 |
| Unified Audit 대용량 조회 | 200k 행 약 1초, read model은 후속 |
| Plugin export Node heap 증가 | PostgreSQL JSONB 조립으로 완화 |
| Plugin Field 사용 탐지 오탐 | exact field tree traversal로 수정 |

검증 기준:

```bash
pnpm check
pnpm test:postgres:all
pnpm test:p2:benchmarks
pnpm verify:m4c5
```

## 알려진 후속 과제

- hierarchy closure incremental update
- 대규모 Unified Audit 전용 read model
- 대형 Plugin export streaming
- 실제 유효 권한 기반 Admin navigation
- management hierarchy context를 지원하는 권한 시뮬레이터
- Custom Admin Apps와 scope-aware document query
