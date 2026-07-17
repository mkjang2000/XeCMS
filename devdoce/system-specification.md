# XeCMS 시스템 사양

## 1. 문서 역할

이 문서는 XeCMS 현재 제품과 코드가 따라야 하는 상위 불변 규칙을 정의한다.
완료된 milestone의 작업 이력은 [릴리스 이력](./release-history.md), 실행 방법은
[개발 가이드](./development-guide.md)와 [운영 Runbook](./operations-runbook.md)에서 관리한다.

## 2. 제품 정의

XeCMS는 UI의 편리함과 TypeScript 기반 확장성을 함께 제공하는 범용 CMS다.

사용자는 다음 순서로 필요한 만큼 복잡성을 선택할 수 있다.

```text
Admin Studio
→ 선언형 Manifest
→ REST/TypeScript Client
→ Plugin과 Custom Admin Apps
```

초급 기능이 고급 기능으로 이동할 때 버려지는 별도 모델이 되면 안 된다.
Schema, Content, Authorization과 Application Service는 모든 진입점에서 공유한다.

### 2.1 현재 범위

- PostgreSQL 기반 Schema Registry와 physical migration
- Collection, Singleton, Component, Block과 다양한 Field
- Document, immutable Revision과 공개 snapshot
- Relation, Media와 계층형 콘텐츠
- System/Content Identity Realm
- Authority Level, Role, Binding과 Resource Scope RBAC
- Field-level permission, condition과 grant provenance
- Admin Studio
- Hook, durable event와 Worker
- Unified Audit와 Retention
- Site와 Workspace 설정
- trusted Plugin SDK
- CLI, doctor, backup/restore

### 2.2 현재 제외 범위

- 완전한 SaaS multi-workspace tenancy
- PostgreSQL 이외의 공식 Database Adapter
- arbitrary JavaScript/SQL policy
- untrusted Plugin sandbox와 marketplace
- 외부 Object Storage 제품화
- PITR/WAL, zero-downtime migration orchestration
- 완전한 OIDC/SAML 제품화
- 범용 웹사이트 또는 모바일 앱 Builder

## 3. 기술 원칙

### 3.1 언어와 런타임

- TypeScript를 기본 언어로 사용한다.
- Node.js 22.13 이상을 지원한다.
- ESM을 사용한다.
- PostgreSQL을 canonical persistent store로 사용한다.
- 브라우저 UI는 React와 동일 origin API를 기본으로 한다.

### 3.2 계층 경계

```text
Admin / REST / CLI / Plugin / Custom Admin App
                        ↓
               Application Service
                        ↓
       Domain Kernel / Authorization Kernel
                        ↓
                 Store Interface
                        ↓
                    PostgreSQL
```

UI, HTTP route와 Plugin은 DB를 직접 수정하지 않는다. 같은 작업은 어느 진입점에서
호출되더라도 같은 validation, authorization, transaction, audit와 event 규칙을 사용한다.

### 3.3 안전한 기본값

- 알 수 없는 Permission, Action, Widget과 Plugin extension은 fail-closed한다.
- 상태 변경 요청은 session audience, CSRF와 optimistic concurrency를 검증한다.
- 민감 작업은 재인증을 요구할 수 있다.
- destructive 작업은 preview와 명시적 confirmation을 우선한다.
- password, session token, API key와 secret 원문을 응답·로그·Audit에 남기지 않는다.

## 4. 시스템 경계

```text
Instance
└── Workspace
    ├── Sites
    ├── System Realm
    ├── Content Realms
    ├── Schema
    ├── Collections
    │   └── Documents / Revisions / Media / Hierarchy
    ├── Authorization Policies
    ├── Plugins
    └── Operations
```

현재 제품은 하나의 기본 Workspace를 사용하지만 모든 주요 record는 장기적인
Workspace 격리 경계를 유지한다.

Site는 public delivery와 콘텐츠 묶음의 운영 경계다. Site가 Collection을 포함한다고 해서
새로운 Schema나 Identity를 복제하지 않는다.

## 5. Schema

### 5.1 Canonical IR

Schema는 versioned canonical IR로 표현한다.

```ts
interface SchemaIrV1 {
  format: "xecms.schema";
  formatVersion: 1;
  collections: CollectionDefinition[];
  components?: ComponentDefinition[];
}
```

Collection, Field, Relation과 Component는 이름과 별개의 stable object ID를 가진다.
이름 변경은 물리 객체 삭제·재생성이 아니라 rename으로 처리할 수 있어야 한다.

### 5.2 Schema 변경 흐름

```text
Edit Draft
→ Validate
→ Preview Diff/Migration
→ Apply
→ Active Revision
```

- Draft는 active revision을 base로 하는 optimistic version을 가진다.
- Apply는 preview에서 계산한 plan과 draft version을 다시 검증한다.
- destructive 변경은 별도 승인을 요구한다.
- migration은 forward-only이며 transaction 실패 시 registry와 physical state를 함께 rollback한다.
- Manifest import/export는 canonical serialization과 SHA-256 hash를 사용한다.

### 5.3 기본 콘텐츠 타입

- Collection: 여러 Document
- Singleton: 최대 하나의 활성 Document
- Component: 재사용 가능한 구조
- Block: 순서가 있는 heterogeneous content

Field는 text, rich text, number, boolean, date/datetime, select, JSON, object,
array, component, blocks, relation과 media를 포함한다.

## 6. Document와 Revision

Document ID는 논리적 identity이며 Revision은 immutable snapshot이다.

```text
Document Identity
├── current draft revision
├── published revision
├── lifecycle state
└── deletion state
```

상태 축:

- Publication: unpublished/published
- Lifecycle: active/archived
- Deletion: present/soft-deleted

Publish는 현재 draft를 공개 snapshot으로 지정한다. 이후 draft 편집은 다시 publish할 때까지
공개 데이터에 영향을 주지 않는다.

Revision restore는 과거 Revision을 수정하지 않고 그 내용을 새 draft Revision으로 복제한다.
Purge는 Document identity, Revision, public projection과 허용된 relation을 제거하는
명시적 destructive command다.

모든 mutation은 expected version을 사용해 stale write를 거부한다.

## 7. Relation, Media와 Hierarchy

### 7.1 Relation

- 대상 Collection과 cardinality를 Schema가 정의한다.
- 참조 무결성은 Application과 DB 양쪽에서 보호한다.
- 삭제 정책은 restrict, nullify 또는 명시적으로 지원되는 cascade다.
- Relation label은 Schema와 presentation rule에서 결정하며 ID를 숨기지 않는다.

### 7.2 Media

- metadata와 document reference는 PostgreSQL에 저장한다.
- byte는 Storage Adapter에 저장한다.
- 업로드 크기와 MIME allowlist를 서버에서 검증한다.
- DB와 storage 불일치를 consistency 검사로 탐지한다.
- backup/restore는 DB와 media를 같은 복구 시점으로 취급한다.

### 7.3 계층형 Document

계층을 활성화한 Collection은 parent, sibling position, depth와 path를 관리한다.

필수 규칙:

- cycle 금지
- 자신의 descendant 아래로 이동 금지
- 선택적 max depth
- sibling position 정규화
- move optimistic structure version
- permission inheritance를 사용하는 경우 Authorization Resource tree와 동기화
- 이동 전 권한 영향 preview

`children` Scope는 현재 리소스를 제외한 descendant만 포함한다.
현재와 하위를 모두 포함하려면 `self-and-children`을 사용한다.

## 8. Identity와 Realm

### 8.1 Global Identity

Global Identity는 한 사람 또는 service의 전역 credential identity다.
실제 로그인과 권한은 Realm Membership을 통해 분리한다.

```text
Global Identity
├── System Realm Membership
└── Content Realm Membership(s)
```

### 8.2 System Realm

CMS 운영 계정, service identity와 Admin session을 관리한다.
System 계정이라는 이유만으로 Content Realm 권한을 획득하지 않는다.

### 8.3 Content Realm

서비스 사용자와 콘텐츠 계정의 인증·Profile·Role을 독립적으로 관리한다.
Content session cookie, CSRF와 audience는 System session과 분리한다.

System Identity가 Content Realm에 로그인하려면 해당 Realm에 Membership이 있어야 한다.
Provisioning은 명시적 또는 Schema가 허용한 JIT 방식만 사용한다.

### 8.4 Realm Full Access

Realm Full Access는 대상 Realm에서 명시적으로 부여하는 protected binding이다.
다른 Realm, System Workspace 또는 Instance 보호 객체로 전파되지 않는다.

## 9. Authorization

### 9.1 핵심 요소

- Subject: user, group, service account
- Authority Level: 관리 서열의 수직축
- Role: 같은 Level에서 서로 다른 책임을 표현하는 수평축
- Permission: 수행 가능한 action
- Resource: 권한 판정 대상
- Binding: Subject에 Role과 Scope를 연결
- Delegation: 다른 Role에 넘길 수 있는 Permission 집합
- Constraint: owner, status 등 실행 시 context 조건
- Grant Provenance: 허용 결정을 만든 Binding/Role/Level 경로

### 9.2 Scope

```text
self               현재 Resource만
children           현재를 제외한 모든 descendant
self-and-children  현재와 모든 descendant
```

Binding은 Realm, Resource ID, propagation과 선택적 유효 기간/constraint를 가진다.

### 9.3 일반 Permission

일반 작업은 Subject의 직접/그룹 Binding을 합산한다.

```text
Realm 일치
→ Subject 활성
→ Binding 활성
→ Scope 적용
→ Constraint 충족
→ Role Permission 포함
→ Allow
```

명시적 Deny는 현재 지원하지 않는다. 허용 근거가 없으면 거부한다.

### 9.4 관리 Permission

Role, Binding, Identity와 Authority Level을 관리하는 작업은 일반 Permission 외에
target hierarchy context를 요구한다.

- 자신을 관리 대상으로 삼을 수 없다.
- protected Subject/Role/Binding은 일반 관리 대상이 아니다.
- 같은 Level의 Role끼리는 관리 관계가 없다.
- 대상은 actor의 해당 Permission grant보다 낮아야 한다.
- actor Scope가 대상 Scope 전체를 포함해야 한다.
- 대상 Role의 Permission은 actor의 delegation 범위를 넘을 수 없다.

Level이 높아도 해당 Permission이 없으면 작업할 수 없다.
서열은 Subject의 전체 최고 Role이 아니라 해당 관리 Permission의 grant provenance로 계산한다.

### 9.5 Owner

Owner는 protected 최고 Level Role과 Binding을 가진다.

- Owner 역할 자체는 일반 Role로 수정하거나 위임할 수 없다.
- `authorization.manage`와 `identity.owner.transfer`는 protected non-delegatable permission이다.
- Owner 이전은 대상 Subject hierarchy, 현재 password와 사유를 검증한다.
- Owner가 아닌 Role은 Owner와 같은 Level 또는 protected authority를 만들 수 없다.

### 9.6 Field-level Permission

읽기 결과는 허용된 field만 포함한다. 쓰기 요청은 허용되지 않은 field가 포함되면
서버에서 거부한다. UI의 hidden/read-only 표시는 보조 수단이며 보안 경계가 아니다.

### 9.7 Explainability

모든 Access Decision은 최소한 다음을 표현한다.

- allowed
- action
- reason code
- evaluated resource/scope
- actor/target level
- matched grants
- policy revision

## 10. API와 Query

- REST DTO는 `packages/contracts`에서 versioned contract로 관리한다.
- TypeScript client는 같은 DTO를 사용한다.
- mutation은 CSRF와 expected version/revision을 요구한다.
- 오류는 status, stable code, message, issues와 request ID를 가진 problem details를 사용한다.

현재 Document list는 page/pageSize/state를 기본으로 제공한다.
Custom Admin Apps를 위해 filter/sort/projection/cursor와 authorization scope를 포함하는
안전한 Query Contract를 후속 구현한다.

## 11. Admin Studio

Admin Studio는 XeCMS 자체를 관리하는 개발자·시스템 관리자용 UI다.

주요 영역:

- Schema와 migration
- Content, Revision, Media와 Hierarchy
- Identity Realm, User, Group과 session
- Authority Level, Role, Binding과 simulator
- Site와 settings
- Job, Audit, Retention과 diagnostics
- Plugin lifecycle

`Basic / Standard / Advanced`는 표시량만 조절한다. 실제 Permission을 부여하거나
직접 URL 접근을 차단하는 수단이 아니다.

Navigation과 action 표시는 장기적으로 실제 effective permission을 반영해야 하며,
서버 authorization은 UI 표시 여부와 무관하게 항상 수행한다.

서비스 운영자용 별도 UI는 [Custom Admin Apps](./custom-admin-apps-specification.md)에서 정의한다.

## 12. Hook, Event와 Worker

동기 Hook은 document transaction 안에서 validation 또는 mutation에 참여하며
시간 제한과 안정적인 순서를 가져야 한다.

비동기 side effect는 transactional outbox를 사용한다.

```text
Application transaction
→ Domain event + Outbox
→ Lease Worker
→ Handler
→ delivered / retry / dead
```

Handler는 idempotency key를 사용해야 한다. Worker는 lease, retry backoff,
max attempts와 dead delivery 운영 UI를 제공한다.

## 13. Plugin

Plugin은 배포 artifact에 포함된 trusted TypeScript package다.

Manifest는 다음을 선언할 수 있다.

- namespaced Permission
- JSON storage Field
- Server Route
- Document Hook
- Durable Event Handler
- Admin extension slot
- Migration과 data table

Plugin install/enable/disable/uninstall은 preview/apply plan을 사용한다.
dependency, Schema usage, Permission usage, migration과 data 처리 방식을 검사한다.

현재는 untrusted code sandbox, marketplace와 runtime remote bundle을 지원하지 않는다.

## 14. Audit, Retention과 Operations

- Security, Identity, Content, Schema, Authorization, Settings, Site, Worker,
  Media, Retention과 Plugin 변경을 Audit한다.
- Audit는 cursor 조회와 export를 지원한다.
- 민감정보는 source 단계와 unified projection 단계에서 redaction한다.
- Retention은 candidate preview, exact digest와 apply transaction을 사용한다.
- liveness는 process 생존, readiness는 DB/migration/storage/plugin 상태를 판정한다.
- migration은 forward-only다.
- backup은 DB dump, media archive와 versioned manifest를 하나의 세트로 취급한다.

상세 절차는 [운영 Runbook](./operations-runbook.md)을 따른다.

## 15. 확정 불변 규칙

1. 모든 진입점은 같은 Application Service를 사용한다.
2. UI 표시 조건은 Permission을 부여하지 않는다.
3. Realm 사이에는 명시적 Membership 또는 bridge 없이 권한이 전파되지 않는다.
4. System Identity라는 사실만으로 Content Permission을 얻지 않는다.
5. 같은 Authority Level의 서로 다른 Role은 수평 관계다.
6. 높은 Level도 Permission과 Scope 없이는 작업할 수 없다.
7. 관리 작업은 target context와 delegation을 검증한다.
8. protected security object는 일반 Role로 관리할 수 없다.
9. `children`은 scope root를 포함하지 않는다.
10. Document Revision과 published snapshot은 immutable하다.
11. 상태 변경은 optimistic concurrency와 audit 경계를 가진다.
12. 알 수 없는 extension과 action은 fail-closed한다.
13. secret 원문은 응답, 로그, Audit와 backup manifest에 노출하지 않는다.
14. Schema와 Plugin lifecycle은 preview 후 apply한다.
15. Access Decision은 판정 이유와 grant provenance를 제공한다.
