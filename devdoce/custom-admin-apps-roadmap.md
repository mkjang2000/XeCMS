# XeCMS Custom Admin Apps 개발 순서

## 1. 목표

이 문서는 [Custom Admin Apps 사양](./custom-admin-apps-specification.md)을
안전하게 구현하기 위한 순서와 각 단계의 완료 기준을 정의한다.

핵심 원칙:

1. Builder보다 Query와 Runtime을 먼저 만든다.
2. 새 UI를 복제하지 않고 기존 Content UI를 공용 renderer로 추출한다.
3. UI visibility보다 서버 authorization을 먼저 완성한다.
4. 각 단계는 독립적으로 검증 가능한 vertical result를 만든다.
5. Manifest를 손으로 작성해도 Runtime이 완성된 뒤 Builder를 시작한다.

## 2. 전체 순서

```text
CAA-0  권한·조회 기반 보강
→ CAA-1 Manifest Contract
→ CAA-2 Store / Draft / Revision
→ CAA-3 Runtime Shell과 Routing
→ CAA-4 Generated Views
→ CAA-5 App Builder MVP
→ CAA-6 Dashboard와 Action
→ CAA-7 Plugin Extension
→ CAA-8 Product Closure
```

`CAA-0~CAA-4`가 첫 번째 실제 제품 단위다.
`CAA-5`부터 사용자가 Admin Studio에서 App을 직접 구성할 수 있다.

### 현재 진행 상태

기준일: 2026-07-17

- [x] CAA-0A Document Query Contract
- [x] CAA-0B Scope-aware Pagination
- [x] CAA-0C Effective Access Profile
- [x] CAA-0D 기존 Admin 권한 UX 보정

CAA-0A에서 기존 page 기반 API를 유지하면서 다음 계약을 추가했다.

```text
POST /api/collections/:collectionId/documents/query
POST /api/content-realms/:realmKey/collections/:collectionId/documents/query
```

지원 범위:

- stable Field ID 기반 projection
- strict nested Filter AST
- scalar Field filter와 sort
- opaque query-bound cursor
- `hasNextPage`
- unreadable filter/sort Field 거부

CAA-0B는 각 raw candidate의 cursor를 보존하고 Application Service가 권한 판정을 수행하면서
요청한 visible page를 채우는 bounded scan 방식으로 구현했다. 접근 불가 문서가 중간에
섞여도 빈 페이지나 cursor skip이 발생하지 않으며, 한 요청의 candidate scan은 5,000개로
제한한다.

CAA-0C는 인증된 System Subject 자신에 대한 Permission/Field 판정을 최대 100개까지
하나의 immutable policy revision으로 계산한다. 응답의 각 decision과 최상위
`policyRevision`은 동일하며, unknown Permission과 hierarchy target context가 필요한
관리 Permission은 `supported: false`로 fail-closed 처리한다. 다른 Subject ID는 요청할
수 없고, API key scope를 과대 표시하지 않도록 현재 endpoint는 Admin session 전용이다.

CAA-0D는 `@xecms/admin`에 access visibility helper를 추가하고 Admin navigation을
실제 batch profile과 표시모드의 교집합으로 계산한다. `/admin` 진입 시에도 고정된 Schema
화면 대신 현재 표시 가능한 첫 화면으로 이동한다. Schema와 Media의 대표 mutation action은
동일 helper로 숨기며, 계정 영역은 더 이상 모든 로그인 사용자를 `System administrator`로
표시하지 않는다. `children` Scope는 현재 리소스를 제외한다는 경고를 표시하고,
hierarchy-aware simulator action은 일반 Denied가 아니라 대상 Role/Binding/Subject
context가 필요한 별도 상태로 표시한다.

## 3. CAA-0 — 권한·조회 기반 보강

### 목표

Scope가 제한된 운영자도 빈 페이지나 잘못된 total 없이 안정적으로 문서를 조회하고,
UI가 필요한 effective permission을 batch로 확인할 수 있게 한다.

### 0-A Document Query Contract

추가:

- typed filter AST
- Field type별 operator catalog
- multi-column sort와 stable ID tie-break
- cursor pagination
- field projection
- query limit/complexity validation
- relation traversal depth 제한

예상 변경:

```text
packages/contracts
packages/client
packages/admin
packages/application/documents
packages/database/postgres document query
apps/server document routes
```

### 0-B Scope-aware Pagination

현재의 “DB page 조회 후 문서별 권한 제거” 구조를 교체한다.

현재 구현:

1. Store가 정렬된 raw candidate와 각 candidate 직후 cursor를 반환
2. Application Service가 bounded batch로 candidate를 읽음
3. 기존 Authorization과 `filterReadableData`로 문서·Field 접근 판정
4. visible document를 `limit + 1`개 찾거나 raw query가 끝날 때까지 진행
5. 마지막으로 반환한 visible document의 raw cursor를 다음 cursor로 사용

대규모 환경에서 candidate scan 비용이 기준을 넘으면 Authorization applicable scope를
DB query에 push down하는 effective scope projection/read model로 교체한다. 외부 Query
Contract와 cursor 형식은 유지한다.

정확한 total이 비싼 경우:

- cursor와 `hasNextPage`를 기본 계약으로 사용
- exact total은 query capability로 분리
- page number 기반 UI는 공용 renderer에서 cursor history로 변환

### 0-C Effective Access Profile

새 batch endpoint:

```text
POST /api/access/evaluate-batch
```

입력은 서버가 허용한 action/resource request 배열이며, hierarchy 관리 action은
필요한 target context가 없으면 명확히 unsupported로 응답한다.

Custom App Runtime은 App/Page/Action/Field 표시를 위해 이 결과를 사용한다.

현재 계약:

- `permission`과 `field(read/write)` check 지원
- 요청당 1-100개, 고유한 check ID 필요
- authenticated Subject 자신만 평가
- 모든 결과에 동일한 `policyRevision` 제공
- unknown/hierarchy-aware action은 `supported: false`
- 이 profile은 UI visibility 최적화이며 실제 서버 authorization을 대체하지 않음

### 0-D 기존 Admin 권한 UX 보정

Custom Apps에서 같은 실수를 반복하지 않도록 다음 기반을 정리한다.

- Admin navigation의 hard-coded `System administrator` 제거
- 실제 권한 기반 action visibility helper
- `children`과 `self-and-children` 설명 강화
- hierarchy context가 필요한 simulator action 처리

이 항목은 Custom Apps Runtime과 공용 access helper를 공유할 수 있는 범위까지만 수행한다.

구현 결과:

- navigation: 표시모드 + 실제 Permission을 모두 만족한 메뉴만 노출
- index route: 접근 가능한 첫 Admin 화면으로 이동
- action helper: `allowed`, `denied`, `unsupported`, `missing` 상태 구분
- Schema/Media 대표 action visibility에 공용 helper 적용
- 계정 표기: 고정 관리자 역할명 대신 System Realm과 policy revision 표시
- Scope: `하위만 (현재 제외)`와 `현재 + 모든 하위`를 명시적으로 구분
- simulator: hierarchy action을 대상 context 필요 상태로 분리

### 완료 조건

- subtree에만 권한이 있는 Subject가 연속 cursor page를 정확히 조회한다.
- 접근 불가 문서가 섞여도 page size와 `hasNextPage`가 일관된다.
- 읽기 불가 Field가 list projection에 포함되지 않는다.
- filter/sort에 읽기 불가 Field를 사용하면 거부한다.
- query complexity 초과와 잘못된 operator가 `422`로 거부된다.
- batch access 결과와 실제 mutation authorization이 일치한다.

### 검증

- pure query parser unit
- PostgreSQL filter/sort/cursor integration
- mixed Scope와 Field permission integration
- Chromium 제한 운영자 list journey

## 4. CAA-1 — Manifest Contract

### 목표

UI나 DB와 무관하게 Admin App Manifest V1을 엄격하게 해석하고 정규화한다.

### 작업

새 package:

```text
packages/admin-apps
```

포함:

- `AdminAppManifestV1`
- page/navigation/layout/query/action reference 타입
- strict decoder
- canonical serializer
- SHA-256 hash
- semantic validation
- dependency extractor
- manifest diff
- test fixture

검증 규칙:

- App/Page/Navigation ID 형식
- App key와 route segment
- 중복 ID
- navigation cycle
- start page
- page type별 required property
- filter AST
- stable object reference
- Plugin namespace
- unknown property 거부

### Schema와의 관계

Schema parser/serializer 구현 패턴은 재사용하지만 `SchemaIrV1`과 타입을 합치지 않는다.
Admin App Manifest는 Schema를 참조하는 별도 artifact다.

### 완료 조건

- 같은 Manifest는 항상 같은 canonical JSON과 hash를 생성한다.
- property 순서가 달라도 동일 hash다.
- unknown page/action/widget은 fail-closed한다.
- malformed/cyclic manifest test가 모두 실패한다.
- 최소 Backoffice fixture가 parse/serialize round trip을 통과한다.

## 5. CAA-2 — Store, Draft와 Revision

### 목표

Workspace에서 여러 App을 생성하고 Draft/Preview/Apply/Rollback할 수 있게 한다.

### 2-A Migration과 Store

추가 table:

```text
_xecms_admin_apps
_xecms_admin_app_drafts
_xecms_admin_app_revisions
_xecms_admin_app_dependencies
_xecms_admin_app_user_views
```

필수 경계:

- Workspace + App key unique
- immutable Revision
- active revision pointer
- optimistic draft version
- route key CAS
- 작성자와 시간 Audit metadata

### 2-B Application Service

```ts
AdminAppApplicationService
```

명령:

- list/get
- create draft
- save draft
- validate
- preview
- apply
- rollback
- archive/delete
- export/import

Permission:

- `admin-app.read`
- `admin-app.create`
- `admin-app.update`
- `admin-app.apply`
- `admin-app.delete`
- `admin-app.export`

### 2-C Dependency Validation

Preview 시 다음을 resolve한다.

- Schema revision/hash
- Collection/Field/Component/Relation
- audience Realm
- Permission catalog
- Action/Widget registry
- Plugin ID/version/digest

Apply 시 snapshot을 Revision에 저장한다.

### 2-D Authorization Resource

활성 App에 다음 Resource를 materialize한다.

```text
resource:admin-app:{appId}
```

대상 Realm에서 `admin-app.access` Binding으로 App 진입을 제어한다.

### 완료 조건

- 두 App의 Draft와 Revision이 독립적으로 동작한다.
- stale draft/apply는 `409`로 거부된다.
- 중복 key는 transaction에서 거부된다.
- Schema/Plugin dependency 누락은 Preview blocker가 된다.
- apply/rollback이 App Resource와 active revision을 일관되게 갱신한다.
- import/export round trip hash가 일치한다.

## 6. CAA-3 — Runtime Shell과 Routing

### 목표

손으로 작성해 적용한 Manifest를 별도 URL에서 실제 App으로 실행한다.

### 3-A Canonical Route

```text
/apps/:appKey/*
```

하나의 React wildcard route와 Server SPA fallback을 사용한다.
App별 React/Fastify route를 runtime에 등록하지 않는다.

### 3-B Authentication

App audience에 따라:

- System session loader
- Content Realm session loader
- login redirect
- password change/session expiry
- CSRF store

를 선택한다.

다른 audience의 session을 자동 합산하지 않는다.

### 3-C Runtime API

```text
GET  /api/admin-apps/runtime/:appKey
POST /api/admin-apps/runtime/:appKey/access
```

Runtime response:

- active Manifest
- App metadata
- resolved Schema summary
- extension availability
- access profile
- dependency health

### 3-D App Shell

- App brand/name
- navigation
- current user와 Realm
- loading/error/forbidden/degraded 화면
- mobile 최소 대응
- keyboard navigation

### 완료 조건

- System App과 Content Realm App이 서로 다른 session으로 열린다.
- `admin-app.access`가 없으면 Manifest 세부 정보를 노출하지 않고 `403` 처리한다.
- navigation visibility가 access profile을 반영한다.
- 직접 URL 접근도 page access를 검증한다.
- unknown/degraded Widget이 전체 App crash 대신 안전한 오류를 표시한다.

## 7. CAA-4 — Generated Views

### 목표

Schema만으로 별도 운영 App에서 실제 콘텐츠 관리가 가능하게 한다.

### 4-A 공용 Renderer 추출

기존 Admin Studio에서 추출:

- collection list
- document form
- document detail
- singleton
- document lifecycle action
- revision
- relation/media picker
- hierarchy tree

공용 renderer는 route 문자열과 Admin Studio navigation을 직접 알지 않는다.
navigation callback과 API context를 주입받는다.

### 4-B Collection List

최초 범위:

- configured columns
- basic filter/sort
- cursor pagination
- status badge
- row link
- fixed Scope/filter
- create action

### 4-C Form과 Detail

- Schema generated field editor
- field order
- section
- create/update
- field-level read/write
- relation/media
- validation issue mapping
- unsaved changes guard

### 4-D Singleton, Revision과 Hierarchy

- create-or-edit Singleton
- revision list/restore
- hierarchy tree와 move preview
- permission impact 표시

### 완료 조건

손으로 작성한 Manifest만으로 다음을 완주한다.

```text
App 로그인
→ 목록 조회/filter/sort
→ Document 생성
→ 편집
→ publish
→ Revision restore
→ hierarchy move
→ 삭제/복원
```

모든 과정에서 Scope와 Field permission이 실제 API와 UI에 일치해야 한다.

## 8. CAA-5 — App Builder MVP

### 목표

Admin Studio에서 JSON을 직접 작성하지 않고 App을 만들 수 있게 한다.

### 화면

- App 목록/상태/health
- App 생성
- 기본 정보와 audience
- Navigation editor
- Page 추가/삭제
- List column/filter/sort editor
- Form section/field order editor
- Validation issue navigator
- Preview
- Diff/Apply/Rollback
- Manifest source
- Export/Import

### 표시 모드

- Basic: generated page 선택과 기본 field
- Standard: navigation, column/filter와 section
- Advanced: source, dependency, Scope와 extension

세 모드는 같은 Draft를 수정한다.

### UX 원칙

- 구조화된 editor 우선
- drag-and-drop은 navigation/field order처럼 의미가 명확한 곳에만 사용
- keyboard 대체 조작 제공
- Preview는 저장된 Draft version을 사용
- Apply 전에 dependency와 권한 영향 표시

### 완료 조건

비어 있는 Workspace에서 UI만 사용해 Backoffice App을 생성·적용할 수 있다.
브라우저 refresh와 다른 Admin session에서도 같은 Draft/Revision을 확인할 수 있다.

## 9. CAA-6 — Dashboard와 Action

### 6-A Dashboard Query

내장 Widget:

- collection count
- status count
- recent documents
- saved filter result
- quick action

arbitrary aggregate/SQL은 지원하지 않는다.

### 6-B Action Registry

내장 Action을 registry로 이전한다.

- immutable permission mapping
- resource resolver
- input validator
- preview/confirmation
- audit/outbox

### 6-C Bulk Action

초기 지원:

- publish/unpublish
- archive/restore
- soft delete

preview는 exact candidate ID digest와 policy/schema revision을 저장한다.
apply가 달라진 대상을 암묵적으로 처리하면 안 된다.

### 완료 조건

- Action Manifest가 permission을 위조할 수 없다.
- destructive/bulk Action은 stale candidate를 거부한다.
- Dashboard 결과도 Document Query와 동일한 Scope/Field 경계를 사용한다.

## 10. CAA-7 — Plugin Extension

### 목표

trusted Plugin이 Widget과 Action을 안전하게 제공한다.

### 작업

Plugin SDK 확장:

- widget declaration/runtime
- action declaration/runtime
- page/panel declaration
- compatibility와 namespace validation

Plugin lifecycle:

- Admin App dependency scan
- disable/uninstall blocker
- missing runtime degraded state
- restart-required 처리

Frontend:

- build에 포함된 trusted registry
- remote URL/import 금지
- extension error boundary

### 완료 조건

- 예제 Plugin Widget/Action이 App에서 동작한다.
- 사용 중인 Plugin disable/uninstall이 blocker로 거부된다.
- Plugin 제거 후 App이 임의 코드를 실행하거나 전체 crash하지 않는다.

## 11. CAA-8 — Product Closure

### 작업

- Starter 예제 App
- CLI manifest validate/export/import
- Backup/restore에 Admin App table 포함
- Unified Audit category와 Retention
- doctor dependency/route drift 검사
- accessibility pass
- large dataset benchmark
- security review
- 운영 문서

### Release Gate

```bash
pnpm check
pnpm test:postgres:all
pnpm test:e2e:admin-apps
pnpm verify:admin-apps
```

새 Gate는 다음을 포함한다.

- Manifest parser property/fuzz test
- PostgreSQL draft/revision/CAS
- mixed Realm session
- Scope/Field permission
- Schema/Plugin drift
- backup/restore
- Chromium Builder와 Runtime 전체 journey

## 12. 구현 중 금지할 지름길

- 기존 Document page 전체 복사
- UI가 전달한 permission 신뢰
- App별 DB query 또는 SQL 저장
- App마다 별도 Vite build
- page number와 post-filter 권한 제거 유지
- Manifest 안에 React component/function 저장
- Role 이름만으로 visibility 판정
- Plugin remote bundle 동적 import
- Builder부터 만들고 Runtime 계약을 나중에 확정

## 13. 첫 번째 목표 릴리스

첫 번째 usable release는 `CAA-0~CAA-5`다.

포함:

- Scope-aware query
- 여러 App
- System/Content audience
- Manifest Draft/Revision
- 별도 Runtime URL
- generated list/form/detail/singleton/revision/hierarchy
- navigation과 기본 customization
- Builder Preview/Apply/Export/Import

제외:

- Dashboard chart
- 복잡한 Bulk Action
- Plugin React Widget
- 최상위 route alias
- 자유 canvas
- 사용자 정의 code
