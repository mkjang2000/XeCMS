# M0 — Domain Prototype

> 상태: Complete  
> 완료일: 2026-07-14  
> 상위 문서: [XeCMS MVP 사양서](./mvp-specification.md)  
> 범위: 순수 TypeScript 도메인 모델과 자동화 테스트

## 1. M0에 포함되지 않는 것

M0에는 다음 항목이 없다.

- Admin UI
- HTTP 또는 REST 서버
- PostgreSQL 및 Migration 실행기
- 실제 Password, Session 또는 MFA 인증
- Plugin runtime
- 파일 업로드

M0의 목적은 이후 UI와 API가 의존할 핵심 규칙을 먼저 안정화하는 것이다.

## 2. 현재 패키지

```text
packages/
├── schema
│   ├── canonical Schema IR
│   ├── stable Schema Object ID
│   ├── decode / normalize / validation
│   └── ID 기반 diff
├── core
│   ├── Document Identity / Revision aggregate
│   └── Document relation reference
└── authorization
    ├── Policy Snapshot
    ├── Scope evaluation
    ├── Permission Grant
    └── Role / Binding / Subject management authorization
```

통합 동작 예시는 `examples/domain-prototype`에 있다.

## 3. 실행

```bash
pnpm install
pnpm check
pnpm prototype
pnpm verify:m0
```

- `pnpm check`: TypeScript typecheck와 전체 테스트
- `pnpm prototype`: package build 후 domain prototype 실행
- `pnpm verify:m0`: clean build, package boundary, typecheck, test 및 prototype 전체 검증

상세 도메인 계약:

- [Schema IR](./schema-ir-specification.md)
- [Document와 Revision](./document-revision-specification.md)
- [Authorization Evaluation](./authorization-evaluation-specification.md)

## 4. 구현된 핵심 규칙

### Schema

- Canonical IR과 Registry metadata 분리
- Collection, Field, Relation, Component ID brand
- ID prefix 및 graph 전체 uniqueness 검사
- 존재하지 않는 Relation과 Component target 거부
- 이름 대신 안정적인 ID로 rename/delete/type change diff
- destructive/risky/safe 변경 분류
- `unknown` JSON decoder와 canonical serialization
- 주입 가능한 ID generator와 발급 ID 재사용 방지
- Field owner 이동 및 Relation 변경 감지

### Document

- Document Identity와 immutable Revision 분리
- Draft와 Published Revision 동시 존재
- Published Revision을 유지한 새 Draft 편집
- 과거 Revision 복원 시 새 Draft Revision 생성
- Archive와 Soft Delete 분리
- optimistic aggregate version 검사
- pointer와 sequence invariant 검사
- Document relation만 허용하고 Revision relation 참조 거부
- 공통 command/event metadata
- 상태 전이 조합 model-based 검증

### Authorization

- Realm, Subject, Resource, Scope
- Authority Level과 동일레벨 Role
- Role Binding과 Permission Catalog
- `self`, `children`, `self-and-children` 전파
- default deny
- Realm 및 Scope 격리
- 같은 Level 관리 거부
- 한 Grant가 rank, scope, action, delegation을 단독 만족
- 높은 일반 Role과 낮은 관리 Role을 합성한 권한 상승 거부
- 자기 Role Binding 할당 거부
- protected target 및 non-delegatable permission 보호
- Role create/update/delete 관리 판정
- Binding create/update/remove 관리 판정
- Subject disable과 Realm 범위 target level 계산
- immutable validated Policy Snapshot

## 5. 완료된 검증 범위

### Schema

- 알 수 없는 property/type과 비 JSON 값 거부
- normalization idempotence 및 deterministic serialization
- ID prefix, graph uniqueness, 예약 이름 및 default 검증
- Field owner 이동과 Relation 변경 diff
- 입력 불변성과 JSON round-trip

### Document

- Create/Edit/Publish/Unpublish/Restore 전체 전이
- Archive/Unarchive와 Soft Delete/Restore
- Document relation runtime validation
- 모든 command 이후 aggregate invariant
- 7개 action의 깊이 4 전체 조합 2,401개 model-based 검증

### Authorization

- Role 및 Binding mutation별 관리 판정
- 기존·신규 rank와 Scope를 함께 보호하는 downgrade 우회 방지
- Subject disable의 Realm 전체 최고 Level 계산
- 만료 Binding, Cross-Realm, protected object 및 graph cycle 검증
- 한 Grant 원자 만족과 권한 합성 우회 회귀 테스트

### 공통

- 공개 API와 구조화된 error/reason code
- Domain package dependency boundary 검사
- Markdown local link 검사
- deterministic prototype smoke test
- clean build 기반 통합 검증

## 6. M0 완료 기준

M0는 다음 조건을 모두 통과해 완료됐다.

- [x] 핵심 모델이 공개 TypeScript API로 제공된다.
- [x] Domain package가 HTTP, UI 및 PostgreSQL에 의존하지 않는다.
- [x] Schema validation이 구조화된 path와 error code를 반환한다.
- [x] Access Decision이 이유와 Grant Provenance를 반환한다.
- [x] 동일레벨 및 권한 합성 우회 시나리오가 regression test로 고정된다.
- [x] Document pointer와 Revision invariant가 모든 command 이후 검증된다.
- [x] `pnpm verify:m0`가 clean build에서 성공한다.
