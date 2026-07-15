# XeCMS M2 Content Core 운영 및 검증

> 상태: 완료 (2026-07-15)  
> 상위 문서: [XeCMS MVP 사양서](./mvp-specification.md)  
> 구현 계획: [M2 Content Core 구현 계획](./m2-implementation-plan.md)  
> 실행 예제: [M2 Blog example](../examples/blog/README.md)

이 문서는 M2 Content Core를 빈 환경에 설치하고 Schema breadth, stable Relation, 계층형 콘텐츠와 local Media를 운영하는 기준 절차를 정의한다. 2026-07-15 최종 Gate가 실제 PostgreSQL과 Chromium에서 통과해 M2를 완료 상태로 확정했다.

## 1. 제공 경계

### Schema

- Singleton과 반복 Collection
- 재사용 Component와 Blocks
- text, textarea, number, boolean, date, datetime, select, enum, JSON
- object, array, relation, upload와 최소 Rich Text 저장 계약
- canonical Manifest export/import
- 같은 Manifest에 대해 byte-for-byte 재현되는 TypeScript type
- stable Schema Object ID 기반 diff와 Migration Preview

### Content

- stable Document ID와 append-only Revision
- partial merge 방식의 Document `PATCH`; 생략한 필드와 비가시 필드는 보존
- Draft, Publish, Published-with-draft, Revision Restore
- one/many Relation과 target Collection/Document 존재 검사
- `restrict`, `nullify`, `cascade` 삭제 계획
- soft delete, trash restore와 별도 purge 경계

### Hierarchy

- Collection별 forest와 여러 root
- parent, sibling order, depth, path와 closure
- root/children/ancestors/descendants/subtree 조회
- optimistic version을 받는 move/reorder transaction
- cycle, 다른 Collection parent와 `maxDepth` 초과 거부
- Admin Tree View와 breadcrumb

### Media

- stable Media ID와 PostgreSQL metadata
- 공식 MVP local filesystem adapter
- signature를 확인하는 streaming upload
- 업로드 크기와 MIME allow-list
- one/many Upload Field reference
- missing file, orphan object와 incomplete metadata 정합성 검사

### 현재 참조 필드 경계

M2의 Relation과 Upload Field는 Collection의 최상위 필드에서만 지원한다. object, array, component 또는 blocks 안에 중첩된 참조 필드는 Schema 적용 전에 `UNSUPPORTED_NESTED_REFERENCE`로 거부한다. 중첩 값에 대한 안정적인 reference edge 추출과 삭제 정책은 M2 이후 범위다.

## 2. 설치와 실행

필요한 도구와 M1 기본 실행 절차는 [M1 로컬 실행 및 검증](./m1-development.md)을 따른다.

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
pnpm db:up
pnpm dev:m1
```

기본 주소는 Admin `http://127.0.0.1:5173/admin/`, API `http://127.0.0.1:3100/api`다. 서버 시작 시 M0~M2 core migration을 순서대로 idempotent하게 적용해야 한다.

로컬 편의 계정 `admin/admin`은 `NODE_ENV=development`와 `XECMS_DEV_SEED=true`에서만 사용한다. 공유·스테이징·운영 환경에서는 seed를 끄고 `/admin/setup`에서 고유한 Owner를 생성한다.

## 3. Media 설정

| 환경 변수 | 기본값 | 의미 |
|---|---|---|
| `XECMS_MEDIA_STORAGE_ROOT` | `.xecms/media` | local object storage의 절대 해석 기준 경로 |
| `XECMS_MEDIA_MAX_UPLOAD_BYTES` | `26214400` | 한 파일의 최대 byte 수 |
| `XECMS_MEDIA_ALLOWED_MIME_TYPES` | `image/png,image/jpeg,image/gif,image/webp,application/pdf` | 쉼표로 구분한 signature 검증 허용 목록 |

운영에서는 Storage Root를 애플리케이션 소스와 정적 Admin 파일 밖의 전용 volume에 둔다. 서버 프로세스만 읽고 쓸 수 있게 권한을 제한하며, DB backup과 같은 복구 시점으로 함께 보존한다.

다음 입력은 업로드 전에 거부한다.

- `/`, `\\`, 제어 문자를 포함하거나 `.`/`..`인 파일 이름
- allow-list에 없는 선언 MIME
- 선언 MIME과 signature 검사 결과가 다른 파일
- byte 제한을 넘거나 비어 있는 파일
- Storage Root 밖으로 해석되는 key와 symlink 탈출

Metadata는 `pending → ready` 또는 `failed` 상태로 전이한다. 파일 쓰기 실패와 metadata 확정 실패는 부분 파일을 정리하며, 남은 불일치는 정합성 검사로 관측할 수 있어야 한다.

## 4. Blog Manifest 적용

[`examples/blog/xecms.schema.json`](../examples/blog/xecms.schema.json)은 M2의 canonical smoke fixture다.

```text
Admin 로그인
→ Schema Manifest import
→ Migration Preview 검토
→ destructive 변경이 있다면 명시적 승인
→ Apply
→ Media 업로드
→ Site Settings, Author, Category, Post 생성
→ Pages Tree View에서 구조 편집
```

Manifest import는 적용을 우회하지 않고 Draft를 만든다. 반드시 Preview와 Apply를 별도로 수행한다. export/import는 Collection, Field, Relation과 Component의 stable ID를 보존한다.

주요 Schema API는 다음과 같다.

```text
GET  /api/schema/manifest
PUT  /api/schema/manifest
GET  /api/schema/types
POST /api/schema/preview
POST /api/schema/apply
```

현재 typed contract에서 export는 canonical `schema`, `serialized`, SHA-256 `hash`를 반환하고 type generation은 `fileName`, `source`, `hash`를 반환한다. 같은 active Schema에서 연속 호출한 결과는 완전히 같아야 한다.

## 5. Relation 운영 규칙

Relation 값은 Revision ID나 자연키가 아닌 stable Document ID다.

```json
{
  "author": "doc_author_id",
  "relatedPosts": ["doc_first_post", "doc_second_post"]
}
```

저장 transaction은 다음을 함께 검사한다.

- target Document가 존재하고 soft delete되지 않았는가
- target이 Field의 `targetCollectionId`에 속하는가
- cardinality가 one/many 계약과 맞는가
- 같은 many target이 중복되지 않았는가
- Document 전체 reference 수가 서버 제한 안인가

soft delete는 stable identity와 inbound/outbound Relation edge를 보존한다. 따라서 source의 현재 값은 바뀌지 않고, target을 restore하면 같은 Document ID와 원래 Relation으로 돌아온다. 이 단계에서는 `restrict`, `nullify`, `cascade`를 실행하지 않는다.

세 삭제 정책은 identity를 실제로 제거하는 hard purge 전에 inbound Relation edge를 기준으로 계획한다. target은 먼저 soft delete 상태여야 하며, 과거 immutable Revision을 다시 쓰지 않는다.

| 정책 | 동작 |
|---|---|
| `restrict` | 참조가 하나라도 있으면 target purge를 `409`로 거부한다. 생략 시 기본값이다. |
| `nullify` | one은 값을 제거하고 many는 target ID만 제외한 새 Draft Revision을 만든 뒤 target을 purge한다. |
| `cascade` | source Document도 soft delete 후 purge한다. 연쇄 계획은 cycle을 검사한다. |

과거 immutable Revision은 다시 쓰지 않는다. 따라서 현재 Draft의 Relation이 nullify되어도 과거 Revision snapshot은 감사 가능한 원본을 유지한다.

## 6. 계층형 콘텐츠 운영 규칙

Hierarchy가 활성화된 Collection은 Document 생성 시 root 위치를 가진다. 구조 변경은 본문 Revision 편집과 분리된 command다. soft delete는 tree 위치와 closure를 보존하고 restore는 원래 위치를 그대로 되살린다. hard purge에서만 node를 제거하고 남은 자식과 sibling order를 transaction 안에서 정리한다.

```text
GET  /api/collections/:collectionId/tree
POST /api/collections/:collectionId/documents/:documentId/move
```

Tree 조회에서 받은 hierarchy `version`을 move의 `expectedVersion`으로 보낸다.

```json
{
  "newParentId": "doc_parent_id",
  "position": 0,
  "expectedVersion": 7
}
```

move는 parent, sibling order, depth, path와 closure를 한 transaction에서 갱신한다. 실패하면 어느 일부도 반영하지 않는다. 다음 command는 거부한다.

- 자기 자신 또는 자신의 후손 아래로 이동
- 다른 Collection의 Document를 parent로 사용
- `maxDepth`보다 깊어지는 subtree 이동
- stale hierarchy version으로 이동·정렬

`permissionInheritance`가 켜진 Collection은 이동 전후의 Document/Resource path와 영향을 받는 subtree ID를 권한 영향 정보로 제공한다. M2에서는 구조 자체를 Revision으로 versioning하지 않는다.

M3에서는 이 콘텐츠 tree를 실제 Document Resource graph로 투영하고, 이동 전에
Permission과 필드 접근 변화를 계산한 뒤 tree/policy revision을 함께 확인한다. 세부
운영 규칙은 [M3 Authorization Platform](./m3-authorization-platform.md)을 따른다.

## 7. Media API와 정합성 검사

```text
GET    /api/media
POST   /api/media
GET    /api/media/:mediaId/content
DELETE /api/media/:mediaId
POST   /api/media/consistency
```

Upload 요청 body는 파일 byte stream이며 `Content-Type`, URL-encoded `X-File-Name`과 CSRF token을 보낸다. Upload Field에는 반환된 Media ID를 저장한다. 참조 중인 Media metadata 삭제는 DB reference constraint가 거부해야 한다.

정합성 보고서는 최소 다음 항목을 구분한다.

- `missing`: ready metadata는 있으나 파일이 없음
- `orphanStorageKeys`: 파일은 있으나 metadata가 없음
- `incomplete`: pending/failed metadata
- `healthyCount`: ready이면서 파일도 존재하는 수

정합성 검사는 보고 작업이며 자동으로 데이터를 삭제하지 않는다. orphan 제거와 missing 복구는 backup 확인 후 운영자가 별도 작업으로 수행한다.

## 8. 복구와 변경 관리

### Schema apply 실패

Migration 기록과 physical operation이 같은 transaction에서 완료되지 않으면 applied Revision으로 표시하지 않는다. 실패 원인을 수정하고 같은 Draft를 다시 Preview한다. destructive approval은 새 Preview plan에 재사용하지 않는다.

### DB와 Media 복구

1. 쓰기를 중지한다.
2. PostgreSQL과 Media volume을 같은 복구 시점으로 되돌린다.
3. core migration을 재실행한다.
4. `/api/media/consistency`를 실행한다.
5. missing/orphan이 없음을 확인한 뒤 쓰기를 재개한다.

DB만 복구하면 새 파일이 orphan으로, Media만 복구하면 metadata가 missing으로 나타날 수 있다. 정합성 보고 없이 한쪽만 임의로 삭제하지 않는다.

## 9. 자동화 검증

M2 전용 isolated Gate는 개발 서버 기본 포트와 충돌하지 않도록 `3110`을 사용한다. 임시 PostgreSQL schema와 Media directory는 종료 시 제거된다.

```bash
pnpm test:e2e:m2
```

필요하면 전용 주소와 DB를 지정한다.

```bash
XECMS_M2_SERVER_URL=http://127.0.0.1:3111 \
XECMS_M2_DATABASE_URL=postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e \
pnpm test:e2e:m2
```

문서 링크, boundary, typecheck와 unit test를 포함한 누적 M2 release Gate는 다음 명령이다.

```bash
pnpm verify:m2
```

이 Gate는 다음을 수행한다.

1. workspace와 Admin을 production mode로 build한다.
2. 실제 PostgreSQL에서 Relation/Media와 Hierarchy integration test를 실행한다.
3. Server API integration test를 실행한다.
4. 빈 Instance를 bootstrap한다.
5. Blog Manifest를 import, Preview, Apply하고 export/type 재현성을 확인한다.
6. Media upload/content/정합성 및 거부 경계를 확인한다.
7. Singleton과 one/many Relation target 검사를 확인한다.
8. Publish/Restore와 soft delete/restore 후 Relation ID 유지, hard purge의 세 삭제 정책을 확인한다.
9. forest 이동·정렬·위치 복원, cycle, cross-collection과 max-depth 거부를 확인한다.
10. 빌드된 Admin의 Schema, Tree View, Media 화면과 브라우저 오류 부재를 확인한다.

## 10. Release checklist

2026-07-15 최종 검증 결과는 다음과 같다.

- [x] `pnpm check`
- [x] `pnpm build:admin`
- [x] M2 PostgreSQL integration — Test Files 2, Tests 8 passed
- [x] M2 Server API integration — Test Files 2, Tests 17 passed
- [x] Chromium M2 full journey — Blog 시나리오 1 passed (13.6s)
- [x] 동일 Manifest/type의 byte 재현성
- [x] Schema apply 실패 rollback
- [x] Relation 세 삭제 정책과 restore 안정성
- [x] Hierarchy transaction, cycle, cross-collection, maxDepth
- [x] Media size/MIME/path와 missing/orphan 검사
- [x] Chromium Admin 기능·시각 검수와 브라우저 오류 부재

전체 TS build와 Admin production build가 성공했고, isolated PostgreSQL·Media 환경 및 E2E 컨테이너도 종료 후 정상 정리됐다. 이 결과를 근거로 [MVP 사양서](./mvp-specification.md)의 M2 상태를 `완료`로 확정한다.
