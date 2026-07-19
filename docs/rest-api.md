# REST API 레퍼런스

외부 애플리케이션이 사용하는 공개 엔드포인트입니다. 모든 경로는 `/api` 접두사를 가지며
기본 포트는 `3100`입니다. 인증은 [인증](./authentication.md)을 참고하세요.

> Admin Studio 전용 관리 API(권한 정책 편집, 사용자 공간 관리, Plugin·Admin App 관리,
> 감사·운영 엔드포인트)는 공개 계약이 아니므로 여기에 포함하지 않습니다.

## 공통 규약

- 요청·응답 본문은 JSON입니다.
- 쓰기 요청은 세션 인증 시 `X-CSRF-Token` 헤더가 필요합니다(API Key 인증은 불필요).
- 오류는 [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807) 형식입니다.
- 목록 응답은 커서 기반 페이지네이션(`nextCursor`)을 사용합니다.

## 헬스 체크

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/live` | 없음 | Liveness. 프로세스 생존 여부 |
| GET | `/api/ready` | 없음 | Readiness. DB·의존성 준비 여부 |
| GET | `/api/health` | 없음 | 상세 헬스 정보 |

```bash
curl http://127.0.0.1:3100/api/ready
```

## 공개 콘텐츠 조회 (게시된 콘텐츠)

**인증 없이** 게시(published)된 콘텐츠만 반환합니다. 웹사이트·앱의 공개 페이지에
적합합니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/content/:collectionId/documents` | 게시된 Document 목록 (`?page=&pageSize=`) |
| GET | `/api/content/:collectionId/documents/:documentId` | 게시된 Document 단건 |

```bash
curl "http://127.0.0.1:3100/api/content/col_posts/documents?page=1&pageSize=20"
```

## 인증된 콘텐츠 CRUD

Draft를 포함한 전체 수명주기를 다룹니다. **API Key 또는 세션 인증**이 필요하며, 대상
Collection·Document에 대한 권한을 요구합니다.

### 조회

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/collections` | 접근 가능한 Collection 목록 |
| GET | `/api/collections/:collectionId/documents` | Document 목록 (draft 포함) |
| POST | `/api/collections/:collectionId/documents/query` | 필터·정렬·필드 선택 조회 |
| GET | `/api/collections/:collectionId/documents/:documentId` | Document 단건 |

`query` 요청 본문:

```json
{
  "state": "all",
  "limit": 20,
  "cursor": null,
  "fields": ["title", "slug"],
  "filter": { "field": { "name": "status" }, "op": "eq", "value": "draft" },
  "sort": [{ "field": { "name": "createdAt" }, "direction": "desc" }]
}
```

### 생성·수정·삭제

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/api/collections/:collectionId/documents` | Document 생성 |
| PATCH | `/api/collections/:collectionId/documents/:documentId` | Document 수정 (새 revision) |
| DELETE | `/api/collections/:collectionId/documents/:documentId` | soft delete |
| POST | `/api/collections/:collectionId/documents/:documentId/restore` | 복원 |
| DELETE | `/api/collections/:collectionId/documents/:documentId/purge` | 영구 삭제 |

생성 요청 본문:

```json
{
  "data": { "title": "안녕하세요", "slug": "hello" },
  "hierarchy": { "parentId": null, "position": 0, "expectedVersion": 0 }
}
```

`data`는 Collection의 [Schema](./schema.md)를 따르며, `hierarchy`는 hierarchy
컬렉션에서만 사용합니다.

### 게시 수명주기

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/api/collections/:collectionId/documents/:documentId/publish` | 게시 |
| POST | `/api/collections/:collectionId/documents/:documentId/unpublish` | 게시 취소 |

### Revision

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `…/:documentId/revisions` | revision 목록 |
| GET | `…/:documentId/revisions/:revisionId` | revision 단건 |
| POST | `…/:documentId/revisions/:revisionId/restore` | 해당 revision으로 복원 |

### 계층 구조 (hierarchy 컬렉션)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `…/:documentId/ancestors` | 조상 목록 |
| GET | `…/:documentId/descendants` | 자손 목록 |
| GET | `…/:documentId/subtree` | 하위 트리 |
| POST | `…/:documentId/move/preview` | 이동 사전 검증 |
| POST | `…/:documentId/move` | 이동 실행 |

## 회원 세션 콘텐츠 (사용자 공간)

로그인한 **회원**이 자신이 속한 사용자 공간의 콘텐츠에 접근합니다. 회원 세션 인증이
필요하며, 그 공간의 권한 범위 안에서만 허용됩니다. 회원 로그인은
[인증](./authentication.md)을 참고하세요.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/content-realms/:realmKey/collections` | 접근 가능한 Collection 목록 |
| GET | `/api/content-realms/:realmKey/collections/:collectionId/documents` | Document 목록 |
| POST | `/api/content-realms/:realmKey/collections/:collectionId/documents/query` | 필터 조회 |
| GET | `/api/content-realms/:realmKey/collections/:collectionId/documents/:documentId` | 단건 |
| POST | `/api/content-realms/:realmKey/collections/:collectionId/documents` | 생성 |
| PATCH | `/api/content-realms/:realmKey/collections/:collectionId/documents/:documentId` | 수정 |

## Schema 조회

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/schema` | 활성 Schema |
| GET | `/api/schema/manifest` | Schema manifest (해시 포함) |
| GET | `/api/schema/types` | 생성된 TypeScript 타입 정의 |

## Site·Media 조회

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/sites` | Site 목록 |
| GET | `/api/sites/:siteId` | Site 단건 |
| GET | `/api/media` | Media 목록 |
| POST | `/api/media` | Media 업로드 (multipart) |

## 접근 판정

권한을 실제로 요청하기 전에 미리 확인할 수 있습니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/api/access/evaluate-batch` | 여러 (action, resource) 판정을 한 번에 |

```json
{
  "checks": [
    { "action": "content.update", "resourceId": "col_posts" },
    { "action": "content.delete", "resourceId": "doc_123" }
  ]
}
```

응답에는 각 판정의 허용 여부와 이유(reasonCode)가 포함됩니다.

## 인증 엔드포인트

세션 로그인/로그아웃과 회원 인증은 [인증](./authentication.md)에서 상세히 다룹니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/bootstrap/status` | 최초 Owner 부트스트랩 필요 여부 |
| POST | `/api/bootstrap` | 최초 Owner 생성 |
| POST | `/api/auth/login` | 운영자 로그인 |
| POST | `/api/auth/logout` | 운영자 로그아웃 |
| GET | `/api/auth/session` | 현재 운영자 세션 |
| POST | `/api/content-realms/:realmKey/signup` | 회원 가입 |
| POST | `/api/content-realms/:realmKey/login` | 회원 로그인 |
| GET | `/api/content-realms/:realmKey/session` | 회원 세션 |
| POST | `/api/content-realms/:realmKey/logout` | 회원 로그아웃 |
| GET/PATCH | `/api/content-realms/:realmKey/profile` | 회원 프로필 조회·수정 |
