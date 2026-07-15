# XeCMS Admin Studio 사양서

> 상태: Accepted v1.1  
> 기준일: 2026-07-15  
> 관련 문서: [시스템 사양서](./system-specification.md), [MVP 사양서](./mvp-specification.md)

## 1. 목표

Admin Studio는 별도의 설정 원천이나 DB 관리 도구가 아니다. Schema IR과 Application Service를 브라우저에서 사용하는 공식 클라이언트다. UI, CLI, SDK 및 REST API는 동일한 도메인 명령과 권한 판정을 사용한다.

초급 사용자와 고급 사용자를 별도 제품으로 나누지 않는다. 기본 화면은 자주 사용하는 안전한 설정을 우선하고, stable ID, canonical manifest, migration SQL 및 구조화 오류 같은 기술 정보는 같은 화면의 Advanced 영역에서 점진적으로 공개한다.

## 2. 기술 결정

```text
React + TypeScript
├── Vite                    build/dev server
├── React Router Data Mode route composition
├── TanStack Query         server state
├── React Hook Form        form state
├── TanStack Table         document tables
└── React Aria Components  accessible primitives
```

- Admin Studio는 런타임 SSR이 없는 SPA다.
- 개발 환경에서 Vite는 `/api`를 XeCMS 서버로 proxy한다.
- 프로덕션에서는 XeCMS 서버가 빌드된 Admin asset을 `/admin`에서 같은 origin으로 제공한다.
- 공개 콘텐츠 사이트의 SSR/SSG 프레임워크 선택은 `@xecms/client` 사용자의 책임으로 남긴다.
- Redux나 범용 전역 store는 M1에 도입하지 않는다.
- CSS Modules와 semantic CSS Custom Properties를 사용한다.
- Tailwind class와 외부 primitive의 타입을 Plugin 공개 계약으로 사용하지 않는다.

### 2.1 시각 디자인 원칙

Admin Studio의 기본 인상은 **현대적이고 절제된 개발자용 작업 도구**다. 일반 그룹웨어 Admin의 명확한 좌측 탐색, 밝은 작업 영역, 정보 밀도 높은 카드 구성을 참고할 수 있지만 특정 제품의 색상, 아이콘, 화면 배치나 브랜드 표현을 그대로 복제하지 않는다.

- 깊은 ink/navy 계열은 탐색 프레임에 한정하고 작업 영역은 차가운 off-white canvas와 흰 surface를 사용한다.
- 기본 action accent는 indigo 계열을 사용하며 green, amber, red는 성공, 주의, 위험 같은 의미 상태에 우선 배정한다.
- 정보 위계는 과한 그림자보다 surface, 얇은 border, 간격과 타이포그래피로 표현한다. popover와 dialog에만 강한 elevation을 허용한다.
- 기본 밀도는 `comfortable-compact`다. 데스크톱에서 많은 정보를 비교할 수 있어야 하지만 주요 입력과 touch target은 약 42~44px를 유지한다.
- 카드, 입력 폼, table, dialog 및 상태 표시는 semantic design token과 `@xecms/ui` primitive를 사용한다. 화면별 임의 색상과 control 구현을 늘리지 않는다.
- 둥근 모서리는 계층을 구분하는 보조 수단으로 사용하고 모든 요소를 pill 형태로 만들지 않는다.
- 애니메이션은 상태 이해를 돕는 120~180ms 수준으로 제한하며 reduced motion 설정을 존중한다.
- 작은 화면에서도 현재 navigation, 계정 식별, 로그아웃 및 핵심 action을 제거하지 않는다. 레이아웃 밀도와 배치만 바꾼다.
- Plugin UI도 동일 토큰을 기본으로 사용하되, 공개 Admin SDK가 확정되기 전에는 내부 CSS class를 안정 계약으로 노출하지 않는다.

M1 이후 시각 개편은 위 원칙을 기준선으로 삼는다. 브랜드 그래픽, 고급 motion, 테마 변형과 화면별 세부 polish는 기능 구조가 안정된 뒤 별도 단계에서 진행한다.

## 3. 패키지 경계

```text
@xecms/contracts  전송 DTO, 오류 및 직렬화 계약
       ↓
@xecms/client     React 비종속 typed HTTP client
       ↓
@xecms/admin      Admin API와 field registry의 내부 계약
       ├── @xecms/ui
       └── apps/admin
```

- `@xecms/ui`는 Button, Dialog, FormField 같은 도메인 비종속 컴포넌트를 제공한다.
- `@xecms/admin`은 Schema field와 renderer를 연결하는 registry를 제공한다.
- `apps/admin`은 route, 화면 및 built-in renderer를 조합한다.
- Admin은 database 및 server package를 import하지 않는다.
- M1의 registry는 내부 확장 지점이며 외부 Plugin API로 안정성을 약속하지 않는다. 공개 Admin SDK는 M4에서 확정한다.

## 4. Schema 편집 흐름

```text
Schema Draft
→ Validate
→ Diff
→ Migration Preview
→ Apply
→ Schema Registry
```

- Collection과 Field의 영구 ID는 Schema Registry가 발급한다.
- 이름을 변경해도 stable ID를 보존한다.
- Draft 저장은 physical database를 변경하지 않는다.
- Apply는 optimistic revision 조건과 Workspace 단위 migration lock을 사용한다.
- destructive operation은 명시적 승인이 없으면 적용하지 않는다.
- revision 충돌 시 기존 변경을 덮어쓰지 않고 최신 revision 기준으로 다시 검토한다.
- M1에서는 canonical manifest를 읽을 수 있지만 raw JSON을 직접 편집하지 않는다.

Schema Builder는 자유 캔버스가 아닌 세 영역으로 시작한다.

```text
Collection/Field 목록 | Field Inspector | Diff/Migration Preview
```

## 5. 콘텐츠 편집 흐름

Field renderer는 직렬화 가능한 field definition과 registry를 통해 선택한다.

```ts
fieldRegistry.register("text", TextFieldRenderer);
fieldRegistry.register("number", NumberFieldRenderer);
fieldRegistry.register("boolean", BooleanFieldRenderer);
fieldRegistry.register("datetime", DateTimeFieldRenderer);
```

Schema IR에는 React component나 함수를 저장하지 않는다. 향후 custom renderer는 namespaced 문자열 ID를 사용한다.

- Document 목록은 server pagination을 사용한다.
- 편집은 명시적인 Save 동작을 사용한다.
- 저장하지 않은 변경이 있으면 route 이탈 전에 경고한다.
- server validation issue의 path를 화면 오류 요약과 해당 field에 연결한다.
- 401, 403, 409, session expiration, empty, loading 및 server failure 상태를 명시적으로 처리한다.

## 6. M1 정보 구조

```text
/admin/setup
/admin/login
/admin/schema
/admin/schema/:collectionId
/admin/schema/:collectionId/changes
/admin/content/:collectionId
/admin/content/:collectionId/new
/admin/content/:collectionId/:documentId
```

M1 navigation에는 실제로 사용할 수 있는 Content와 Schema만 표시한다. Access, Media, Tree 및 Extensions는 해당 milestone에서 기능과 함께 추가한다.

### 6.1 M2-A Document Lifecycle 확장

```text
/admin/content/:collectionId/trash
/admin/content/:collectionId/:documentId/revisions
/admin/content/:collectionId/:documentId/revisions/:revisionId
```

- Collection workspace에는 문서 목록과 휴지통을 route 기반으로 제공한다.
- 편집 화면은 Draft, Published, Published-with-draft, Archived와 Deleted 상태를 명시한다.
- Publish는 저장되지 않은 form data를 암묵적으로 포함하지 않는다. dirty form에서는 먼저 저장하도록 안내한다.
- 과거 Revision은 현재 Schema form으로 강제 해석하지 않고 읽기 전용 JSON snapshot으로 표시한다.
- Restore는 원본 Revision을 수정하지 않고 새 Draft를 만든다는 점을 확인 dialog에 명시한다.
- soft delete는 버전과 참조를 보존하며, purge는 Document ID 재입력이 필요한 별도 위험 작업으로 제공한다.
- background refetch로 더 최신 aggregate version이 도착해도 dirty form을 자동 reset하지 않는다. 사용자가 명시적으로 최신 버전을 불러오게 한다.
- 변경 명령 실패 시 dialog 뒤에 오류를 숨기지 않고 dialog를 닫은 뒤 화면에서 conflict 또는 구조화 오류를 표시한다.

## 7. 보안 경계

- session은 HttpOnly cookie를 사용한다.
- production cookie에는 Secure를 적용하고 SameSite 기본값을 사용한다.
- 상태 변경 요청은 CSRF token과 origin 검사를 통과해야 한다.
- UI capability는 표시 여부를 위한 힌트일 뿐이며 서버 authorization이 최종 판정한다.
- Admin UI도 REST 및 Local API와 동일한 Application Service를 사용한다.
- 개발 편의를 위한 `admin/admin` seed는 development에서만 허용한다. production에서 해당 seed 설정은 서버 시작 오류다.

## 8. 접근성 및 품질

- WCAG 2.2 AA를 목표로 한다.
- 주요 흐름은 pointer 없이 수행할 수 있어야 한다.
- 상태를 색상만으로 구분하지 않는다.
- 오류 요약에서 오류 field로 focus를 이동할 수 있어야 한다.
- focus 복구와 reduced motion을 지원한다.
- M1 Admin의 기본 UI 언어는 한국어다. message catalog 분리와 영어 locale은
  M2에서 공개 필드·오류 문구가 확장될 때 함께 도입한다.
- component test는 Vitest와 Testing Library, 전체 사용자 흐름은 Playwright로 검증한다.

M1 browser acceptance flow는 다음과 같다.

```text
Owner bootstrap 또는 개발 seed 로그인
→ Posts Collection 생성
→ title/body/publishedAt Field 구성
→ Migration Preview 및 Apply
→ Post 생성·조회·수정·삭제
→ REST 결과와 Admin 결과 비교
```

## 9. M1 제외 범위

- RBAC matrix와 권한 simulator
- Tree View와 drag move
- Revision, Draft 및 Publish UI
- Media
- raw manifest editor
- 외부 Plugin bundle과 공개 Admin SDK
- dashboard 및 analytics
- runtime SSR, Module Federation 및 micro frontend
