# XeCMS Document와 Revision 사양

> 단계: M0 Domain Prototype / M2 Document Lifecycle  
> 상태: 구현 기준 v1.1  
> 관련 패키지: `@xecms/core`

## 1. 목적

Document의 안정적인 Identity와 변경 불가능한 콘텐츠 Revision을 분리한다. 게시 상태, 운영상 Archive 및 Soft Delete를 하나의 status enum에 합치지 않는다.

## 2. Aggregate

```text
Document Aggregate
├── Identity
│   ├── Current Draft Revision
│   ├── Publication
│   ├── Lifecycle
│   └── Deletion
├── Immutable Revisions
└── Aggregate Version
```

Published Revision과 새로운 Draft Revision은 동시에 존재할 수 있다.

## 3. 상태 축

### 3.1 Draft와 Publication

- Draft는 현재 편집 중인 Revision pointer다.
- Publication은 공개 중인 Revision, 게시 시각 및 게시 Actor의 묶음이다.
- Publish는 새 Revision을 만들지 않고 현재 Draft를 Publication으로 지정한다.
- Published 문서를 편집하면 Publication을 유지하고 새 Draft를 만든다.

### 3.2 Lifecycle

```text
active ↔ archived
```

Archive는 운영상 비활성화다. Revision과 pointer를 보존하지만 편집과 공개 조회를 차단한다.

### 3.3 Deletion

Soft Delete는 휴지통 상태다. Revision, Relation target ID, Publication 및 Lifecycle을 보존한다. Restore하면 삭제 전 Active/Archived 상태로 돌아간다.

## 4. Revision

Revision은 생성 후 변경하지 않는다.

```ts
interface DocumentRevision<TData> {
  id: RevisionId;
  documentId: DocumentId;
  sequence: number;
  schemaRevisionId: SchemaRevisionId;
  data: TData;
  parentRevisionId: RevisionId | null;
  origin: "create" | "edit" | "restore";
  createdAt: UtcInstant;
  createdBy: SubjectId;
}
```

저장 data는 JSON 값만 허용하며 복사 후 freeze한다. Command 이후 호출자가 입력 객체를 수정해도 저장 Revision이 바뀌지 않아야 한다.

## 5. Command 전이

| Command | 결과 |
|---|---|
| Create | Identity와 첫 Draft Revision 생성 |
| Edit | `draft ?? published`를 부모로 새 Draft 생성 |
| Publish | 현재 Draft를 Publication으로 지정하고 Draft pointer 제거 |
| Unpublish | Publication 제거, Draft가 없으면 기존 Published를 Draft로 지정 |
| Restore Revision | 과거 내용을 복사한 새 Draft 생성, Publication 유지 |
| Archive | pointer를 보존하고 lifecycle을 archived로 변경 |
| Unarchive | lifecycle을 active로 변경 |
| Soft Delete | pointer를 보존하고 deletion marker 추가 |
| Restore Deleted | deletion marker 제거 |

모든 Command는 ID, 시간, Actor 및 expected aggregate version을 입력받는다. Domain은 시간과 ID를 내부 생성하지 않는다.

## 6. 파생 상태

표시 상태는 저장하지 않고 pointer와 lifecycle에서 파생한다.

```text
draft
published
published-with-draft
archived
deleted
```

공개 Revision은 다음 조건을 모두 만족할 때만 반환한다.

```text
deletion == null
AND lifecycle == active
AND publication != null
```

## 7. Relation Reference

Relation은 Revision ID가 아니라 안정적인 Document ID를 참조한다.

```ts
interface DocumentReference {
  collectionId: CollectionId;
  documentId: DocumentId;
}
```

- Relation target의 Soft Delete가 참조 ID를 자동 삭제하지 않는다.
- Revision ID가 Relation payload로 들어오는 것을 type 및 runtime validation에서 거부한다.
- Purge 시 inbound Relation의 기본 정책은 `restrict`다. `nullify`가 필요하면 과거
  Revision을 수정하지 않고 참조 소유 Document에 새 Draft를 만드는 별도 workflow를
  사용한다.

## 8. Application과 감사 규칙

- Admin working data와 Public published data는 별도 read model로 조회한다.
- Public 조회는 `deletion == null`, `lifecycle == active`, `publication != null`을 모두 검사한다.
- Restore 대상 data는 현재 active Schema로 다시 검증한 뒤 새 Draft로 저장한다.
- Publish와 Restore를 포함한 domain event는 aggregate 변경과 같은 transaction에 기록한다.
- 모든 변경 command는 aggregate version을 비교하며 stale version을 거부한다.

## 9. 불변 규칙

1. Identity는 첫 Revision 없이 존재할 수 없다.
2. Draft 또는 Publication 중 하나 이상이 존재해야 한다.
3. 모든 pointer는 같은 Document의 존재하는 Revision을 가리킨다.
4. Revision ID와 sequence는 Document 안에서 고유하다.
5. sequence는 1부터 단조 증가한다.
6. parent와 restore source는 같은 Document의 이전 Revision이다.
7. 모든 Revision은 작성 당시 Schema Revision을 참조한다.
8. Published 문서 편집은 Publication pointer를 바꾸지 않는다.
9. Restore는 Publication pointer를 바꾸지 않는다.
10. Archive와 Soft Delete는 Revision 및 pointer를 바꾸지 않는다.
11. 삭제 상태에서는 Restore Deleted 외 일반 변경을 거부한다.
12. Archived 상태에서는 Unarchive 및 Soft Delete 외 일반 변경을 거부한다.
13. stale aggregate version Command를 거부한다.

## 10. 검증 범위

- Create, Edit, Publish, Unpublish
- Published-with-Draft
- Restore Revision
- Archive/Unarchive
- Soft Delete/Restore Deleted
- stale version 거부
- 다른 Document Revision 거부
- pointer 및 sequence 불변식
- JSON data 불변성
- Relation reference 검증
- 허용·거부 Command sequence matrix
- Published-with-Draft 상태에서 Public 조회의 기존 게시본 유지
- Revision history와 새 Draft Restore
- soft delete, trash restore 및 purge 경계
