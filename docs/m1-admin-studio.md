# XeCMS M1 Admin Studio 설계

> 상태: M1 구현 완료 (2026-07-15)  
> 기준일: 2026-07-15  
> 관련 문서: [M1 로컬 실행 및 검증](./m1-development.md)

## 1. 결정

M1 Admin Studio는 React와 Vite로 빌드하는 TypeScript SPA다. Admin은 SEO나
서버 렌더링이 필요한 화면이 아니며 상호작용 중심이므로 SSR 프레임워크를
도입하지 않는다.

- React Router Data Mode로 route object를 조립한다.
- TanStack Query가 서버 상태와 invalidation을 담당한다.
- React Hook Form이 입력과 필드 오류를 담당한다.
- React Aria Components를 `@xecms/ui`로 감싸 접근성 primitive로 사용한다.
- CSS Modules와 CSS Custom Properties로 스타일과 theme token을 분리한다.
- 별도 전역 상태 라이브러리는 M1에 도입하지 않는다.

개발 중에는 Vite가 `/api`를 XeCMS 서버로 proxy한다. 배포 환경에서는 빌드된
정적 Admin asset을 XeCMS 서버와 같은 origin에서 제공하는 구성을 기본으로
한다. 브라우저는 DB나 domain package에 직접 접근하지 않는다.

```text
Admin Studio
→ @xecms/client
→ REST API
→ Application Service
→ Domain
→ PostgreSQL
```

## 2. 패키지 경계

| 패키지 | 책임 |
|---|---|
| `@xecms/contracts` | REST DTO, 구조화 오류와 전송 규격 |
| `@xecms/client` | React와 무관한 typed HTTP client 및 CSRF 처리 |
| `@xecms/ui` | 접근 가능한 UI primitive와 design token |
| `@xecms/admin` | Field Registry와 Admin 확장 계약 |
| `@xecms/admin-app` | 실제 route, page와 query 조합 |

Schema IR에는 React component를 저장하지 않는다. 필드 표현은 registry가
타입별 component를 연결하며, 이후 Schema IR에는 직렬화 가능한 widget hint만
추가할 수 있다.

```text
text     → Text editor
number   → Number editor
boolean  → Checkbox editor
datetime → Date-time editor
```

외부 plugin이 registry에 직접 개입하는 공개 Admin SDK는 M4에서 안정화한다.

## 3. Route

| Route | 책임 |
|---|---|
| `/admin/setup` | 빈 Instance의 최초 Owner 생성 |
| `/admin/login` | System Identity 로그인 |
| `/admin/schema` | Collection 목록 |
| `/admin/schema/new` | Collection과 Field 초안 생성 |
| `/admin/schema/:collectionId` | Collection 초안 편집 |
| `/admin/schema/:collectionId/changes` | Migration preview 및 적용 |
| `/admin/content` | 적용된 Collection 목록 |
| `/admin/content/:collectionId` | Document 목록 |
| `/admin/content/:collectionId/new` | Document 생성 |
| `/admin/content/:collectionId/:documentId` | Document 편집과 삭제 |

인증이 없는 사용자가 보호 route에 접근하면 `/admin/login`으로 이동한다. 아직
bootstrap이 필요한 Instance에서는 `/admin/setup`으로 이동한다. bootstrap이
끝난 뒤 setup 화면은 다시 열 수 없다.

## 4. Schema 변경 흐름

Schema UI는 DB에 즉시 변경을 가하지 않는다.

```text
Collection 편집
→ Schema Draft 저장 및 검증
→ Diff와 Migration Preview
→ 위험도 표시
→ 명시적 Apply
→ Schema Registry와 physical table 반영
```

기본 화면에는 name, label, type, required를 보여준다. stable ID와 같은 내부
정보는 Advanced 영역에서 읽을 수 있지만 raw manifest를 직접 수정하게 하지는
않는다. 파괴적 변경은 색상 외에도 텍스트와 승인 control로 구분한다.

Schema revision 충돌이 발생하면 사용자의 입력을 자동으로 덮어쓰지 않고 최신
버전을 다시 불러오도록 안내한다. 저장하지 않은 변경이 있는 상태로 route를
벗어나거나 브라우저를 닫을 때 이탈 경고를 표시한다.

## 5. 상태 소유권

| 상태 | 소유 위치 |
|---|---|
| session, schema, collection, document | TanStack Query cache |
| form 입력과 validation error | React Hook Form |
| page, 정렬과 필터 | URL search parameter |
| dialog, disclosure 등 일시적 UI | React local state |

Mutation이 성공하면 관련 query key만 invalidation한다. HTTP 409 revision/version
충돌은 일반 오류와 분리해 덮어쓰기 방지 UI를 보여준다.

## 6. M1 접근성 및 사용감 기준

- 주요 흐름을 키보드만으로 완주할 수 있어야 한다.
- 모든 입력에는 보이는 label과 구조화된 오류 메시지가 있어야 한다.
- form과 navigation에는 접근 가능한 이름을 제공한다.
- 비동기 진행, 성공과 실패를 `status` 또는 `alert`로 알린다.
- focus를 임의로 잃지 않으며 인증 오류는 첫 관련 입력으로 이동한다.
- migration 위험도와 validation 상태를 색상만으로 표현하지 않는다.
- 좁은 화면에서도 Schema와 Document form이 단일 열로 사용할 수 있어야 한다.
- 구현되지 않은 M2 이후 메뉴를 비활성 placeholder로 노출하지 않는다.

Playwright E2E는 CSS selector나 내부 React 구조보다 role, label과 accessible
name을 우선 사용한다. 이 접근성 계약은 UI 테스트의 안정성 계약이기도 하다.
