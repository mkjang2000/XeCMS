# XeCMS MVP 사양서

> 상태: 완료 v0.4.1 (2026-07-16)
> 기준일: 2026-07-14  
> 상위 문서: [XeCMS 시스템 사양서](./system-specification.md)  
> 목적: XeCMS MVP의 범위, 구현 순서, 산출물 및 완료 조건을 정의한다.

## 1. MVP 정의

XeCMS MVP는 단순한 CRUD 데모가 아니다. 개발자가 다음 흐름을 실제로 완주할 수 있는 최초의 배포 가능한 제품을 의미한다.

```text
프로젝트 생성
→ CMS 실행
→ Admin 로그인
→ Collection 생성
→ Migration 적용
→ 콘텐츠 작성 및 게시
→ API로 조회
→ 계층과 권한 구성
→ 콘텐츠 Realm 계정으로 로그인
→ Plugin으로 기능 확장
```

MVP 완료 시 사용자는 코어를 수정하지 않고 구조화 콘텐츠, 계층형 콘텐츠, 시스템 계정, 콘텐츠 계정 및 계층형 RBAC를 하나의 설치 환경에서 사용할 수 있어야 한다.

## 2. MVP 원칙

### 2.1 Vertical Result

각 milestone은 내부 패키지만 존재하는 상태로 끝나지 않고 사용자가 실행하고 확인할 수 있는 결과를 제공한다.

### 2.2 Schema부터 UI까지 하나의 경로

Schema IR, DB, Application Service, API 및 Admin UI가 별도의 모델을 갖지 않는다. 하나의 Collection 변경이 전체 경로에 반영돼야 한다.

### 2.3 권한 우회 금지

Admin UI, REST API, Local API 및 Plugin은 동일한 authorization kernel을 사용한다. 내부 API라는 이유로 권한 검사를 생략하지 않는다. 시스템 초기화와 migration 같은 명시적인 system operation만 별도 execution context를 사용할 수 있다.

### 2.4 안전한 기본값

- default deny
- System Identity의 콘텐츠 권한 자동 부여 금지
- 운영 환경의 직접 Schema 변경 잠금 가능
- destructive migration 사전 경고
- 기본 soft delete
- Plugin은 명시적으로 설치 및 활성화

### 2.5 범위보다 완성도 우선

M0부터 M4까지 순서대로 진행한다. 앞 milestone의 완료 조건을 통과하지 않은 상태에서 다음 milestone의 기능을 제품 범위로 편입하지 않는다.

## 3. 확정 기반 조건

### 3.1 실행 및 데이터 경계

```text
XeCMS Instance
└── Workspace 1개
    ├── Site 여러 개
    ├── Identity Realm 여러 개
    └── Content / Media / Plugin
```

- TypeScript 및 Node.js LTS
- PostgreSQL 단일 공식 DB
- 개발·스테이징·운영은 별도 Instance
- Schema Manifest로 환경 간 Schema 승격
- Docker 기반 로컬 PostgreSQL 제공

### 3.2 핵심 보안 경계

- Global Identity는 여러 Realm Membership을 가질 수 있다.
- 인증 정보는 공유할 수 있지만 권한은 Realm별로 독립적이다.
- Authority Level은 수직 관리 서열이다.
- 같은 Level의 Role은 수평 관계이며 서로 관리할 수 없다.
- 관리 권한의 Level은 Grant Provenance로 계산한다.
- Realm Full Access는 명시적으로만 부여한다.

### 3.3 MVP에서 사용하지 않는 복잡성

- Role inheritance 없음
- 명시적 Deny 없음
- 임의 JavaScript policy 없음
- 다중 DB 없음
- Plugin sandbox 및 hot reload 없음
- DAG 콘텐츠 계층 없음

## 4. Milestone 개요

| 단계 | 결과 | 주요 위험 검증 |
|---|---|---|
| M0 | 실행 가능한 Domain Prototype | 모델의 일관성 및 권한 안전성 |
| M1 | Collection 하나를 관통하는 CMS | Schema→DB→API→UI 연결 |
| M2 | 실제 콘텐츠를 운영할 수 있는 Core | Revision, Relation, Hierarchy |
| M3 | XeCMS 고유 권한 플랫폼 | Scope, 동일 레벨, 위임, 설명 가능성 |
| M4 | 콘텐츠 계정과 확장 가능한 CMS | Realm federation, Event, Plugin |

의존 순서는 다음과 같다.

```text
M0 → M1 → M2 → M3 → M4
```

Milestone 내부의 실험 branch는 병렬로 진행할 수 있지만 공식 완료 순서는 유지한다.

## 5. M0 — Domain Prototype

> 상태: 완료 (2026-07-14)

상세 구현 상태와 실행 방법은 [M0 Domain Prototype](./m0-domain-prototype.md)에서 관리한다.

### 5.1 목표

DB와 웹 프레임워크 없이 XeCMS의 핵심 모델을 TypeScript로 표현하고, 가장 위험한 Schema 및 권한 규칙을 빠르게 검증한다.

### 5.2 구현 범위

- canonical Schema IR
- 안정적인 Schema Object ID
- Collection 및 Field definition
- Document Identity와 Revision model
- Subject, Resource, Scope
- Authority Level과 동일 레벨 Role
- Role Binding
- Permission Catalog
- Grant Provenance
- Delegation Policy
- Access Decision과 reason code

### 5.3 필수 시나리오

#### Schema

- Field 이름을 변경해도 동일 ID로 rename을 감지한다.
- Field ID가 사라지면 destructive change 후보로 분류한다.
- 잘못된 Relation target과 중복 Schema ID를 거부한다.

#### Revision

- Published Revision을 유지한 채 새 Draft Revision을 생성한다.
- Relation이 Revision이 아닌 Document ID를 참조한다.
- 삭제된 Document를 일반 조회에서 제외할 수 있다.

#### Authorization

- 높은 Level이지만 Permission이 없는 Role은 작업할 수 없다.
- 같은 Level의 서로 다른 Role은 서로 관리할 수 없다.
- 더 높은 Level도 Scope 밖의 대상은 관리할 수 없다.
- 여러 일반 Role의 기능 Permission은 합산된다.
- 관리 작업은 해당 Permission의 Grant Provenance Level을 사용한다.
- Delegation 범위 밖의 Permission을 하위 Role에 부여할 수 없다.

### 5.4 산출물

```text
packages/schema
packages/core
packages/authorization
examples/domain-prototype
```

### 5.5 완료 조건

- 모든 핵심 모델에 공개 TypeScript 타입이 존재한다.
- Schema validation이 구조화된 error path와 code를 반환한다.
- 권한 판정이 `allowed`, `reasonCode`, `matchedGrants`를 반환한다.
- 동일레벨 및 Grant Provenance 우회 시나리오가 자동화 테스트로 고정된다.
- Domain package가 HTTP, UI 및 PostgreSQL package를 import하지 않는다.
- prototype example을 명령 하나로 실행할 수 있다.

### 5.6 제외

- DB persistence
- HTTP API
- Admin UI
- 실제 credential 인증

## 6. M1 — Vertical Slice

> 상태: 완료 (2026-07-15)  
> Admin 구현 기준: [XeCMS Admin Studio 사양서](./admin-ui-specification.md)
> 실행 및 검증: [M1 로컬 실행 및 검증](./m1-development.md)

### 6.1 목표

Collection 하나가 Schema 정의부터 PostgreSQL, REST API 및 Admin UI까지 관통하는 최초의 실행 가능한 CMS를 만든다.

### 6.2 구현 범위

- 단일 Instance와 Workspace
- System Realm
- System Identity 로그인
- Collection 생성
- text, number, boolean, datetime 기본 Field
- physical table 생성
- 기본 Schema Registry와 Migration 기록
- PostgreSQL CRUD
- Local API
- REST API
- Admin Collection 목록
- Admin Document 목록, 생성, 편집, 삭제
- Docker 기반 개발 환경

### 6.3 기준 사용자 흐름

```text
1. starter 실행
2. PostgreSQL 시작
3. 최초 Owner 생성
4. Admin Studio 로그인
5. Posts Collection 생성
6. title, body, publishedAt Field 추가
7. Migration Preview 확인 및 적용
8. Post 작성
9. REST API로 Post 조회
```

### 6.4 완료 조건

- 빈 환경에서 문서화된 명령만으로 서버와 Admin Studio가 실행된다.
- 최초 Owner bootstrap은 한 번만 가능하다.
- UI에서 만든 Schema가 Schema Registry와 DB table에 일관되게 반영된다.
- destructive change는 승인 없이 적용되지 않는다.
- Admin UI와 REST API의 CRUD 결과가 일치한다.
- 모든 Document 작업이 Application Service를 통과한다.
- 최소한의 authentication, CSRF, session expiration 보호가 동작한다.
- 실패한 migration은 적용 완료로 기록되지 않는다.
- 통합 테스트가 실제 PostgreSQL에서 실행된다.

### 6.5 제외

- Relation
- Revision과 Publish
- 계층형 Collection
- 콘텐츠 Realm
- 일반 Plugin

## 7. M2 — Content Core

> 상태: 완료 (2026-07-15)  
> 구현 계획 및 진행 기록: [M2 Content Core 구현 계획](./m2-implementation-plan.md)  
> 설치·운영·검증: [M2 Content Core 운영 및 검증](./m2-content-core.md)

### 7.1 목표

블로그, 문서 사이트 및 기본 콘텐츠 서비스에 실제로 사용할 수 있는 콘텐츠 관리 기능을 완성한다.

### 7.2 구현 범위

- 여러 Collection
- Singleton
- Component
- text, textarea, number, boolean, datetime, select, enum, JSON
- object, array, relation, upload
- Rich Text의 최소 저장 규격
- Draft와 Published Revision
- Revision History와 Restore
- soft delete와 purge 경계
- Media와 local storage adapter
- tree/forest 기반 계층형 Collection
- Tree View 및 이동·정렬
- Schema diff 및 Migration Preview 개선
- TypeScript type generation

### 7.3 계층형 콘텐츠 필수 규칙

- 자기 자신 또는 자신의 후손 아래로 이동할 수 없다.
- 다른 Collection 문서를 부모로 지정할 수 없다.
- 최대 깊이를 검사한다.
- 이동과 closure table 갱신이 하나의 transaction에서 수행된다.
- 이동 전에 path와 권한 영향 정보를 계산할 수 있다.
- Tree View는 lazy loading을 지원한다.

### 7.4 Revision 필수 규칙

- Published Revision과 Draft Revision이 동시에 존재할 수 있다.
- 편집은 현재 Published 데이터를 직접 덮어쓰지 않는다.
- Publish와 Restore가 감사 가능한 Revision event를 생성한다.
- Relation은 안정적인 Document ID를 유지한다.

### 7.5 완료 조건

- Blog example을 Schema, Content, Media, Draft/Publish를 사용해 실행할 수 있다.
- Page tree를 Admin UI에서 생성, 이동, 정렬할 수 있다.
- 순환 이동과 최대 깊이 초과가 API와 UI 양쪽에서 거부된다.
- Schema Manifest export/import와 type generation이 재현 가능하다.
- 같은 Manifest를 빈 DB에 적용하면 동일한 Schema가 생성된다.
- Revision restore 후에도 Document ID와 Relation이 유지된다.
- Media metadata와 실제 파일의 정합성 검사가 존재한다.

위 조건은 canonical [Blog example](../examples/blog/README.md)과 isolated PostgreSQL·Chromium 여정으로 검증했다. 실제 PostgreSQL 8개, Server integration 17개와 Chromium 전체 Blog 시나리오가 통과했으며 세부 절차와 결과는 [M2 Content Core 운영 및 검증](./m2-content-core.md)에 기록한다.

### 7.6 제외

- versioned hierarchy
- locale별 Publish
- DAG
- 외부 object storage 공식 adapter
- 완전한 Page Builder

## 8. M3 — Authorization Platform

> 상태: 완료 (2026-07-15)  
> 구현 및 검증: [M3 Authorization Platform](./m3-authorization-platform.md)

### 8.1 목표

XeCMS의 핵심 차별점인 계층형 Resource Scope, 동일레벨 Role 및 설명 가능한 권한 판정을 시스템 전체에 적용한다.

### 8.2 구현 범위

- User, Group, Service Account Subject
- 중첩 Group과 Group closure
- Resource tree와 Resource closure
- Permission Catalog
- Realm 소속 Authority Level
- 동일 Level의 복수 Role
- Role Binding과 propagation
- Grant Provenance
- Delegation Policy
- Field read/write permission
- 기간 및 owner/status 기반 최소 Constraint
- 권한 시뮬레이터
- 정책 변경 Audit Log
- policy revision 기반 cache invalidation

### 8.3 필수 보안 시나리오

- 같은 Level의 Content Admin과 Security Admin이 서로를 관리할 수 없다.
- Content Admin은 낮은 Level의 콘텐츠 Role만 권한 범위 안에서 관리할 수 있다.
- 낮은 Role에서 받은 `role.assign`과 높은 일반 Role의 Level을 결합할 수 없다.
- Site A 관리자는 Site B의 낮은 Role을 관리할 수 없다.
- Group을 통해 상속된 Permission의 membership path가 설명에 포함된다.
- 읽을 수 없는 Field가 API 응답에서 제거된다.
- 쓸 수 없는 Field를 포함한 요청은 오류로 거부된다.
- 콘텐츠 tree 이동 전후의 권한 변화를 확인할 수 있다.

### 8.4 Admin UI

- Level별 Role 편집기
- 동일 레벨 Role 추가
- Permission Matrix
- Scope tree 선택기
- Role Binding 편집
- Delegation 범위 편집
- 사용자별 Effective Permission 조회
- 권한 시뮬레이터
- Audit 조회

### 8.5 완료 조건

- 모든 Admin 및 Content API가 authorization kernel을 통과한다.
- 권한 판정 결과가 허용·거부 이유를 일관되게 반환한다.
- Role, Level, Binding 및 Group 변경이 policy revision을 증가시킨다.
- 정책 변경 후 이전 권한 cache가 재사용되지 않는다.
- privilege escalation 및 동일레벨 우회 테스트가 모두 통과한다.
- 권한 시뮬레이터 결과와 실제 API 결과가 일치한다.
- 보안 구조 변경에 actor, target, before, after가 Audit에 남는다.

위 조건은 System Realm의 모든 Admin·Content API, 실제 콘텐츠 Document Resource
projection과 이동 영향 Preview, Admin Scope Tree 및 Chromium 권한 관리 여정으로
검증했다. 누적 Gate는 Unit 269개, PostgreSQL 저장소 11개, Server PostgreSQL
integration 19개와 Chromium M2+M3 시나리오 2개가 통과했으며 세부 보안 경계와
재현 절차는 [M3 Authorization Platform](./m3-authorization-platform.md)에 기록한다.

### 8.6 제외

- explicit Deny
- 완전한 policy language
- Role inheritance
- 임의 JavaScript Constraint

## 9. M4 — Extensible CMS

> 상태: 완료 — M4-A·M4-B·M4-C1~M4-C5 (2026-07-15)
> 구현 계획: [M4 구현 계획](./m4-implementation-plan.md)  
> 최종 묶음: [M4-C5 Operations & Distribution](./m4c5-operations-distribution.md)

### 9.1 목표

CMS 운영 계정과 콘텐츠 애플리케이션 계정을 함께 지원하고, 코어를 수정하지 않고 기능을 추가할 수 있는 최소 확장 플랫폼을 완성한다.

### 9.2 콘텐츠 계정 범위

- auth-enabled Collection
- Content Realm
- Global Identity
- Realm Membership
- System Identity의 Content Realm 로그인
- 명시적 및 JIT Membership provisioning
- Realm별 Profile Document
- Realm별 Role, Group 및 Binding
- 명시적인 Realm Full Access

### 9.3 System Identity 규칙

- 동일한 인증 정보로 Content Realm에 로그인할 수 있다.
- Content Realm Membership이 없으면 Realm 정책에 따라 거부하거나 JIT 생성한다.
- System Role과 Authority Level은 Content Realm으로 전파하지 않는다.
- Content Permission은 별도의 Role Binding으로 부여한다.
- Full Access는 대상 Realm에서 명시적으로 부여한다.

### 9.4 운영 및 확장 범위

- lifecycle Hook
- transactional outbox
- Durable Event와 Worker
- User/Identity/Membership 관리
- session, 서비스 계정과 API key 관리
- System/Workspace/Site 설정
- 통합 Audit, retention과 정리 preview
- trusted npm Plugin
- Plugin Manifest
- server extension entry
- Admin extension entry 및 최소 UI slot
- namespaced Field, Permission 및 Route
- Plugin Migration
- CLI
- 공식 minimal/blog/community starter

### 9.5 완료 조건

- Community example에서 auth-enabled `members` Collection으로 가입 및 로그인할 수 있다.
- System Identity가 같은 인증 정보로 Community Realm에 로그인할 수 있다.
- System Identity에 콘텐츠 Role이 없으면 보호된 콘텐츠 작업이 거부된다.
- 콘텐츠 Role을 부여하면 해당 Scope의 작업만 허용된다.
- Realm Full Access가 대상 Realm에서만 동작한다.
- 다른 Realm과 Instance 보호 객체에는 Full Access가 전파되지 않는다.
- Event가 DB commit 이후 전달되고 실패 시 재시도된다.
- 운영자가 Identity, Membership, session과 API key를 권한 범위 안에서 관리할 수 있다.
- Site 범위 설정과 권한이 다른 Site에 전파되지 않는다.
- 게시, 계정, 권한, Full Access와 Worker 이력을 통합 Audit에서 조사할 수 있다.
- retention과 복구 작업이 preview, Audit과 실패 복구 경계를 가진다.
- 예제 Plugin 하나가 Field 또는 Admin UI extension을 등록한다.
- 호환되지 않는 Plugin 설치가 거부된다.
- Plugin 제거 전 dependency와 잔존 데이터를 검사한다.
- starter로 새 프로젝트를 생성해 문서화된 절차로 실행할 수 있다.
- backup을 빈 Instance에 restore하고 `xecms doctor`로 무결성을 확인할 수 있다.

### 9.6 제외

- untrusted Plugin sandbox
- Plugin marketplace
- Plugin hot reload
- 외부 개발자의 자동 Plugin 심사·서명 체계

## 10. M0–M4 총 포함 범위

- PostgreSQL
- Collection, Singleton, Component
- 기본 Field, Relation 및 Media
- tree/forest 기반 계층형 Collection
- Schema Registry, diff, migration 및 Manifest
- Local API와 REST API
- Query AST와 cursor pagination
- Admin Studio 로그인과 콘텐츠 UI
- System Realm과 auth-enabled Content Realm
- Global Identity와 다중 Realm Membership
- System Identity의 Content Realm 로그인
- 독립적인 Realm 권한 판정
- 명시적인 Realm Full Access
- Subject, Group 및 Resource Scope
- Authority Level과 동일 레벨 Role
- Role Binding, Permission Catalog 및 Grant Provenance
- Delegation Policy와 Field Permission
- Draft, Publish 및 Revision
- local media storage
- Hook, Durable Event 및 Worker
- trusted Plugin 최소 규격
- generated types, CLI 및 starter
- Docker 개발 환경
- 권한 시뮬레이터와 Audit
- 사용자·Identity·Membership 운영 관리
- session, 서비스 계정과 API key 관리
- Site와 System/Workspace 설정
- 통합 Audit, retention과 운영 복구

## 11. M0–M4 제외 범위

- Page Builder
- GraphQL
- SaaS 과금
- 완전한 Multi-tenancy 및 여러 Workspace
- 실시간 공동 편집
- Plugin Marketplace
- untrusted Plugin sandbox
- 다중 DB 공식 지원
- 복잡한 승인 Workflow
- DAG 콘텐츠 계층
- versioned hierarchy
- locale별 독립 게시
- explicit Deny
- 완전한 Policy Language
- Role inheritance

제외 기능을 위한 확장 지점은 설계할 수 있지만 MVP 완료 조건에는 포함하지 않는다.

## 12. 공통 품질 기준

### 12.1 테스트

- Domain unit test
- PostgreSQL integration test
- REST API contract test
- Admin 핵심 흐름 E2E test
- migration 재현 및 실패 test
- authorization escalation regression test
- Plugin compatibility test

### 12.2 오류 형식

외부 인터페이스의 오류는 최소한 다음 정보를 제공한다.

```ts
interface XeCmsError {
  code: string;
  message: string;
  path?: Array<string | number>;
  details?: unknown;
  requestId?: string;
}
```

내부 stack trace 또는 credential 정보는 외부 응답에 노출하지 않는다.

### 12.3 관측성과 감사

- 모든 요청에 request ID 부여
- migration과 schema apply 기록
- 로그인 성공·실패 기록
- 보안 구조 변경 Audit
- background job 상태 및 재시도 횟수
- 구조화 로그

### 12.4 보안

- password는 검증된 password hashing 구현 사용
- session cookie는 HttpOnly, Secure 및 적절한 SameSite 설정
- CSRF 보호
- credential과 콘텐츠 Profile 분리
- secret을 Schema Manifest나 일반 로그에 포함하지 않음
- permission 변경 시 기존 session의 policy cache 무효화
- bootstrap Owner 생성 경로 재사용 금지

### 12.5 개발 경험

- 설치부터 첫 콘텐츠 작성까지 공식 문서 제공
- 오류 메시지에 해결 가능한 원인과 경로 포함
- `xecms doctor`로 런타임, DB, migration, plugin 및 schema drift 검사
- generated type이 실제 Schema Revision과 연결됨
- example과 starter는 CI에서 실행 검증

## 13. MVP 최종 사용자 시나리오

MVP는 다음 시나리오를 한 설치 환경에서 통과해야 한다.

```text
1. 개발자가 XeCMS 프로젝트를 생성한다.
2. 최초 Owner를 만들고 Admin Studio에 로그인한다.
3. 운영 Identity를 만들고 session/API key를 발급·폐기한다.
4. Workspace 설정과 Site를 만들고 Site 범위 관리자를 지정한다.
5. UI에서 Posts와 Pages Collection을 생성한다.
6. Migration Preview를 확인하고 적용한다.
7. Page tree와 Draft Post를 작성한다.
8. Post를 게시하고 REST API로 조회한다.
9. Content Admin과 Security Admin을 같은 Level에 생성한다.
10. 두 관리자가 서로를 관리할 수 없음을 확인한다.
11. Site 범위의 Editor Role을 사용자에게 부여한다.
12. Community Realm과 Members Collection을 만든다.
13. CMS 운영 Identity로 Community Realm에 로그인한다.
14. 별도 콘텐츠 Role이 없을 때 보호 작업이 거부된다.
15. Role을 부여한 후 해당 Scope의 작업만 수행한다.
16. Plugin을 설치해 새 Field 또는 Admin UI 기능을 활성화한다.
17. 통합 Audit에서 게시, 계정 정지, 권한 변경, Full Access와 Worker 내역을 확인한다.
18. `xecms doctor`를 통과하고 backup을 빈 Instance에 restore한다.
```

## 14. MVP 완료 정의

다음 조건을 모두 만족하면 MVP를 완료한 것으로 판단한다.

- M0부터 M4까지 각 완료 조건을 충족한다.
- 빈 환경 설치와 upgrade 절차가 문서화되고 자동 테스트된다.
- 공식 starter 중 하나로 최종 사용자 시나리오를 재현할 수 있다.
- 치명적 데이터 손실 또는 권한 상승이 가능한 알려진 결함이 없다.
- Schema Manifest와 Migration으로 환경을 재현할 수 있다.
- backup 및 restore 최소 절차가 검증된다.
- Public API와 Plugin API에 버전 정책이 선언된다.
- 운영에 필요한 로그, Audit 및 health endpoint가 존재한다.
- 제외 범위가 문서와 UI에서 완료 기능처럼 노출되지 않는다.

## 15. 후속 상세 설계

각 milestone 착수 전에 다음 상세 문서를 작성한다.

```text
M0
├── schema-ir-specification.md
├── document-revision-specification.md
└── authorization-evaluation-specification.md

M1
├── database-schema-specification.md
├── migration-specification.md
└── api-query-specification.md

M2
├── content-hierarchy-specification.md
└── media-specification.md

M3
├── authorization-admin-specification.md
└── authorization-cache-specification.md

M4
├── authentication-session-specification.md
├── plugin-specification.md
└── event-worker-specification.md
```
