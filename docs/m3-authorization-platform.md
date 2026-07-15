# M3 Authorization Platform 구현 및 검증

> 상태: 완료 (2026-07-15)  
> 상위 문서: [XeCMS MVP 사양서](./mvp-specification.md)  
> 범위: System Realm 권한 커널, PostgreSQL 저장소, 콘텐츠 Resource 연동, Admin UI, 자동 검증

## 1. 구현 결과

M3에서는 M0의 권한 모델을 실제 CMS 실행 경로에 연결했다. 세션의 고정 capability 배열은 운영 권한의 최종 근거가 아니다. System Subject의 Role Binding을 policy revision에 맞는 동일 authorization kernel로 판정한다.

```text
CMS session / Public request
→ Actor authorization gateway
→ Authorization application service
→ revision-keyed immutable policy snapshot
→ authorization kernel
→ allowed/denied + reason + grant provenance
```

Schema, Admin Content, 공개 Content 및 권한 관리 API가 이 경로를 사용한다. 공개 API도 우회 경로가 아니라 보호된 `Public` Service Account Subject의 명시적 Role Binding으로 판정한다.

## 2. 권한 모델

### 2.1 Subject와 Group

- User, Group, Service Account를 동일한 Subject 모델로 저장한다.
- Group 안에 User 또는 다른 Group을 포함할 수 있다.
- Group closure를 PostgreSQL에 유지한다.
- 순환 Group은 kernel과 DB transaction 양쪽에서 거부한다.
- Group 상속 판정은 `membershipPath`를 결과에 남긴다.
- 비활성 Subject와 다른 Realm의 Subject는 fail-closed 처리한다.

Admin UI에서 생성한 User Subject는 M3의 권한 주체이며 로그인 credential은 아니다. 일반 CMS 운영 계정과 Content Realm 로그인 연결은 M4 범위다.

### 2.2 Authority Level과 동일 레벨 Role

기본 정책은 다음 수직 Level과 수평 Role을 만든다.

| Rank | Level | 기본 Role |
|---:|---|---|
| 100 | Owner | Owner |
| 80 | Administrators | Content Administrator, Security Administrator |
| 40 | Editors | Editor |
| 10 | Viewers | Viewer |
| 0 | Public | Public |

같은 Level의 Role은 기능 Permission이 달라도 관리 서열이 같다. 관리 대상의 유효 Rank보다 엄격히 높은 하나의 Grant가 rank, scope와 delegation을 모두 만족해야 한다. 따라서 같은 레벨의 Content Administrator와 Security Administrator는 서로의 Role이나 Binding을 수정할 수 없다.

### 2.3 Resource Scope와 콘텐츠 계층

- Resource는 Realm root에 연결된 tree다.
- `self`, `children`, `self-and-children` propagation을 지원한다.
- Schema 적용 시 Collection Resource를 동기화한다.
- `hierarchy.permissionInheritance=true`인 문서는 실제 콘텐츠 parent와 동일한 Document Resource graph로 투영한다.
- Document 읽기·쓰기·필드 필터링·시뮬레이터가 같은 Document Resource를 사용한다.
- Resource/Group closure는 정책 transaction 안에서 검증하고 재구축한다.

문서 Resource 이름은 draft 제목이나 slug를 복사하지 않고 opaque Document ID만 사용한다. `authorization.read`만 가진 별도 목적의 관리자가 미공개 콘텐츠 metadata를 보지 못하게 하기 위한 경계다.

삭제되거나 Schema에서 사라졌지만 Binding 또는 FieldAccess가 참조하는 Resource는 정책을 자동 삭제하지 않는다. `retired-document` 또는 `retired-collection` tombstone으로 보존하며 신규 정책 참조와 참조가 남은 ID의 재활성화를 거부한다.

### 2.4 조건과 필드 접근

Role Binding은 다음 조건을 지원한다.

- `validFrom`, `validUntil`
- `ownerSubjectId`
- `statuses`

필요한 object context가 없으면 조건부 Binding은 적용되지 않는다. 시뮬레이터와 콘텐츠 이동 impact도 실제 문서의 owner/status context로 같은 규칙을 평가한다.

필드 접근은 작업 Permission을 실제로 부여한 Role만 평가한다. 제한 없는 Grant가 하나라도 있으면 가산형 RBAC 원칙에 따라 전체 필드를 허용하고, 제한된 Role만 있다면 allowlist를 합산한다.

- 읽을 수 없는 필드는 응답 `data`에서 제거한다.
- 쓸 수 없는 필드를 포함한 요청은 `FIELD_WRITE_FORBIDDEN`으로 거부한다.
- Document `PATCH`는 partial merge다. 생략된 비가시 필드는 유지되며 명시적으로 전달한 필드만 쓰기 권한을 검사한다.
- Document 응답이 필요한 mutation은 읽기 권한과 필드 필터를 DB commit 전에 검증한다. 성공한 write 뒤에 403을 반환하지 않는다.

## 3. 콘텐츠 이동과 권한 영향

이동은 구조와 정책의 두 optimistic token을 사용한다.

```text
preview(tree version)
→ source read/update 확인
→ affected subtree read/update 확인
→ destination update 확인
→ before/after Scope·필드·조건 impact 계산
→ policy revision 반환
→ confirm(tree version + policy revision)
→ durable fence
→ hierarchy commit
→ Resource parent/closure reconcile
→ policy revision 증가 및 fence 해제
```

Preview는 다음 정보를 반환한다.

- 이전/새 parent와 document/resource path
- 영향을 받는 subtree Document/Resource ID
- Subject별 Permission 획득·상실
- 필드 읽기·쓰기 allowlist 확대·축소
- 조건부 Binding에 사용한 owner/status context
- 보호된 관리 권한 필요 여부와 계산 truncation 여부

부모 변경으로 Binding 또는 FieldAccess의 적용·관리 Scope가 바뀌면 M3에서는 보호된 Owner `authorization.manage`를 요구한다. 이는 콘텐츠 이동으로 동일 레벨 Role 관리 규칙을 우회하지 못하게 하는 보수적인 MVP 정책이다. 동일 parent 안의 순서 변경처럼 정책 Scope가 바뀌지 않는 작업은 일반 콘텐츠 권한으로 수행할 수 있다.

비인가 후손과 path는 preview/query 응답에서 노출하지 않는다. Tree 조회는 읽을 수 없는 node와 ancestor prefix를 제거하고, 이동 preview는 affected subtree 및 before/after path 전체에 읽기 권한을 요구한다.

## 4. 저장과 다중 서버 일관성

권한 graph의 source of truth는 JSON snapshot이 아닌 정규화된 PostgreSQL table이다.

- Subject 및 Group edge/closure
- Resource 및 Resource closure
- Authority Level
- Permission Catalog
- Role, Role Permission, Delegation, Field Access
- Role Binding과 Constraint
- Policy state/revision
- immutable Audit Log
- durable content projection quarantine

Authorization graph는 migration `0004`~`0007`에서 확립되고, migration `0012`가 durable projection fence table을 추가한다.

정책 mutation은 다음 작업을 하나의 DB transaction에서 수행한다.

```text
expected revision 비교
→ graph mutation
→ closure 검증 및 재구축
→ policy revision 증가
→ actor/target/before/after/decision Audit 기록
→ commit
```

콘텐츠 topology와 authorization projection은 여러 서버 인스턴스에서도 같은 PostgreSQL session advisory lock으로 직렬화한다. 권한 정책 mutation도 같은 선형 이력에 참여한다. 잠금은 일반 query pool과 분리된 전용 connection pool 및 process-local FIFO를 사용하며, 권한 mutation은 인증·Origin·CSRF 검증을 통과한 뒤에만 대기열에 들어간다.

Move와 purge는 DB commit 직전에 affected Resource를 durable quarantine으로 막는다. projection이 성공할 때만 fence를 해제한다. 프로세스가 중간에 종료되거나 reconcile이 실패하면 다른 인스턴스도 해당 Resource를 `503 AUTHORIZATION_PROJECTION_UNAVAILABLE`로 fail-closed 처리하며, startup reconcile이 현재 tree를 기준으로 복구한다.

권한 상속 모드를 기존 문서에 즉시 전환하거나, 정책 참조가 남은 Collection을 제거·재사용하는 작업은 `409 HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED`로 Schema commit 전에 거부한다. 향후 명시적인 policy migration workflow에서 영향 확인과 변환을 제공한다.

## 5. HTTP API

권한 Admin API는 다음과 같다.

| Method | Route | 용도 |
|---|---|---|
| GET | `/api/authorization/policy` | 현재 정책과 revision 조회 |
| POST | `/api/authorization/subjects` | Subject 생성 |
| POST/DELETE | `/api/authorization/group-memberships` | Group edge 관리 |
| POST/PUT/PATCH/DELETE | `/api/authorization/levels/:id?` | Level 관리 |
| POST/PUT/PATCH/DELETE | `/api/authorization/roles/:id?` | Role과 Permission Matrix 관리 |
| POST/PUT/PATCH/DELETE | `/api/authorization/bindings/:id?` | Scope Binding 관리 |
| POST | `/api/authorization/simulate` | 실제 kernel 판정 및 설명 |
| GET | `/api/authorization/audit` | 정책 변경 Audit 조회 |

콘텐츠 tree 연동 API는 다음과 같다.

| Method | Route | 용도 |
|---|---|---|
| GET | `/api/collections/:collectionId/tree` | 권한 필터가 적용된 tree 조회 |
| GET | `/api/collections/:collectionId/documents/:id/{ancestors,descendants,subtree}` | 권한 필터가 적용된 부분 tree 조회 |
| POST | `/api/collections/:collectionId/documents/:id/move/preview` | 구조·권한 영향 no-write 계산 |
| POST | `/api/collections/:collectionId/documents/:id/move` | tree/policy CAS를 사용한 이동 확정 |

정책 mutation은 CSRF와 `expectedPolicyRevision` CAS를 요구한다. 실제 move도 preview가 반환한 `expectedPolicyRevision`을 필수로 요구한다.

## 6. Admin UI

사이드바의 `권한` 메뉴에서 다음 화면을 사용할 수 있다.

- `/admin/access/roles`: Level 카드, 동일 레벨 Role, Permission/Delegation Matrix, 필드 접근
- `/admin/access/bindings`: Subject, 중첩 Group, Scope/기간/owner/status Binding
- `/admin/access/simulator`: 한 Permission 판정 및 전체 Effective Permission 조회
- `/admin/access/audit`: revision별 actor, target, before/after, authorization decision

Resource 입력은 Workspace → 영역 → Collection → Document 계층을 keyboard로 탐색할 수 있는 공통 Scope Tree다. 선택한 Resource의 breadcrumb, type과 propagation 설명을 함께 보여준다.

Content Tree에서 이동을 누르면 실제 mutation 전에 modal을 열어 이전/새 path, affected subtree, Permission 변화, 필드 접근 변화, Owner 승인 필요 여부, tree/policy revision을 확인한다. 취소는 mutation을 만들지 않으며 확인 시 preview revision을 CAS token으로 다시 보낸다.

## 7. 동기 처리 상한

M3의 동기 API는 작업량을 무제한 허용하지 않는다.

- 한 move의 authorization impact 대상: 최대 500 Resource
- 한 preview의 effective evaluation: 최대 20,000회
- 한 preview가 반환하는 Permission/필드 변화: 최대 500건, 초과 시 truncation 경고
- 한 동기 tree 응답: 최대 1,000 node

큰 subtree 이동, paginated tree와 증분 projection은 후속 확장 범위다. 상한을 넘는 요청은 부분 적용하지 않고 명시적인 413 오류로 거부한다.

## 8. 검증 결과

2026-07-15 기준 누적 Gate는 다음과 같다.

| 계층 | 결과 | 주요 검증 |
|---|---:|---|
| TypeScript / Boundary / Docs | 통과 | project reference, domain 경계, 문서 link |
| Unit | 269 passed, 26 skipped | kernel, cache, hierarchy guard, partial PATCH, Admin UI |
| PostgreSQL store | 11 passed | CAS, closure, cycle, FK 방어, fence와 lock |
| Server PostgreSQL integration | 19 passed | M1~M3 HTTP 회귀와 실제 권한 projection |
| Chromium E2E | 2 passed | M2 Blog lifecycle + M3 권한/Scope/이동 Admin 여정 |
| Admin production build | 통과 | Vite production bundle |

M3 PostgreSQL acceptance는 다음 보안 경로를 실제 DB와 HTTP로 검증한다.

- Document Scope read/update와 필드 필터, partial PATCH의 hidden field 보존
- simulator와 실제 API의 허용·거부 이유 일치
- 같은 레벨 Role 관리 거부와 subtree 이동 escalation 차단
- preview no-write, tree/policy stale CAS, 실제 move 후 closure·revision 변화
- Permission 및 field allowlist 이동 impact와 owner/status context
- write-only mutation의 pre-commit 거부와 orphan 부재
- 비인가 traversal/path/descendant ID 비노출
- missing projection fail-closed와 startup recovery
- 두 서버 인스턴스의 durable quarantine 공유
- inheritance mode 변경과 retired Collection 재사용의 pre-commit 거부
- main DB pool 1개 및 동시 미인증 요청에서도 projection lock 교착 부재

전체 isolated Gate는 다음 명령으로 재현한다.

```bash
pnpm check
pnpm test:e2e:m3
```

`test:e2e:m3`는 별도 PostgreSQL container/schema와 media directory를 만들고, TypeScript/Admin build, PostgreSQL store, server integration 및 Chromium M2+M3 여정을 실행한 뒤 임시 자원을 제거한다.

## 9. 후속 milestone 경계

M3에서 의도적으로 제외한 항목은 다음과 같다.

- M4 일반 CMS 운영 계정과 Subject 자동 연결
- M4 Content Realm 및 System Identity의 별도 Content Binding
- 세밀한 rank/delegation 기반 Resource parent-change 승인 정책
- 기존 문서를 유지한 permission inheritance 전환 migration workflow
- 비동기 대규모 subtree impact/move와 paginated tree
- explicit Deny, Role inheritance, 임의 policy language 및 JavaScript Constraint

위 항목은 현재 경로를 우회해 암묵적으로 허용하지 않는다. 필요한 작업은 Owner-only 또는 fail-closed 오류로 제한하고 후속 milestone에서 명시적인 계약으로 확장한다.
