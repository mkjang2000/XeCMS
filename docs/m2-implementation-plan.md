# XeCMS M2 Content Core 구현 계획

> 상태: 완료 v1.0 (2026-07-15)  
> 기준일: 2026-07-15  
> 상위 문서: [XeCMS MVP 사양서](./mvp-specification.md)  
> 목적: M2를 검증 가능한 vertical slice로 나누고 데이터·API·Admin·테스트의 완료 경계를 고정한다.

## 1. 구현 원칙

M2는 M1의 CRUD를 기능별로 넓히는 단계가 아니라 실제 콘텐츠 운영에 필요한 생명주기와 구조를 완성하는 단계다. 각 slice는 Domain, PostgreSQL, Application Service, REST/Local API와 Admin Studio를 함께 통과해야 한다.

- 안정적인 Document ID와 append-only Revision을 유지한다.
- Published Revision을 편집으로 직접 덮어쓰지 않는다.
- Relation은 Revision ID가 아닌 Document ID를 참조한다.
- 계층 위치는 M2에서 versioning하지 않고 전용 command와 audit event로 관리한다.
- 삭제는 기본적으로 soft delete이며 purge는 별도 capability와 명시적 API로 분리한다.
- Schema Manifest와 generated type은 같은 canonical Schema IR에서 만든다.
- 아직 제공하지 않는 기능을 Admin navigation에 빈 메뉴로 노출하지 않는다.
- 현재 Admin 디자인 토큰과 공통 UI primitive를 유지하고 기능에 필요한 컴포넌트만 추가한다.

## 2. 기존 기반

M1 완료 시점에 다음 M2 기반은 이미 존재한다.

- `@xecms/core`의 Document Identity, Revision, Draft/Published pointer와 lifecycle transition
- Revision restore, publish/unpublish, archive, soft delete 도메인 규칙과 unit test
- `_xecms_documents`, `_xecms_document_revisions` PostgreSQL 저장 구조
- Document aggregate optimistic concurrency
- Relation이 stable Document ID만 참조하도록 강제하는 canonical reference
- Schema IR의 Singleton, Component, Hierarchy 및 M2 field type 정의와 validation

M2에서는 이 기반을 정식 application contract와 사용자 흐름으로 승격하고, projection·무결성·Admin UI를 완성한다.

## 3. 구현 Slice

### M2-A — Document Lifecycle

상태: 완료 (2026-07-15)

상세 계약: [M2 Document Lifecycle 사양](./m2-document-lifecycle.md)

- Document 응답에 `draft`, `published`, `published-with-draft`, `archived`, `deleted` 상태 제공
- publish, unpublish, revision history, revision restore API
- soft delete된 문서 목록과 restore
- purge를 별도 capability와 명시적 command로 분리
- Admin 상태 badge, publish action, revision history와 trash
- published 조회가 draft 데이터를 노출하지 않는 contract test

완료 근거:

- Admin working projection과 Public published Revision join을 분리했다.
- Publish/Unpublish/History/Restore/Trash/Purge REST 및 typed client를 제공한다.
- lifecycle event는 상태 변경과 같은 transaction에 저장하며 콘텐츠 data는 audit payload에서 제거한다.
- PostgreSQL integration 11개와 Playwright 2개가 전체 생명주기, 기존 M1 DB upgrade, 충돌 복구 및 강한 purge 확인을 검증한다.

완료 조건:

- Published와 새 Draft가 동시에 존재하고 공개 조회는 기존 Published 데이터를 유지한다.
- Restore가 새 Revision을 만들며 Document ID와 기존 Revision history를 보존한다.
- 일반 목록에서 soft-deleted 문서가 제외되고 trash에서 복구할 수 있다.
- 모든 mutation이 expected version 충돌을 거부한다.

### M2-B — Schema Breadth

상태: 완료 (2026-07-15)

- Singleton cardinality
- Component 정의와 재사용
- textarea, date, select, enum, JSON
- object, array와 최소 Rich Text 저장 규격
- Schema Builder의 progressive disclosure
- Schema Manifest export/import
- deterministic TypeScript type generation

`relation`, `upload`은 각각 M2-C와 M2-E에서 storage 무결성과 함께 활성화한다.

완료 조건:

- 같은 Manifest를 빈 DB에 적용하면 같은 Schema hash와 storage 구조를 만든다.
- generated type 출력은 동일 Manifest에 대해 byte-for-byte 재현된다.
- Singleton에는 두 번째 Document를 생성할 수 없다.

### M2-C — Stable Relation

상태: 완료 (2026-07-15)

- one/many relation field
- target Collection 및 Document 존재 검사
- stable Document ID 저장
- `restrict`, `nullify`, `cascade` 삭제 정책
- relation selector와 Admin reference picker
- relation depth 및 payload 크기 제한

완료 조건:

- 대상 문서를 새 Revision으로 publish 또는 restore해도 relation이 유지된다.
- 다른 Collection 또는 존재하지 않는 Document 참조를 거부한다.
- 삭제 정책과 soft delete/restore의 동작이 PostgreSQL integration test로 고정된다.

### M2-D — Hierarchical Collection

상태: 완료 (2026-07-15)

- collection hierarchy 설정과 max depth
- forest, parent, sort key, depth 및 closure table
- root/children/ancestors/descendants/subtree 조회
- move/reorder 전용 command와 transaction
- cycle, cross-collection parent 및 max-depth 거부
- lazy Tree View, breadcrumb, keyboard move와 현재 위치에서 자식 생성
- 구조 변경 event와 최소 audit metadata

완료 조건:

- 이동과 closure 갱신이 하나의 transaction에서 성공하거나 함께 rollback된다.
- 자기 자신 및 후손 아래 이동, Collection 경계 이동, 최대 깊이 초과를 API와 UI 양쪽에서 거부한다.
- 여러 root와 같은 부모 아래의 명시적 순서를 재현한다.

### M2-E — Media and Upload

상태: 완료 (2026-07-15)

- Media metadata와 stable Media ID
- local filesystem storage adapter
- streaming upload, 크기와 MIME 제한
- upload field one/many
- orphan 및 missing file 정합성 검사
- Admin upload/선택/미리보기

완료 조건:

- DB metadata와 파일 저장의 부분 실패를 정리하거나 복구할 수 있다.
- storage root 탈출 경로와 허용되지 않은 MIME을 거부한다.
- 정합성 검사 명령이 missing/orphan 상태를 보고한다.

### M2-F — Product Closure

상태: 완료 (2026-07-15)

- Schema diff와 Migration Preview의 M2 object 표현 개선
- Blog example
- 전체 M2 브라우저 여정
- 설치 및 운영 문서
- M2 경계 검사와 release checklist

완료 조건은 상위 MVP 사양서의 M2 완료 조건과 동일하다.

검증 자산:

- [M2 Content Core 운영 및 검증](./m2-content-core.md)
- [M2 Blog example](../examples/blog/README.md)
- `tests/e2e/m2-content-core.spec.ts`
- `scripts/run-m2-e2e.mjs`

Blog canonical Manifest와 generated type fixture를 기준으로 B~E application/server/Admin 통합을 완료했다. 최종 Gate에서 실제 PostgreSQL 8개, Server integration 17개와 Chromium 전체 Blog 시나리오 1개가 통과했고 격리 컨테이너가 정상 정리됐다.

## 4. 저장 경계

```text
Document Identity
├── current_draft_revision_id
├── current_published_revision metadata
├── aggregate_version
├── lifecycle / deletion
└── structural position (M2에서는 versioning 제외)

Document Revision (append-only)
├── sequence
├── schema_revision_id
├── data JSON
├── parent_revision_id
└── origin / actor / timestamp

Physical Projection
├── Admin working revision 검색용 projection
├── Published read projection 또는 published pointer join
└── 삭제 상태 및 hierarchy index
```

- Revision row는 생성 후 수정하지 않는다.
- Document pointer 변경과 새 Revision insert, projection 갱신은 같은 transaction에서 수행한다.
- 공개 Published 조회가 working projection을 읽지 않도록 저장 경계를 명시한다.
- hierarchy closure 변경은 Document revision 생성과 독립적인 structure transaction이다.

## 5. 공통 검증 Gate

각 slice는 다음 검사를 통과해야 완료로 전환한다.

```bash
pnpm check
pnpm build:admin
pnpm test:e2e:m2
```

추가로 slice별 PostgreSQL integration test, API contract test와 데스크톱·모바일 Admin 시각 검수를 수행한다. M2 전체 완료 시 빈 PostgreSQL에서 Blog example을 생성하고 Schema, Media, Draft/Publish, Relation과 Page tree 흐름을 처음부터 재현한다.

## 6. 제외 범위 재확인

- versioned hierarchy
- locale별 독립 publish
- DAG
- object, array, component, blocks 내부에 중첩된 Relation/Upload Field
- 외부 object storage 공식 adapter
- 완전한 Page Builder
- 복잡한 승인 workflow

위 기능을 암시하는 UI나 불완전한 API를 M2 완료 기능으로 노출하지 않는다.
