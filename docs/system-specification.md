# XeCMS 시스템 사양서

> 상태: Draft v0.2 — 기반 아키텍처 결정 확정  
> 기준일: 2026-07-14  
> 목적: XeCMS의 제품 방향, 핵심 도메인, 권한 모델 및 초기 구현 범위를 정의한다.

## 1. 제품 개요

XeCMS는 개발자 중심의 범용 CMS다. 처음 CMS를 사용하는 개발자는 웹 기반 Admin Studio에서 콘텐츠 모델과 권한을 구성할 수 있고, 숙련된 개발자는 선언형 스키마, CLI, SDK, hook, plugin을 사용해 시스템을 확장할 수 있다.

XeCMS가 지향하는 사용 흐름은 다음과 같다.

```text
Admin Studio
    ↓
Schema Manifest / CLI
    ↓
SDK / Hook / Custom API
    ↓
Plugin / Adapter
```

상위 단계로 이동하더라도 이전 단계에서 만든 설정을 버리거나 다시 작성하지 않아야 한다.

### 1.1 핵심 목표

- 범용적인 구조화 콘텐츠 관리
- 개발자에게 친숙한 설치 및 개발 경험
- 웹 UI에서 수행 가능한 스키마·콘텐츠·권한 관리
- 계층형 콘텐츠를 일급 기능으로 지원
- 넓고 세밀한 RBAC 제공
- 수직적인 권한 레벨과 동일 레벨의 수평 역할 분화 지원
- CMS 운영 계정과 콘텐츠 애플리케이션 계정에 같은 권한 엔진 적용
- 코어를 수정하지 않고 기능을 교체하거나 확장할 수 있는 플러그인 구조
- 셀프호스팅을 우선하되 향후 관리형 서비스로 확장 가능한 구조

### 1.2 주요 대상 사용자

| 사용자 | 주요 사용 방식 |
|---|---|
| CMS 입문 개발자 | Admin Studio에서 스키마, 콘텐츠, 권한 구성 |
| 일반 개발자 | CLI, manifest, 생성된 타입과 SDK 사용 |
| 고급 개발자 | hook, custom field, custom API 작성 |
| 확장 개발자 | plugin, adapter, Admin UI extension 개발 |
| 운영 개발자 | 배포, migration, worker, audit, backup 관리 |

비개발자를 배제하지는 않지만, 초기 제품의 최소 사용자는 개발 환경과 API의 기본 개념을 이해하는 개발자로 정의한다.

## 2. 제품 설계 원칙

### 2.1 하나의 기능, 여러 진입점

Admin UI, CLI, SDK 및 외부 API는 가능한 한 동일한 application service를 사용한다.

```text
Admin UI ─┐
CLI ──────┼── Application Service ── Domain ── Database
SDK ──────┤
REST API ─┘
```

Admin UI만 사용할 수 있는 숨겨진 기능을 만들지 않는다.

### 2.2 초급 기능이 막다른 길이 되지 않음

UI에서 만든 스키마는 다음 작업으로 자연스럽게 이어져야 한다.

- schema diff 확인
- migration 미리보기 및 적용
- manifest export/import
- TypeScript 타입 생성
- Git 버전 관리
- 다른 환경으로 승격

### 2.3 코어와 확장의 명확한 경계

콘텐츠, 스키마, 권한 판정처럼 데이터 무결성에 직접 관련된 기능은 코어에 둔다. 에디터, 검색, 외부 스토리지, 메일, 페이지 빌더처럼 교체 가능한 기능은 plugin 또는 adapter로 제공한다.

### 2.4 예측 가능성과 설명 가능성

- DB 변경 전에 migration 계획을 표시한다.
- hook 실행 순서와 transaction 경계를 명시한다.
- 권한 결과에 허용·거부 이유와 상속 경로를 포함한다.
- 플러그인 호환성과 충돌을 설치 전에 검사한다.
- 파괴적 변경은 명시적으로 승인하도록 한다.

### 2.5 점진적 복잡성 공개

기본 UI는 일반적인 Role 목록과 콘텐츠 편집 화면으로 보인다. 동일 레벨 역할, delegation policy, 조건부 권한 같은 고급 개념은 필요할 때 활성화한다.

## 3. 기술 방향

### 3.1 기본 언어

서버, Admin UI, CLI, SDK 및 기본 플러그인은 TypeScript를 사용한다.

TypeScript를 선택하는 이유는 다음과 같다.

- 서버와 Admin UI 사이의 타입 공유
- 스키마에서 API 타입 및 SDK 생성
- JavaScript/TypeScript 플러그인의 접근성
- 웹 생태계 활용
- 단일 언어 기반의 개발 경험

### 3.2 런타임과 배포

- 공식 서버 기준 런타임: Node.js LTS
- 런타임 고유 기능은 infrastructure adapter 뒤에 격리
- Bun 기반 단일 실행 파일은 선택적 배포 수단으로 검토
- CPU 집약 작업은 worker로 분리하고 필요할 때 Rust/WASM/native implementation으로 교체

### 3.3 데이터베이스

초기 공식 데이터베이스는 PostgreSQL로 한정한다.

- 일반 필드: typed column
- 관계: foreign key 또는 junction table
- blocks 및 rich-text: JSONB
- 계층 조회: closure table
- durable event: transactional outbox

다중 DB 지원은 초기 범위에서 제외하되 database boundary를 유지한다.

## 4. 상위 시스템 구조

```text
┌────────────────────────────────────────────────┐
│ Admin Studio                                   │
│ Content · Schema · Access · API · Audit        │
├────────────────────────────────────────────────┤
│ Public Interfaces                              │
│ REST · Local API · CLI · Generated Client      │
├────────────────────────────────────────────────┤
│ Application Services                           │
│ Document · Schema · Identity · Media · Workflow│
├────────────────────────────────────────────────┤
│ Extension Runtime                              │
│ Plugin · Hook · Field · Adapter · Admin Slot   │
├────────────────────────────────────────────────┤
│ Content & Authorization Kernel                 │
│ Schema · Query · Access · Revision · Event     │
├────────────────────────────────────────────────┤
│ Infrastructure                                 │
│ PostgreSQL · Storage · Queue · Cache · Mail    │
└────────────────────────────────────────────────┘
```

Kernel은 HTTP 및 Admin UI 구현을 알지 않는다. Admin UI는 DB에 직접 접근하지 않는다.

### 4.1 Instance, Workspace, Site 및 Realm 경계

초기 리소스 경계는 다음으로 확정한다.

```text
XeCMS Instance
└── Workspace 1개
    ├── Site 여러 개
    ├── Identity Realm 여러 개
    ├── Collection / Singleton
    ├── Media
    └── Plugin Configuration
```

- MVP에서 하나의 XeCMS Instance는 하나의 Workspace만 가진다.
- 하나의 Workspace는 여러 Site를 가질 수 있다.
- Realm은 Workspace에 속하며 Role Binding의 Resource Scope로 특정 Site에 대한 권한을 제한한다.
- 개발, 스테이징 및 운영 환경은 하나의 DB 안에 Environment row로 섞지 않고 각각 별도 XeCMS Instance로 운영한다.
- 환경 사이의 스키마 승격은 Schema Manifest와 Migration으로 수행한다.
- 여러 Workspace와 완전한 tenant isolation은 향후 확장하되 모든 주요 데이터에 Workspace 경계를 보존한다.

이 구조에서 Site는 콘텐츠 및 권한 Resource이고, Realm은 인증 Profile과 권한 체계를 격리하는 보안 경계다. Site와 Realm은 동일한 개념이 아니다.

## 5. 콘텐츠 모델

### 5.1 Collection

동일한 스키마를 가진 여러 문서를 관리한다.

```text
posts
products
categories
members
```

### 5.2 Singleton

사이트 설정이나 내비게이션처럼 하나만 존재하는 문서를 관리한다. 내부적으로 Collection과 같은 document engine을 사용하되 cardinality를 1로 제한한다.

### 5.3 Component

여러 스키마에서 재사용할 수 있는 필드 묶음이다.

```text
seo
address
author-profile
button-link
```

### 5.4 Block

문서 내부에서 타입과 순서를 조합하는 콘텐츠 단위다.

```text
content
├── hero
├── rich-text
├── image-gallery
└── call-to-action
```

### 5.5 초기 필드 타입

- text
- textarea
- number
- boolean
- date / datetime
- select / enum
- json
- relation
- upload
- object
- array
- component
- blocks
- rich-text

필드는 validation, access, admin UI 및 storage 설정을 가질 수 있다.

```ts
interface FieldDefinition {
  type: string;
  name: string;
  label?: string;
  required?: boolean;
  unique?: boolean;
  localized?: boolean;
  defaultValue?: unknown;
  validation?: ValidationRule[];
  access?: FieldAccessPolicy;
  admin?: AdminFieldOptions;
  storage?: StorageOptions;
}
```

## 6. 계층형 콘텐츠

계층 구조는 특정 Page 타입에 종속되지 않는 collection capability다. 모든 collection은 필요에 따라 계층 기능을 활성화할 수 있다.

```ts
defineCollection({
  name: "pages",
  hierarchy: {
    enabled: true,
    maxDepth: 10,
    ordering: "manual",
    slugPath: true,
    permissionInheritance: true,
  },
  fields: [],
});
```

### 6.1 초기 계층 모델

- 문서당 부모 하나를 갖는 tree 또는 forest
- collection 하나에 여러 root 허용
- 같은 collection 내부에서만 부모 지정
- 여러 부모를 갖는 DAG는 초기 범위에서 제외

### 6.2 지원 작업

- root, parent, children, siblings 조회
- ancestors, descendants, subtree 조회
- breadcrumb 생성
- node 이동
- 형제 순서 변경
- subtree 복제, export, import
- subtree 삭제 또는 자식 승격

트리 이동은 일반 document patch가 아닌 전용 command로 수행한다.

```ts
await xecms.tree.move({
  collection: "pages",
  documentId: "product-a",
  newParentId: "archive-2026",
  position: 0,
});
```

### 6.3 무결성 규칙

- 자신을 부모로 지정할 수 없다.
- 자신의 후손 아래로 이동할 수 없다.
- collection 경계를 넘어 부모를 지정할 수 없다.
- 설정된 최대 깊이를 초과할 수 없다.
- 이동 전후 범위의 권한을 검사한다.
- 같은 부모 아래 slug 또는 ordering 충돌을 검사한다.
- 이동과 closure 갱신은 하나의 transaction에서 수행한다.

### 6.4 저장 모델

문서 테이블에 현재 위치를 저장하고 closure table로 조상 관계를 색인한다.

```text
xecms_<collection>
├── id
├── parent_id
├── sort_key
├── depth
├── slug
└── ...

xecms_tree_closure
├── hierarchy_id
├── ancestor_id
├── descendant_id
└── depth
```

### 6.5 Admin Studio

- table view와 tree view 전환
- drag-and-drop 이동
- keyboard 기반 이동
- 현재 위치에서 자식 생성
- lazy loading
- breadcrumb
- 검색 결과의 트리 위치 표시
- 일괄 이동
- 이동에 따른 URL 및 권한 변화 미리보기

### 6.6 URL 경로

`slugPath`를 활성화한 경우 각 문서는 slug segment를 소유하며 전체 path는 계층에서 파생한다.

```text
/products/product-a
```

- 형제 사이 slug는 고유해야 한다.
- 문서 ID는 path와 독립적이다.
- 부모 이동 시 후손 path를 갱신한다.
- 이전 path를 redirect로 보존할 수 있도록 event를 발생시킨다.

## 7. 스키마 관리

스키마의 실행 시 단일 원천은 DB 기반 Schema Registry다. 버전 관리와 환경 이동에는 선언형 Schema Manifest를 사용한다.

```text
Admin UI / Config SDK
        ↓
Schema Draft
        ↓
Diff & Migration Preview
        ↓
Schema Registry
        ↓
Manifest Export / Generated Types
```

### 7.1 Schema Registry

- 모든 변경에 schema revision 생성
- 변경한 subject와 시간 기록
- 이전 revision과 diff 저장
- 적용된 migration 기록
- optimistic revision conflict 검사
- 문서 revision이 당시 schema revision을 참조

### 7.2 Schema Manifest

기본 파일명은 `xecms.schema.json`으로 한다.

```bash
xecms schema diff
xecms schema apply
xecms schema export
xecms generate types
```

운영 환경에서는 Admin Studio의 직접 schema 변경을 잠그고 manifest apply만 허용할 수 있다.

### 7.3 안정적인 Schema Object ID

Collection, Field, Relation, Component 및 Block type은 사람이 수정하는 `name`과 별개로 변경되지 않는 내부 ID를 가진다.

```ts
interface SchemaObject {
  id: string;
  name: string;
}
```

```ts
{
  id: "fld_01K...",
  name: "title",
  type: "text"
}
```

- 이름 변경은 동일 ID의 rename으로 감지한다.
- ID가 사라지고 새 ID가 생기면 삭제 및 생성으로 감지한다.
- 파괴적 변경은 자동 적용하지 않고 명시적 확인을 요구한다.
- Schema Registry가 ID 발급과 uniqueness를 책임진다.
- UI와 CLI가 생성한 스키마는 동일한 ID 규칙을 사용한다.
- 운영 apply는 Workspace 단위 advisory lock과 schema revision 검사를 사용해 동시에 실행되지 않도록 한다.

## 8. 인증·인가 모델 개요

XeCMS는 하나의 authorization kernel을 CMS 운영 기능과 콘텐츠 애플리케이션 모두에 사용한다. 단, 계정 영역 사이의 의도하지 않은 권한 상승을 막기 위해 Identity Realm을 분리한다.

권한 판정은 다음 요소로 구성된다.

```text
Subject
  + Permission
  + Authority Level
  + Role
  + Resource Scope
  + Role Binding
  + Delegation Policy
  + Optional Constraint
  = Access Decision
```

## 9. Global Identity, Realm과 콘텐츠 계정

### 9.1 목적

CMS 관리 계정만 고정 제공하지 않는다. 사용자는 임의의 collection에 인증 기능을 활성화해 회원, 고객, 학생, 파트너 같은 콘텐츠 애플리케이션 계정을 만들 수 있다.

```ts
defineCollection({
  name: "members",
  auth: {
    enabled: true,
    realm: "community",
    identifiers: ["email"],
  },
  fields: [
    // profile fields
  ],
});
```

예시 realm:

```text
system         CMS 운영자
community      커뮤니티 회원과 운영진
commerce       고객과 판매자
academy        학생, 강사, 과정 관리자
partner        외부 파트너 계정
```

### 9.2 Global Identity와 Realm Membership

로그인 자격 증명을 가진 Identity는 XeCMS Instance 전체에서 안정적인 식별자를 갖는다. Identity가 실제로 어떤 계정으로 활동할 수 있는지는 Realm Membership으로 표현한다.

```text
Global Identity
├── System Realm Membership
│   └── CMS Operator Profile
├── Community Realm Membership
│   └── Member Profile Document
└── Commerce Realm Membership
    └── Customer Profile Document
```

```ts
interface RealmMembership {
  id: string;
  identityId: string;
  realmId: string;
  subjectId: string;
  profileDocumentId?: string;
  status: "pending" | "active" | "suspended";
  provisionedBy: "explicit" | "invitation" | "jit" | "account-link";
}
```

하나의 Identity는 여러 Realm Membership을 가질 수 있다. 로그인 자격 증명은 공유할 수 있지만 Role, Authority Level, Group 및 Role Binding은 Membership이 속한 Realm을 기준으로 별도 판정한다.

이 구조는 다음을 허용한다.

- CMS 운영 계정으로 콘텐츠 애플리케이션에 로그인
- 하나의 로그인으로 여러 콘텐츠 서비스의 Profile 사용
- Realm마다 서로 다른 역할과 권한 부여
- 콘텐츠 계정을 별도의 CMS 운영 계정으로 승격하지 않고 유지
- 필요할 때 기존 콘텐츠 계정과 시스템 Identity를 명시적으로 연결

### 9.3 System Identity의 콘텐츠 Realm 로그인

콘텐츠 Realm은 System Realm의 Identity를 인증 주체로 받아들일 수 있다.

```ts
interface RealmAuthenticationPolicy {
  acceptSystemIdentities: boolean;
  provisioning: "explicit" | "jit";
  defaultRoleIds: string[];
}
```

기본 권장값은 다음과 같다.

```ts
{
  acceptSystemIdentities: true,
  provisioning: "explicit",
  defaultRoleIds: []
}
```

- `explicit` 모드에서는 관리자가 Membership을 만들거나 초대해야 한다.
- `jit` 모드에서는 System Identity의 첫 로그인 시 콘텐츠 Realm Membership과 최소 Profile을 생성할 수 있다.
- `defaultRoleIds`가 비어 있으면 로그인에 성공하더라도 별도로 허용된 콘텐츠 권한은 없다.
- 기본 회원 Role을 설정한 경우 일반 콘텐츠 계정과 동일한 기본 권한만 받는다.
- System Realm의 CMS Role과 Authority Level은 콘텐츠 Realm으로 자동 전파하지 않는다.
- Admin Studio 접근 권한과 콘텐츠 애플리케이션 접근 권한은 각각 판정한다.

즉, System Identity 공유는 authentication federation이며 authorization bridge가 아니다.

### 9.4 Realm Full Access

특정 System Identity 또는 콘텐츠 계정에 대상 Realm의 모든 권한을 부여할 수 있다. 이는 CMS 운영 계정이라는 이유로 자동 부여하지 않고 대상 Realm에서 명시적으로 생성하는 보호된 Binding으로 표현한다.

```ts
interface RealmFullAccessBinding {
  realmId: string;
  subjectId: string;
  grantedBy: string;
  validUntil?: Date;
  reason?: string;
}
```

Realm Full Access 규칙:

- Realm 기본값은 비활성화다.
- System Identity와 일반 콘텐츠 Identity 모두 명시적으로 부여받을 수 있다.
- 대상 Realm과 그 하위 Resource에서만 유효하다.
- 미래에 추가되는 Permission도 포함하는 Realm 범위 wildcard 권한으로 동작한다.
- 일반적인 Role 합산, Scope 및 Authority Level 제한을 우회할 수 있다.
- Instance Owner, 다른 Realm 및 시스템 보호 객체에는 영향을 주지 않는다.
- 부여와 해제에는 재인증 및 별도 Permission이 필요하다.
- 기간 제한을 선택적으로 설정할 수 있다.
- 사용, 부여 및 해제는 항상 보안 Audit Log에 남긴다.
- 일반적인 운영에는 세분화된 Role Binding을 사용하고 Full Access는 초기 설정, 복구 또는 명시적인 최고 관리자 구성에만 사용한다.

Full Access를 가진 Subject도 다른 Realm의 권한을 자동으로 획득하지 않는다.

### 9.5 Realm 격리 규칙

- 역할, authority level 및 role binding은 기본적으로 realm에 속한다.
- 콘텐츠 realm의 역할이 system realm 권한을 획득할 수 없다.
- realm 사이 권한 연결은 명시적인 bridge policy가 있을 때만 허용한다.
- Admin Studio 로그인 가능 여부는 별도 permission으로 판단한다.
- 계정 profile document와 credential은 분리 저장한다.
- password hash, MFA secret, recovery token은 일반 콘텐츠 필드로 노출하지 않는다.

### 9.6 계정과 Subject 연결

인증 가능한 collection document는 authorization subject와 연결된다.

```text
Global Identity
    ↕ authentication
Realm Membership
    ↕ subject link
Realm Subject
    ├── profile link ↔ members document
    └── roles / groups / bindings
```

동일한 권한 엔진을 사용하므로 콘텐츠 계정에도 다음 기능을 적용할 수 있다.

- 계층형 그룹
- authority level
- 동일 레벨 역할
- resource scoped role
- delegation policy
- 조건부 권한
- 권한 판정 설명 및 audit

## 10. 권한 용어

| 용어 | 의미 |
|---|---|
| Global Identity | Instance 전체에서 로그인 자격 증명과 인증 수단을 소유하는 식별자 |
| Realm | 계정 Profile과 권한 체계를 격리하는 보안 영역 |
| Realm Membership | Global Identity가 특정 Realm에서 활동하는 Subject와 연결되는 관계 |
| Subject | User, Group, Service Account 등 권한의 주체 |
| Permission | 실행 가능한 원자 작업 |
| Resource | 권한이 적용되는 대상 |
| Scope | Resource와 그 하위 범위 |
| Authority Level | 수직적인 관리 서열 |
| Role | 동일 레벨 내 책임과 권한 묶음 |
| Role Binding | Subject에 특정 Role과 Scope를 연결 |
| Delegation Policy | 하위 역할에 위임 가능한 권한 범위 |
| Constraint | 소유자, 상태, 기간 등의 추가 조건 |
| Grant Provenance | Permission을 부여한 Role/Binding의 출처 |

## 11. Subject와 그룹 계층

```ts
type SubjectType = "user" | "group" | "service-account";
```

그룹은 중첩할 수 있고 사용자는 여러 그룹에 속할 수 있다.

```text
Marketing
├── Content Team
└── Design Team

Engineering
├── Frontend
└── Backend
```

- 그룹 순환을 금지한다.
- 직접 및 상속된 그룹 membership을 구분한다.
- 권한 판정 설명에 membership 경로를 포함한다.

## 12. Resource와 Scope 계층

모든 관리 대상은 authorization resource로 표현할 수 있어야 한다.

```text
System
└── Workspace
    ├── Site
    │   ├── Collection
    │   │   └── Document
    │   └── Media Folder
    └── Schema / Plugin / Jobs
```

```ts
interface Resource {
  id: string;
  realmId: string;
  type: string;
  parentId?: string;
}
```

Role Binding은 자신에게만 적용하거나 하위 resource로 전파할 수 있다.

```ts
type Propagation = "self" | "children" | "self-and-children";
```

콘텐츠 계층과 권한 resource 계층은 선택적으로 연결한다. 콘텐츠 이동에 따라 권한이 바뀌는 경우 적용 전에 변화를 미리 보여준다.

## 13. Authority Level과 동일 레벨 시스템

Authority Level은 역할과 분리된 수직 관리 서열이다. 특정 레벨은 필요에 따라 여러 개의 수평 Role로 확장할 수 있다.

```text
Level 100
└── Owner

Level 80
├── Content Administrator
├── Security Administrator
└── System Administrator

Level 40
└── Editor

Level 10
└── Viewer
```

```ts
interface AuthorityLevel {
  id: string;
  realmId: string;
  name: string;
  rank: number;
  protected?: boolean;
}

interface Role {
  id: string;
  realmId: string;
  levelId: string;
  name: string;
  permissions: PermissionPattern[];
  delegatablePermissions: PermissionPattern[];
  managed?: boolean;
}
```

### 13.1 동일 레벨 규칙

- 같은 레벨의 역할은 서로 상하관계가 아니다.
- 같은 레벨의 subject 또는 role을 수정, 제거, 비활성화할 수 없다.
- 관리 작업은 대상보다 엄격하게 높은 레벨에서만 가능하다.
- 한 레벨에 Role이 하나뿐이면 일반적인 선형 RBAC처럼 동작한다.
- 높은 레벨은 더 높은 관리 서열을 뜻하며 더 많은 기능 permission을 자동으로 뜻하지 않는다.
- Role permission은 합산할 수 있지만 Authority Level은 자동 승격되지 않는다.

```text
actorLevel > targetLevel  // 관리 가능성 있음
actorLevel = targetLevel  // 관리 불가
actorLevel < targetLevel  // 관리 불가
```

### 13.2 Owner

Owner는 일반 Role이 아니라 workspace 또는 realm의 보호 속성으로 관리한다.

- 정확히 하나의 소유 subject를 기본값으로 한다.
- 일반 Role 편집기로 수정할 수 없다.
- 소유권 이전은 재인증 및 audit을 요구한다.
- 어떤 일반 Role도 Owner를 관리할 수 없다.

### 13.3 Role 조합 정책

MVP에서는 Role이 다른 Role을 포함하는 Role inheritance를 지원하지 않는다.

- Subject에 여러 Role Binding을 부여해 권한을 조합한다.
- Group membership을 통해 Role Binding을 상속할 수 있다.
- Authority Level은 관리 서열만 표현하고 Permission 상속을 의미하지 않는다.
- 숨은 Role inheritance를 제거해 Grant Provenance와 권한 판정 설명을 단순하게 유지한다.

Role template 또는 permission preset은 Role 생성 편의 기능으로 제공할 수 있지만, 생성된 이후에는 독립된 Role로 관리한다.

## 14. Permission과 Permission Catalog

Permission은 등록된 catalog에서 관리한다. 정의되지 않은 permission 문자열을 조용히 허용하지 않는다.

```ts
interface PermissionDefinition {
  key: string;
  hierarchyGuard:
    | "none"
    | "target-role"
    | "target-binding"
    | "target-subject";
  delegatable: boolean;
  protected?: boolean;
}
```

### 14.1 콘텐츠 Permission 예시

```text
content.list
content.read
content.create
content.update
content.delete
content.publish
content.unpublish
content.archive
content.restore
content.revision.read
content.revision.restore
```

### 14.2 스키마 Permission 예시

```text
schema.read
schema.create
schema.update
schema.delete
schema.apply
schema.rollback
schema.export
```

### 14.3 Identity 및 권한 Permission 예시

```text
identity.read
identity.invite
identity.update
identity.disable
identity.credentials.reset
identity.session.revoke

group.read
group.create
group.update
group.member.manage

role.read
role.create
role.update
role.delete
role.assign
role.reorder

authority-level.read
authority-level.create
authority-level.update
authority-level.delete
```

### 14.4 운영 Permission 예시

```text
media.read
media.upload
media.delete
plugin.read
plugin.install
plugin.configure
job.read
job.retry
audit.read
api-key.create
api-key.revoke
system.settings.update
```

## 15. Role Binding

Role Binding은 누가, 어떤 역할을, 어디에서 행사할 수 있는지 정의한다.

```ts
interface RoleBinding {
  id: string;
  realmId: string;
  subjectId: string;
  roleId: string;
  resourceId: string;
  propagation: "self" | "children" | "self-and-children";
  constraints?: {
    validFrom?: Date;
    validUntil?: Date;
  };
}
```

사용자는 직접 Role Binding과 그룹을 통해 상속된 Role Binding을 함께 가질 수 있다.

## 16. 권한 판정 규칙

### 16.1 일반 작업

일반 콘텐츠 작업은 적용 가능한 Role의 permission을 합산할 수 있다.

```text
1. Subject의 직접 Role Binding 조회
2. 그룹 및 상위 그룹의 Role Binding 조회
3. 현재 Resource와 상위 Resource 조회
4. scope 및 propagation이 일치하는 binding 선택
5. Role permission 합산
6. field, owner, status, time constraint 검사
7. Access Decision 반환
```

기본 정책은 default deny + explicit allow다. 명시적 deny는 초기 범위에서 제외하고 inheritance boundary와 scope 재설정으로 대체한다.

### 16.2 관리 작업

Role, Binding, Subject를 관리하는 작업은 다음 조건을 모두 만족해야 한다.

```text
hasManagementPermission(actor, action)
AND actorScope contains targetScope
AND grantAuthorityLevel(actor, action) > targetAuthorityLevel
AND canDelegate(actor, affectedPermissions)
AND sameRealmOrExplicitBridge
AND targetIsNotProtected
```

### 16.3 Grant Provenance

관리 작업에서는 사용자의 전체 최고 레벨을 사용하지 않는다. 해당 permission을 실제로 부여한 Role과 Binding의 레벨을 사용한다.

```text
Level 80 Content Admin  → role.assign 없음
Level 20 Role Assistant → role.assign 있음

role.assign의 유효 관리 레벨 = 20
```

이를 통해 서로 다른 Role의 레벨과 permission을 결합한 우회 승격을 방지한다.

```ts
interface PermissionGrant {
  permission: string;
  sourceRoleId: string;
  sourceLevelId: string;
  sourceBindingId: string;
  scopeId: string;
  membershipPath?: string[];
}
```

### 16.4 권한 판정 결과

boolean만 반환하지 않고 판정 근거를 제공한다.

```ts
interface AccessDecision {
  allowed: boolean;
  action: string;
  reasonCode: string;
  matchedGrants: PermissionGrant[];
  evaluatedScope: string;
  actorLevel?: number;
  targetLevel?: number;
}
```

## 17. Delegation Policy와 승격 방지

Role은 자신이 하위 Role에 위임할 수 있는 permission 범위를 별도로 가진다.

```text
Content Administrator
├── permissions
│   ├── content.*
│   ├── role.create
│   └── role.assign
└── delegatablePermissions
    ├── content.*
    └── schema.read
```

필수 안전 규칙:

- 자신보다 낮은 레벨의 Role만 생성·수정·삭제할 수 있다.
- 자신과 같거나 높은 레벨의 Role을 할당할 수 없다.
- 자신보다 낮은 위치에서만 Role 또는 Level을 재정렬할 수 있다.
- 자신의 Role Binding을 직접 승격할 수 없다.
- 위임 허용 범위 밖의 permission을 하위 Role에 추가할 수 없다.
- protected permission, role 및 level은 일반 관리자가 수정할 수 없다.
- 모든 권한 구조 변경은 audit log에 기록한다.

## 18. 조건부 권한

RBAC를 기본 사용자 모델로 유지하면서 제한된 조건식을 지원한다.

```ts
{
  action: "content.update",
  condition: {
    all: [
      { field: "document.authorId", eq: "$subject.id" },
      { field: "document.status", in: ["draft", "rejected"] }
    ]
  }
}
```

초기 조건 대상:

- document owner
- document status
- locale
- binding 유효 기간
- 정적인 resource attribute

임의 JavaScript 조건은 분석과 캐시가 어렵기 때문에 core policy에서는 금지하고 trusted plugin hook으로만 제공한다.

## 19. 필드 단위 권한

- field read 권한이 없으면 응답에서 제거한다.
- field write 권한이 없는데 요청에 포함되면 오류를 반환한다.
- API와 Admin UI가 동일한 field access decision을 사용한다.
- field 권한 판정도 이유와 grant provenance를 제공할 수 있어야 한다.

## 20. 권한 Admin UI

### 20.1 Level/Role 편집기

Role을 단순한 일렬 목록이 아니라 Level별 그룹으로 표현한다.

```text
Level 100 · Ownership
└── Owner

Level 80 · Administrators
├── Content Administrator
├── Security Administrator
└── System Administrator

Level 40 · Editors
└── Editor
```

같은 Level 안의 표시 순서는 관리 우선순위를 의미하지 않는다.

### 20.2 Scope 선택기

Resource tree에서 Role이 적용될 위치와 propagation을 선택한다.

### 20.3 Permission Matrix

Permission namespace별로 read/create/update/delete/publish/manage 등을 조회하고 편집한다.

### 20.4 권한 시뮬레이터

```text
Subject: Alice
Action: content.publish
Resource: Blog / Posts / Post 123

Result: Allowed
Reason:
Alice
→ Content Team
→ Blog Editor Role
→ Blog Site Scope
→ inherited content.publish
```

### 20.5 변경 영향 미리보기

- Role level 변경으로 새롭게 관리 가능해지는 subject
- 상실하는 permission
- content tree 이동에 따른 scope 변화
- realm bridge 변경
- active session 또는 API key 영향

## 21. 권한 저장 모델 초안

```text
auth_realms
auth_identities
auth_credentials
auth_realm_memberships
auth_subjects
auth_users
auth_groups
auth_group_members
auth_group_ancestors

auth_authority_levels
auth_roles
auth_permissions
auth_role_permissions
auth_role_delegations

auth_resources
auth_resource_ancestors
auth_role_bindings
auth_binding_constraints

auth_policy_revisions
auth_decision_audit
```

그룹과 Resource 조상 관계는 closure table로 유지한다. 권한 구조가 변경되면 `policy_revision`을 증가시키고 해당 revision에 종속된 authorization cache를 무효화한다.

## 22. 문서 생명주기와 Revision

코어 문서 상태:

```text
draft → published → archived
```

지원 기능:

- publish / unpublish
- 현재 published revision
- revision history
- revision restore
- schema revision 연결
- 예약 작업을 위한 event

### 22.1 Document Identity와 Revision 저장 방식

문서의 안정적인 식별자와 변경 가능한 Revision을 분리한다.

```text
Document Identity
├── Current Draft Revision
├── Current Published Revision
└── Revision History
```

```ts
interface DocumentIdentity {
  id: string;
  collectionId: string;
  currentDraftRevisionId?: string;
  currentPublishedRevisionId?: string;
  deletedAt?: Date;
}
```

확정 규칙:

- Relation은 특정 Revision이 아닌 안정적인 Document ID를 참조한다.
- Published 문서를 수정하면 Published Revision을 직접 덮어쓰지 않고 새 Draft Revision을 만든다.
- Publish는 선택한 Draft Revision을 Current Published Revision으로 지정하는 작업이다.
- 이전 Published Revision은 Revision History에 유지한다.
- 기본 삭제는 soft delete이며 별도의 purge 권한과 보존 정책을 둔다.
- 계층 이동과 정렬 변경은 MVP에서 즉시 구조에 반영하고 Audit Log를 남긴다.
- 계층 전체의 draft/publish와 locale별 게시 상태는 후속 versioned hierarchy 설계에서 다룬다.

복잡한 다단계 승인 workflow는 extension으로 구현한다.

계층 이동은 별도 구조 변경 event와 audit log를 남긴다.

```text
tree.node.created
tree.node.moved
tree.node.reordered
tree.subtree.deleted
```

## 23. API

### 23.1 Local API

서버 코드와 trusted plugin이 사용하는 typed API다.

```ts
await xecms.documents.find({
  collection: "posts",
  where: { status: { eq: "published" } },
  actor,
});
```

### 23.2 REST API

Admin UI와 외부 애플리케이션이 사용하는 기본 API다.

```text
GET    /api/collections/:collection
GET    /api/collections/:collection/:id
POST   /api/collections/:collection
PATCH  /api/collections/:collection/:id
DELETE /api/collections/:collection/:id

GET    /api/collections/:collection/tree
GET    /api/collections/:collection/:id/children
GET    /api/collections/:collection/:id/ancestors
POST   /api/collections/:collection/:id/move
POST   /api/collections/:collection/reorder
```

GraphQL은 query AST가 안정된 후 공식 plugin으로 검토한다.

### 23.3 Query 기본 규격

REST API, Local API, Admin Studio 및 분석 가능한 권한 조건식은 하나의 Query AST를 공유한다.

```ts
interface QueryAst {
  where?: FilterNode;
  orderBy?: Array<{
    field: string;
    direction: "asc" | "desc";
  }>;
  limit?: number;
  cursor?: string;
  offset?: number;
}
```

초기 규칙:

- 외부 API의 기본 pagination은 cursor 방식이다.
- offset pagination은 Admin Studio와 소규모 조회에 한해 제한적으로 허용한다.
- filter는 `and`, `or`, `not`과 등록된 field operator를 사용한다.
- relation 및 hierarchy filter도 동일 AST node로 표현한다.
- 읽을 수 없는 Field를 filter 또는 order key로 사용하는 요청은 거부한다.
- 최대 relation depth, filter node 수, page size를 서버 정책으로 제한한다.
- full-text search는 Query AST의 extension node로 예약하고 초기에는 PostgreSQL adapter가 구현한다.
- 실제 operator 목록과 cursor encoding은 별도 Query Specification에서 확정한다.

## 24. Hook과 Event

Hook은 같은 요청 및 transaction 안에서 실행한다.

```text
beforeValidate
afterValidate
beforeCreate
beforeUpdate
beforeDelete
```

Event는 commit 이후 durable queue에서 처리한다.

```text
document.created
document.updated
document.published
asset.uploaded
identity.created
role.binding.changed
```

Outbox record는 document transaction과 함께 저장해 event 유실을 막는다.

## 25. 플러그인 모델

초기 플러그인은 신뢰된 서버 코드로 간주한다. 임의 플러그인 sandbox는 초기 범위에서 제외한다.

초기 플러그인 운영 규칙은 다음으로 확정한다.

- 플러그인은 npm package 형태로 배포한다.
- XeCMS plugin manifest를 반드시 제공한다.
- 설치, 활성화, 비활성화 및 제거 후 서버 재시작이 필요하다.
- 코어 및 Admin SDK와의 호환 버전 범위를 manifest에 선언한다.
- field type, permission, API route 및 Admin extension ID에 plugin namespace를 강제한다.
- plugin migration은 코어 migration registry에서 순서와 적용 상태를 추적한다.
- plugin 제거 전 schema, field, data 및 다른 plugin의 dependency를 검사한다.
- 잔존 데이터에 대한 보존, export 또는 purge 선택 없이 destructive uninstall을 실행하지 않는다.
- hot reload와 process sandbox는 초기 범위에서 제외한다.

플러그인 확장 지점:

- field type 및 form widget
- validation
- hook 및 event handler
- API route
- Admin page 및 UI slot
- storage, mail, search adapter
- authentication provider
- migration
- workflow
- page builder

플러그인은 가능한 한 DB 직접 접근 대신 Local API와 migration API를 사용한다.

## 26. Admin Studio 구성

```text
Overview
Content
Media
Schema
API Explorer
Users & Access
Identity Realms
Workflows
Plugins
Jobs
Audit
Settings
```

Schema 화면은 다음 정보를 제공한다.

- 필드 구조
- DB 저장 형태
- 생성될 API와 TypeScript 타입
- 현재 revision과 draft diff
- migration 실행 계획
- 파괴적 변경 경고
- 관계 및 계층 그래프

## 27. 설치 및 CLI 경험

```bash
npm create xecms@latest my-site
cd my-site
docker compose up -d
npm run dev
```

주요 CLI:

```bash
xecms init
xecms dev
xecms schema diff
xecms schema apply
xecms migrate
xecms generate types
xecms doctor
```

`xecms doctor`는 런타임, DB, migration, plugin 호환성, 환경 변수, storage 권한 및 schema drift를 검사한다.

## 28. 모노레포 경계 초안

```text
XeCMS/
├── apps/
│   ├── admin
│   ├── server
│   └── docs
├── packages/
│   ├── core
│   ├── schema
│   ├── database
│   ├── identity
│   ├── authorization
│   ├── api
│   ├── plugin-runtime
│   ├── admin-sdk
│   ├── client
│   ├── cli
│   ├── config
│   ├── ui
│   └── create-xecms
├── plugins/
│   ├── storage-local
│   └── rich-text
├── examples/
│   ├── minimal
│   ├── blog
│   └── community
└── docs/
    ├── product
    ├── architecture
    ├── decisions
    └── roadmap
```

## 29. 초기 MVP 범위

MVP의 상세 범위, milestone, acceptance criteria 및 완료 정의는 별도 문서인 [XeCMS MVP 사양서](./mvp-specification.md)에서 관리한다.

```text
M0 · Domain Prototype
→ M1 · Vertical Slice
→ M2 · Content Core
→ M3 · Authorization Platform
→ M4 · Extensible CMS
```

시스템 사양서는 장기적인 제품 불변 규칙과 상위 구조를 정의하고, MVP 사양서는 최초 배포 가능한 제품에 포함되는 구현 범위와 순서를 정의한다.

Admin Studio의 확정 기술 구조, UX 원칙과 M1 화면 범위는 [XeCMS Admin Studio 사양서](./admin-ui-specification.md)에서 관리한다.

## 30. 확정된 권한 불변 규칙

1. 모든 관리 대상은 계층화 가능한 Resource로 표현할 수 있다.
2. Role은 Subject에 특정 Resource Scope로 할당한다.
3. 같은 Authority Level의 Role끼리는 관리 관계가 없다.
4. 높은 Authority Level도 해당 Permission 없이는 작업할 수 없다.
5. 관리 작업은 자신보다 낮은 Level에만 수행할 수 있다.
6. Resource Scope 밖의 대상은 Level이 낮아도 관리할 수 없다.
7. Permission 위임은 Delegation Policy를 넘을 수 없다.
8. 관리 Level은 전체 최고 Role이 아닌 해당 Permission의 Grant Provenance로 계산한다.
9. 일반 기능 Permission은 여러 Role에서 합산할 수 있다.
10. Owner와 protected security object는 일반 Role로 관리할 수 없다.
11. Realm은 기본적으로 서로 격리되며 명시적 bridge 없이는 권한이 전파되지 않는다.
12. 모든 보안 구조 변경은 audit 대상이다.
13. Access Decision은 결과와 함께 판정 이유를 제공해야 한다.
14. 하나의 Global Identity는 여러 Realm에 로그인할 수 있지만 Permission은 Realm Membership별로 독립 판정한다.
15. System Identity라는 사실만으로 콘텐츠 Realm Permission을 획득하지 않는다.
16. Realm Full Access는 대상 Realm에서 명시적으로 부여하며 다른 Realm이나 Instance 보호 객체로 전파되지 않는다.

## 31. 후속 설계 항목

다음 항목은 별도 상세 설계 문서 또는 ADR로 확정한다.

- canonical schema IR와 field contract
- physical table migration 알고리즘
- query AST와 filter/operator 규격
- authorization evaluation algorithm과 cache key
- realm bridge policy
- Role/Level 재정렬 알고리즘
- content hierarchy move 알고리즘
- versioned hierarchy와 path publication 정책
- session, API key, MFA 및 credential 보안
- plugin compatibility 및 capability model
- package dependency rule
- 성능 목표와 benchmark scenario
- backup, restore 및 disaster recovery
- 각 MVP milestone의 acceptance criteria
