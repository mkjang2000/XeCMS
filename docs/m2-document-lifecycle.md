# M2 Document Lifecycle 사양

> 상태: Implemented v1.0  
> 기준일: 2026-07-15  
> 상위 계획: [M2 Content Core 구현 계획](./m2-implementation-plan.md)  
> 도메인 기준: [Document와 Revision 사양](./document-revision-specification.md)

## 1. 범위

M2-A는 M0에서 검증한 Document aggregate를 실제 Admin, REST 및 공개 콘텐츠 조회에 연결한다. 이 단계에서는 Revision을 수정하지 않고 pointer와 새 Revision만 변경한다.

- Draft 저장과 Published Revision의 분리
- Publish와 Unpublish
- Revision history, snapshot 조회 및 새 Draft로 Restore
- soft delete, trash, restore와 명시적인 purge
- Admin working view와 Public published view의 분리
- optimistic concurrency와 감사 event 저장

Relation, hierarchy 및 Media는 후속 slice에서 이 생명주기 경계 위에 연결한다.

## 2. 표시 상태

표시 상태는 별도 컬럼을 진실 원천으로 저장하지 않고 aggregate에서 파생한다.

| 상태 | 조건 | Admin 편집 | Public 조회 |
|---|---|---:|---:|
| `draft` | Draft만 존재 | 가능 | 불가 |
| `published` | Publication만 존재 | 가능하며 저장 시 새 Draft 생성 | 가능 |
| `published-with-draft` | Publication과 Draft 동시 존재 | 가능 | 기존 Publication만 가능 |
| `archived` | lifecycle이 archived | 불가 | 불가 |
| `deleted` | deletion marker 존재 | 복원만 가능 | 불가 |

Admin의 `data`는 `draft ?? publication`의 working data다. Public API는 이 projection을 재사용하지 않고 publication pointer가 가리키는 immutable Revision만 읽는다.

## 3. 전송 계약

### 3.1 Admin Document

```ts
interface DocumentRecordDto {
  id: string;
  collectionId: string;
  data: Record<string, unknown>;
  version: number;
  displayState:
    | "draft"
    | "published"
    | "published-with-draft"
    | "archived"
    | "deleted";
  draftRevisionId: string | null;
  publication: {
    revisionId: string;
    publishedAt: string;
    publishedBy: string;
  } | null;
  deletion: {
    deletedAt: string;
    deletedBy: string;
    reason?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}
```

기존 M1 필드는 제거하거나 의미를 바꾸지 않는다. `version`은 Revision sequence가 아니라 aggregate version이다.

### 3.2 Revision

```ts
interface DocumentRevisionSummaryDto {
  id: string;
  sequence: number;
  schemaRevisionId: string;
  origin:
    | { kind: "create" }
    | { kind: "edit" }
    | { kind: "restore"; restoredFromRevisionId: string };
  createdAt: string;
  createdBy: string;
  isCurrentDraft: boolean;
  isPublished: boolean;
}

interface DocumentRevisionDto extends DocumentRevisionSummaryDto {
  data: Record<string, unknown>;
}
```

History 응답은 `items`와 현재 `documentVersion`을 함께 반환한다. 과거 snapshot은 당시 Schema Revision을 참조하므로 현재 편집 form으로 강제 해석하지 않는다.

### 3.3 Public Document

Public 응답에는 게시된 Revision의 data와 Document ID, Collection ID, 게시 metadata만 포함한다. Draft pointer, deletion metadata 및 다른 Revision은 노출하지 않는다.

## 4. REST API

### 4.1 Admin API

```text
GET    /api/collections/:collectionId/documents?state=active|deleted
GET    /api/collections/:collectionId/documents/:documentId
POST   /api/collections/:collectionId/documents/:documentId/publish
POST   /api/collections/:collectionId/documents/:documentId/unpublish
GET    /api/collections/:collectionId/documents/:documentId/revisions
GET    /api/collections/:collectionId/documents/:documentId/revisions/:revisionId
POST   /api/collections/:collectionId/documents/:documentId/revisions/:revisionId/restore
POST   /api/collections/:collectionId/documents/:documentId/restore
DELETE /api/collections/:collectionId/documents/:documentId
DELETE /api/collections/:collectionId/documents/:documentId/purge
```

모든 변경 요청은 `expectedVersion`을 받는다. 기존 `DELETE`는 soft delete 의미를 유지한다. `purge`는 삭제 상태인 Document에만 허용하며 별도 capability와 강한 사용자 확인을 요구한다.

### 4.2 Public API

```text
GET /api/content/:collectionId/documents
GET /api/content/:collectionId/documents/:documentId
```

Public API는 인증 없이 사용할 수 있지만 다음 조건을 모두 만족한 Document만 반환한다.

```text
deletion == null
AND lifecycle == active
AND publication != null
```

게시 후 새 Draft가 생겨도 Public 응답은 다음 Publish 전까지 기존 Revision data를 유지한다.

## 5. 명령 규칙

### 5.1 Publish와 Unpublish

- Publish는 현재 Draft를 Publication으로 지정하고 Draft pointer를 제거한다.
- Published 문서를 편집하면 Publication은 유지되고 새 Draft가 생긴다.
- Unpublish는 Publication을 제거한다. 다른 Draft가 없다면 직전 Publication을 Draft로 돌린다.
- 저장하지 않은 Admin form 값을 Publish에 암묵적으로 포함하지 않는다.

### 5.2 Restore Revision

- 선택한 Revision의 data를 복사해 새 Draft Revision을 만든다.
- 원본 Revision과 현재 Publication은 변경하지 않는다.
- Document ID는 유지한다.
- 복원 data는 현재 active Schema로 다시 검증한다.
- 호환되지 않으면 새 Revision을 만들지 않고 구조화된 validation error를 반환한다.

### 5.3 Delete와 Purge

- soft delete는 Revision, pointer, Publication metadata와 향후 Relation reference를 보존한다.
- restore는 deletion marker만 제거해 삭제 전 lifecycle로 되돌린다.
- purge는 soft-deleted Document만 영구 제거한다.
- Relation이 도입된 후 inbound reference가 존재하는 purge의 기본 정책은 `restrict`다. 과거 immutable Revision을 `nullify`하지 않는다.

## 6. 권한

| Capability | 동작 |
|---|---|
| `document:read` | Admin 목록, 상세, Revision 조회 |
| `document:update` | 새 Draft 저장 |
| `document:publish` | Publish, Unpublish, Revision Restore |
| `document:delete` | soft delete, trash 조회, restore |
| `document:purge` | 영구 삭제 |

Public endpoint는 Admin capability를 요구하지 않으며 Published read model만 사용한다.

## 7. 저장과 감사 경계

- Document pointer 변경, 새 Revision insert, physical working projection 갱신과 audit event insert는 하나의 transaction이다.
- Revision row는 생성 후 update하지 않는다.
- 공개 조회는 working projection이 아닌 publication pointer와 Revision row를 join한다.
- event에는 Actor, 시각, aggregate version과 command 종류를 저장한다.
- purge 시 audit 보존 정책은 Document payload 제거와 분리해 후속 운영 정책으로 확장 가능해야 한다.

## 8. Acceptance Flow

```text
Draft 생성
→ Publish
→ Published 문서 편집으로 새 Draft 생성
→ Admin은 새 Draft, Public은 기존 Published data 확인
→ Revision history 조회
→ 과거 Revision을 새 Draft로 Restore
→ Public data가 바뀌지 않음을 확인
→ 새 Draft Publish
→ soft delete 후 active Admin 목록과 Public 조회에서 제외
→ trash에서 Restore 후 동일 ID와 history 확인
```

각 mutation은 stale `expectedVersion` 요청을 `409 DOCUMENT_VERSION_CONFLICT`로 거부해야 한다.

## 9. 자동화 검증

M2-A의 누적 Gate는 다음 명령으로 실행한다.

```bash
pnpm verify:m2a
```

빠른 실제 경계 검증만 다시 실행할 때는 `pnpm test:e2e`를 사용한다. 이 명령은
별도의 임시 PostgreSQL을 시작해 integration test와 빌드된 Admin의 Chromium
journey를 실행한 뒤 컨테이너를 제거한다.

PostgreSQL integration은 다음 경계를 검증한다.

- Draft, Publish, Published-with-draft, Unpublish, Restore, soft delete와 purge
- Public data, Revision ID와 `updatedAt`의 게시 Revision 고정
- stale `expectedVersion` 거부와 동시 저장 시 단일 성공 및 orphan Revision 부재
- purge capability 거부, purge 후 aggregate/Revision 제거와 audit event 보존
- audit payload의 콘텐츠 data 비저장 및 민감한 본문 문자열 비노출
- 기존 0001/0002 DB의 0003 event migration upgrade와 재실행 idempotency

Playwright journey는 M1 bootstrap과 Schema 적용 흐름을 보존하면서 다음 사용자
동작을 이어서 검증한다.

- 상태 배지와 Publish/Published-with-draft 전이
- Revision history, JSON snapshot 미리보기와 새 Draft 복원
- 휴지통 복원 및 기존 Publication의 재공개
- 문서 ID가 일치하기 전 비활성인 영구 삭제 확인, stale purge의 충돌 안내와
  최신 버전 재시도, 성공 후 Admin/Public `404`

로컬 개발 서버가 기본 포트를 사용 중이라면 종료하지 않고 별도 포트에서
검증할 수 있다.

```bash
XECMS_SERVER_URL=http://127.0.0.1:3101 \
XECMS_E2E_ADMIN_URL=http://127.0.0.1:3101 \
pnpm test:e2e
```
