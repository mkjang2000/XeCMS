# TypeScript SDK

`@xecms/client`는 REST API를 감싸는 타입 안전 클라이언트입니다. 응답·요청 타입은
`@xecms/contracts`에서 재노출되므로 별도 설치 없이 사용할 수 있습니다.

> 이 SDK는 [REST API](./rest-api.md) 위에서 동작합니다. 내부적으로 세션 인증 시
> CSRF 토큰을 자동으로 관리합니다.

## 설치

```bash
pnpm add @xecms/client
```

## 클라이언트 생성

```ts
import { createXeCmsClient } from "@xecms/client";

const client = createXeCmsClient({
  baseUrl: "http://127.0.0.1:3100/api", // 기본값: "/api"
});
```

`XeCmsClientOptions`:

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `baseUrl` | `"/api"` | API 기본 URL |
| `fetch` | 전역 `fetch` | 커스텀 fetch 구현 (인증 헤더 주입 등) |

## 인증

### API Key (서버 사이드 권장)

커스텀 `fetch`로 `Authorization` 헤더를 주입합니다.

```ts
const client = createXeCmsClient({
  baseUrl: "http://127.0.0.1:3100/api",
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${process.env.XECMS_API_KEY}`,
      },
    }),
});
```

### 세션 (브라우저)

브라우저에서는 쿠키 기반 세션을 사용합니다. 로그인 후 CSRF 토큰은 SDK가 자동으로
저장·전송합니다.

```ts
await client.auth.login({ username: "owner", password: "..." });
// 이후 쓰기 요청의 CSRF 토큰은 자동 처리됩니다.
```

## 콘텐츠 다루기

### 게시된 콘텐츠 조회 (인증 불필요)

```ts
const posts = await client.content.list("col_posts");
const post = await client.content.get("col_posts", "doc_123");
```

### CRUD (인증 필요)

```ts
// 목록·쿼리
const list = await client.documents.list("col_posts");
const result = await client.documents.query("col_posts", {
  state: "all",
  filter: { field: { name: "status" }, op: "eq", value: "draft" },
  sort: [{ field: { name: "createdAt" }, direction: "desc" }],
});

// 생성·수정
const created = await client.documents.create("col_posts", {
  data: { title: "안녕하세요", slug: "hello" },
});
const updated = await client.documents.update("col_posts", created.id, {
  data: { title: "수정됨" },
});

// 게시 수명주기
await client.documents.publish("col_posts", created.id, {});
await client.documents.unpublish("col_posts", created.id, {});

// 삭제·복원·영구삭제
await client.documents.delete("col_posts", created.id, {});
await client.documents.restore("col_posts", created.id, {});
await client.documents.purge("col_posts", created.id, {});
```

### 계층 구조 (hierarchy 컬렉션)

```ts
const tree = await client.documents.tree("col_pages");
await client.documents.move("col_pages", "doc_child", {
  parentId: "doc_parent",
  position: 0,
  expectedVersion: 3,
});
```

### Revision

```ts
const revisions = await client.revisions.list("col_posts", "doc_123");
await client.revisions.restore("col_posts", "doc_123", "rev_abc", {});
```

## 회원 인증 (사용자 공간)

`client.contentRealms.forRealm(realmKey)`로 회원 가입·로그인·콘텐츠 접근을 처리합니다.
회원 세션의 CSRF 토큰은 `realmKey`별로 자동 관리됩니다.

```ts
const community = client.contentRealms.forRealm("community");

await community.signup({
  identifier: "member@example.com",
  password: "member-password-2026",
  profile: { displayName: "홍길동" },
});

await community.login({
  identifier: "member@example.com",
  password: "member-password-2026",
});

const session = await community.getSession();
const profile = await community.getProfile();

// 회원 세션으로 콘텐츠 접근
const docs = await community.listDocuments("col_articles");
const doc = await community.createDocument("col_articles", {
  data: { title: "회원 글" },
});
```

## 오류 처리

SDK는 실패 응답을 `XeCmsApiError`로 던집니다. RFC 7807 필드를 그대로 담습니다.

```ts
import { XeCmsApiError } from "@xecms/client";

try {
  await client.documents.create("col_posts", { data: {} });
} catch (err) {
  if (err instanceof XeCmsApiError) {
    console.error(err.status, err.code, err.detail);
  }
}
```

## 타입 활용

콘텐츠 `data`의 형태는 [Schema에서 생성한 타입](./schema.md)으로 좁힐 수 있습니다.
`xecms generate types`로 생성한 정의를 import해 사용하세요.
