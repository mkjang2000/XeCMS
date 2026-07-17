# XeCMS Custom Admin Apps 사양

## 1. 목적

Custom Admin Apps는 XeCMS의 Schema와 Authorization을 그대로 사용해
서비스 운영자용 관리자 앱을 구성하는 기능이다.

```text
Schema와 Collection 생성
→ 기본 관리 화면 자동 생성
→ 운영 App에 필요한 화면 선택
→ 목록, 필터와 폼 배치 조정
→ 기존 Role과 Scope 연결
→ Preview
→ Apply
→ 별도 URL 제공
```

범용 웹사이트 Builder나 arbitrary low-code platform을 목표로 하지 않는다.

> XeCMS의 Content, Relation, Hierarchy, Media, Revision과 Authorization을
> 이해하는 운영용 관리자 앱을 빠르게 구성한다.

## 2. Admin Studio와의 구분

### Admin Studio

XeCMS 자체를 관리하는 개발자·시스템 관리자용 UI다.

- Schema와 Migration
- Identity와 Realm
- Authority Level, Role과 Binding
- Plugin, Audit와 Retention
- Site와 System Settings
- Backup, Restore와 Diagnostics

기본 경로:

```text
/admin
```

### Custom Admin App

서비스 운영자와 특정 업무 담당자가 사용하는 별도 앱이다.

```text
/apps/backoffice
/apps/vendor
/apps/support
/apps/moderation
```

하나의 Workspace에 여러 App을 만들 수 있다.

## 3. 제품 경계

### 포함

- Collection과 Singleton
- Document와 Revision
- Relation, Hierarchy와 Media
- System/Content Realm session
- Role, Binding, Resource Scope와 Field permission
- Site
- 내장 Action
- trusted Plugin Widget/Action
- 선언형 Manifest
- Draft, Preview, Apply, Revision과 Export/Import

### 초기 제외

- 외부 DB
- 사용자 정의 SQL
- 임의 REST API 조립
- arbitrary JavaScript
- workflow automation
- 일반 웹사이트·랜딩페이지 Builder
- 모바일 앱 Builder
- 앱별 독립 frontend bundle
- runtime remote React bundle
- 자유 배치형 범용 canvas

## 4. 핵심 원칙

### 4.1 Application Service 공유

```text
Custom Admin App
→ Admin App Runtime
→ XeCMS Application Service
→ Authorization
→ Store
```

Custom Admin App은 DB에 직접 접근하지 않는다.

### 4.2 Visibility와 Authorization 분리

Visibility는 화면 표시만 결정한다. 서버는 모든 요청에서 실제 Permission을 다시 판정한다.

- 버튼이 숨겨져도 직접 요청은 서버에서 거부한다.
- 버튼이 보여도 Permission이 없다면 실행할 수 없다.
- 읽을 수 없는 Field는 API 응답에서도 제거한다.
- 쓸 수 없는 Field를 전송하면 서버에서 거부한다.

### 4.3 자동 생성 우선

빈 canvas보다 Schema에서 생성한 기본 화면에서 시작한다.

```text
Schema
→ Generated List/Form/Detail
→ App에 추가
→ 필요한 부분만 override
```

### 4.4 선언형 Manifest

UI Builder의 결과는 versioned JSON Manifest다.

- validation
- canonical serialization
- diff
- revision
- export/import
- dependency 검사
- 자동 테스트

### 4.5 안전한 Action

Manifest는 permission이나 함수명을 직접 지정하지 않고 등록된 Action ID만 참조한다.

```ts
interface ActionReference {
  actionId: string;
  presentation?: {
    label?: string;
    icon?: string;
    placement?: "page" | "row" | "bulk";
  };
}
```

서버의 trusted Action Registry가 다음을 소유한다.

- permission
- resource resolver
- input schema
- handler
- destructive 여부
- preview/confirmation 요구
- audit metadata

## 5. 패키지와 Runtime

권장 경계:

```text
packages/admin-apps
  Manifest, parser, validation, canonicalization, diff, dependency

packages/admin-runtime
  Generated View와 React Manifest renderer

packages/application
  AdminAppApplicationService, Action Registry

packages/database
  App/Draft/Revision store와 migration

packages/contracts, packages/client, packages/admin
  REST DTO와 client adapter

apps/admin
  App Builder UI

apps/server
  Runtime/API 조립과 SPA delivery
```

MVP는 하나의 frontend bundle과 하나의 Runtime Renderer를 사용한다.
App마다 새 React build를 만들지 않는다.

## 6. 인증과 권한

### 6.1 App Audience

각 App은 하나의 인증 audience를 선언한다.

```ts
type AdminAppAudience =
  | { type: "system" }
  | { type: "content-realm"; realmId: string };
```

한 요청에서 System과 Content session을 임의로 합산하지 않는다.
System Identity도 대상 Content Realm Membership이 있어야 Content audience App에 로그인한다.

### 6.2 App Resource

활성 App은 대상 Realm에 Authorization Resource를 가진다.

```text
resource:admin-app:{appId}
```

App 사용은 두 단계로 판정한다.

1. `admin-app.access`로 App 진입 허용
2. 실제 작업의 `content.*`, `media.*` 등 기존 Permission 판정

`admin-app.access`는 콘텐츠 Permission을 대체하지 않는다.

### 6.3 App 관리 Permission

System Realm에서 다음 Permission을 사용한다.

- `admin-app.read`
- `admin-app.create`
- `admin-app.update`
- `admin-app.apply`
- `admin-app.delete`
- `admin-app.export`

### 6.4 UI Access Profile

Runtime은 session의 legacy capability 배열에 의존하지 않는다.
서버가 App navigation/page/action에 필요한 판정을 batch로 계산한
access profile을 제공한다.

```ts
interface AdminAppAccessProfile {
  appAllowed: boolean;
  pages: Record<string, boolean>;
  actions: Record<string, boolean>;
  readableFields: Record<string, string[] | null>;
  writableFields: Record<string, string[] | null>;
  policyRevision: number;
}
```

profile은 UX 최적화이며 서버 판정을 대체하지 않는다.

## 7. Manifest V1

```ts
interface AdminAppManifestV1 {
  format: "xecms.admin-app";
  formatVersion: 1;

  id: string;
  name: string;
  key: string;
  description?: string;
  icon?: string;
  audience: AdminAppAudience;

  navigation: AdminNavigationItem[];
  pages: AdminPageDefinition[];
  startPageId: string;
}
```

`createdAt`, `updatedAt`, 작성자와 revision 정보는 canonical Manifest에 넣지 않고
DB metadata로 관리한다.

### 7.1 Navigation

```ts
interface AdminNavigationItem {
  id: string;
  label: string;
  icon?: string;
  pageId?: string;
  children?: AdminNavigationItem[];
  visibility?: VisibilityCondition;
}
```

Navigation은 순환할 수 없고 page 또는 children 중 하나 이상을 가져야 한다.

### 7.2 Visibility

```ts
interface VisibilityCondition {
  allPermissions?: PermissionReference[];
  anyPermissions?: PermissionReference[];
  documentStatuses?: string[];
}
```

Role ID나 이름에 직접 의존하는 `requiredRoles`는 기본 계약에 넣지 않는다.
그룹, 동일 레벨 Role과 Binding 변경에 취약하기 때문이다.

### 7.3 Stable Reference

- Collection, Field, Relation과 Component는 stable ID로 참조한다.
- 이름은 사용자 표시와 import 보조 정보로만 사용한다.
- Plugin Widget과 Action은 namespace ID로 참조한다.

## 8. Page 종류

```ts
type AdminPageDefinition =
  | CollectionListPageDefinition
  | DocumentFormPageDefinition
  | DocumentDetailPageDefinition
  | SingletonPageDefinition
  | DashboardPageDefinition
  | PluginPageDefinition;
```

### 8.1 Collection List

```ts
interface CollectionListPageDefinition {
  id: string;
  type: "collection-list";
  collectionId: string;
  title?: string;
  columns: ColumnDefinition[];
  fixedFilter?: FilterExpression;
  availableFilters?: FilterDefinition[];
  defaultSort?: SortDefinition[];
  rowActions?: ActionReference[];
  bulkActions?: ActionReference[];
  rowClick?: PageLinkDefinition;
}
```

지원 범위:

- cursor pagination
- 검색, filter와 sort
- 상태 filter
- column 순서와 너비
- Relation label
- status badge
- hierarchy subtree 고정 filter
- saved view

### 8.2 Form

```ts
interface DocumentFormPageDefinition {
  id: string;
  type: "document-form";
  collectionId: string;
  mode: "create" | "edit" | "create-or-edit";
  layout: FormLayoutDefinition;
  actions?: ActionReference[];
}
```

Layout은 section, tab과 collapse처럼 구조화된 container를 사용한다.
완전한 pixel canvas를 사용하지 않는다.

Field 설정:

- 순서와 width
- label/description override
- hidden/read-only 표현
- conditional visibility
- Widget 선택
- Relation/Media picker

Schema의 required/readOnly와 서버 field permission을 override할 수 없다.

### 8.3 Detail

- summary
- field group
- relation panel
- revision
- audit
- action bar

### 8.4 Singleton

문서가 없으면 create, 있으면 edit로 연결한다.
Collection list를 별도로 요구하지 않는다.

### 8.5 Dashboard

초기 Widget:

- metric card
- recent documents
- status summary
- collection count
- saved filter result
- quick action

Widget은 등록된 Query Contract만 사용한다.

## 9. Document Query Contract

Custom Admin Apps의 선행 기반이다.

```ts
interface DocumentQuery {
  collectionId: string;
  cursor?: string;
  limit: number;
  fields?: string[];
  filter?: FilterExpression;
  sort?: SortDefinition[];
  state?: "active" | "deleted";
}
```

필수 규칙:

- Field type별 허용 operator만 사용
- 임의 SQL fragment 금지
- stable tie-break sort
- 최대 limit와 query complexity
- Relation traversal depth 제한
- readable field projection
- Resource Scope와 Binding constraint 반영
- scope 제한 후에도 일관된 cursor pagination

MVP에서 정확한 전체 count가 비싸면 `hasNextPage`를 우선하고 total을 선택적으로 제공한다.
대규모 환경에서는 effective scope projection/read model을 도입할 수 있다.

## 10. Generated View Runtime

현재 Admin Studio의 콘텐츠 UI를 다음 단위로 추출한다.

- `GeneratedCollectionList`
- `GeneratedDocumentForm`
- `GeneratedDocumentDetail`
- `GeneratedSingletonEditor`
- `GeneratedRevisionPanel`
- `GeneratedHierarchyTree`
- `RelationPicker`
- `MediaPicker`

Admin Studio와 Custom Admin App은 이 renderer를 공유하지만 route와 shell은 공유하지 않아도 된다.

## 11. Action Registry

### 11.1 내장 Action

- create/update
- publish/unpublish
- archive/restore
- soft delete/restore
- purge
- duplicate
- move/reorder
- export

### 11.2 실행 흐름

```text
Action ID
→ Registry resolve
→ Input validate
→ Resource resolve
→ Authorization
→ Preview/Confirmation
→ Application Service
→ Audit/Outbox
→ Result
```

Bulk Action은 선택 ID, query snapshot 또는 exact candidate digest를 사용해
preview와 apply 사이의 대상 변경을 감지한다.

## 12. Plugin 확장

Plugin이 등록할 수 있는 확장:

- Field Widget
- Table Cell Renderer
- Dashboard Widget
- Action
- Filter Operator
- Page
- Detail Panel
- Navigation contribution

모든 ID는 Plugin namespace를 사용한다.

적용된 Admin App Revision은 사용한 Plugin ID/version/digest와 extension ID를 dependency로 저장한다.
Plugin disable/uninstall preview는 활성 App dependency를 blocker로 표시한다.

MVP에서는 배포 bundle에 포함된 trusted Plugin registry만 사용한다.

## 13. Draft, Preview와 Revision

```text
Edit Draft
→ Validate
→ Preview
→ Apply
→ Active Revision
→ Rollback
```

검증:

- 중복 App key/route
- 중복 Page/Navigation ID
- 순환 Navigation
- 존재하지 않는 Collection/Field/Permission
- 잘못된 audience Realm
- 삭제되거나 비활성인 Action/Widget
- Plugin compatibility
- 잘못된 filter/operator
- start page 누락

Apply 시 dependency snapshot을 저장한다.

- Schema revision/hash
- Authorization policy revision
- Plugin manifest digest
- Collection/Field/Action/Widget reference

Schema나 Plugin 변경으로 dependency가 깨지면 affected page를 fail-closed하고
Admin Studio에서 App health 문제를 표시한다.

## 14. 저장

권장 table:

```text
_xecms_admin_apps
_xecms_admin_app_drafts
_xecms_admin_app_revisions
_xecms_admin_app_dependencies
_xecms_admin_app_user_views
```

- App record는 active revision pointer와 route key를 가진다.
- Draft는 optimistic draft version을 가진다.
- Revision은 immutable manifest, canonical hash와 dependency snapshot을 가진다.
- 사용자별 saved view는 App Manifest와 분리한다.

## 15. Routing

MVP canonical route:

```text
/apps/:appKey/*
```

React Router와 Fastify에 App별 route를 동적으로 추가하지 않는다.
하나의 wildcard Runtime이 active Manifest의 page를 해석한다.

최상위 alias(`/backoffice`)는 reserved route, static asset와 Plugin path 충돌 검증을
완성한 후 선택적으로 지원한다.

## 16. Builder

Builder는 자유 canvas가 아니라 구조화된 editor다.

- App 정보와 audience
- Navigation tree
- Page 추가/삭제
- List column/filter/sort
- Form section/tab
- Dashboard grid
- Action placement
- Visibility
- Preview, validation과 diff
- Manifest source 보기

`Basic / Standard / Advanced`는 같은 Manifest editor에서 표시량만 조절한다.
Custom App을 사용하는 운영자 Runtime에는 이 모드를 노출하지 않는다.

## 17. 완료 기준

최초 제품 단위는 다음 흐름을 완주해야 한다.

```text
Schema에서 Collection/Singleton 생성
→ Custom Admin App 생성
→ Generated page 추가
→ Navigation과 list/form 설정
→ App 접근 Role Binding
→ Preview/Apply
→ 별도 URL 로그인
→ Scope와 field permission이 적용된 CRUD
→ Manifest export/import
```

구현 순서는 [Custom Admin Apps 개발 순서](./custom-admin-apps-roadmap.md)를 따른다.
