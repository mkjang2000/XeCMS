# 인증

XeCMS는 세 가지 인증 방식을 제공합니다. 외부 애플리케이션은 대부분 **API Key**를
사용합니다.

| 방식 | 사용처 | 인증 수단 |
| --- | --- | --- |
| **API Key** | 외부 서버·백엔드 연동 | `Authorization: Bearer <key>` |
| **운영자 세션** | Admin Studio, 운영 자동화 | 쿠키 + `X-CSRF-Token` |
| **회원 세션** | 서비스 회원 로그인 (사용자 공간) | 쿠키 + `X-CSRF-Token` |

> API Key 인증은 쿠키·CSRF 토큰과 **함께 쓸 수 없습니다**. 하나의 요청은 한 가지
> 방식만 사용해야 합니다.

## API Key (외부 연동 권장)

### 발급

API Key는 **서비스 계정(service account)** 에 발급합니다. Admin Studio의
`사용자 → 서비스 계정`에서 계정을 만들고 API Key를 생성하세요. 생성된 key 문자열은
**생성 직후 한 번만** 표시되므로 안전하게 보관해야 합니다.

API Key의 실제 허용 권한은 **서비스 계정의 역할 권한**과 **key에 지정된 scope**의
교집합입니다.

### 사용

모든 요청에 `Authorization` 헤더로 key를 전달합니다.

```bash
curl http://127.0.0.1:3100/api/collections/col_posts/documents \
  -H "Authorization: Bearer xecms_sk_..."
```

```ts
const res = await fetch("http://127.0.0.1:3100/api/collections/col_posts/documents", {
  headers: { Authorization: `Bearer ${process.env.XECMS_API_KEY}` },
});
```

API Key 요청은 CSRF 토큰이 필요 없습니다(쿠키 기반이 아니므로). 워크스페이스 설정
변경 등 일부 관리 작업은 API Key로 수행할 수 없습니다.

## 운영자 세션

Admin Studio 사용자와 동일한 로그인입니다. 자동화 스크립트에서 운영 API를 호출할 때
사용할 수 있습니다.

### 로그인

```bash
curl -c cookies.txt -X POST http://127.0.0.1:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "owner", "password": "..." }'
```

응답에는 세션 정보와 **CSRF 토큰**이 포함되고, 세션 쿠키(`xecms_session`)가 설정됩니다.

```json
{
  "authenticated": true,
  "csrfToken": "…",
  "expiresAt": "2026-07-20T00:00:00.000Z"
}
```

### 요청

- **읽기(GET)** 요청은 세션 쿠키만 있으면 됩니다.
- **쓰기(POST/PATCH/DELETE)** 요청은 `X-CSRF-Token` 헤더에 로그인 시 받은 토큰을 함께
  보내야 하며, 요청 Origin이 `XECMS_ADMIN_ORIGINS`에 있어야 합니다.

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3100/api/collections/col_posts/documents \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <로그인에서 받은 토큰>" \
  -d '{ "data": { "title": "안녕하세요" } }'
```

### 세션 확인·로그아웃

```bash
curl -b cookies.txt http://127.0.0.1:3100/api/auth/session
curl -b cookies.txt -X POST http://127.0.0.1:3100/api/auth/logout \
  -H "X-CSRF-Token: <토큰>"
```

## 회원 인증 (사용자 공간)

서비스의 **회원**이 가입·로그인하는 흐름입니다. 각 사용자 공간은 고유한 `realmKey`로
식별됩니다. 회원 세션은 운영자 세션과 **완전히 분리된** 자체 CSRF 토큰을 가집니다.

### 가입

```bash
curl -c member.txt -X POST http://127.0.0.1:3100/api/content-realms/community/signup \
  -H "Content-Type: application/json" \
  -d '{
        "identifier": "member@example.com",
        "password": "member-password-2026",
        "profile": { "displayName": "홍길동" }
      }'
```

### 로그인

```bash
curl -c member.txt -X POST http://127.0.0.1:3100/api/content-realms/community/login \
  -H "Content-Type: application/json" \
  -d '{ "identifier": "member@example.com", "password": "member-password-2026" }'
```

응답은 회원 세션 정보와 `csrfToken`을 포함합니다.

```json
{
  "authenticated": true,
  "realmKey": "community",
  "membershipId": "…",
  "csrfToken": "…",
  "expiresAt": "…"
}
```

### 세션·프로필·로그아웃

```bash
# 현재 회원 세션 확인 (비로그인 시 authenticated=false)
curl -b member.txt http://127.0.0.1:3100/api/content-realms/community/session

# 프로필 조회·수정 (수정은 X-CSRF-Token 필요)
curl -b member.txt http://127.0.0.1:3100/api/content-realms/community/profile

# 로그아웃
curl -b member.txt -X POST http://127.0.0.1:3100/api/content-realms/community/logout \
  -H "X-CSRF-Token: <회원 토큰>"
```

TypeScript SDK를 쓰면 이 흐름을 `client.contentRealm(realmKey)`로 간결하게 처리할 수
있습니다 ([TypeScript SDK](./typescript-sdk.md) 참고).

## 오류

인증·인가 실패는 [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807) 형식으로
반환됩니다.

| status | code (예) | 의미 |
| --- | --- | --- |
| 401 | `API_KEY_INVALID` | API Key가 유효하지 않거나 비활성 |
| 401 | `SESSION_INVALID` | 세션이 만료되었거나 유효하지 않음 |
| 403 | `API_KEY_SCOPE_DENIED` | key scope에 해당 작업이 없음 |
| 403 | `CSRF_TOKEN_REQUIRED` | 쓰기 요청에 `X-CSRF-Token`이 없음 |
| 403 | `AUTHORIZATION_DENIED` | 역할·범위 권한이 부족함 |

```json
{
  "type": "urn:xecms:error:api_key_scope_denied",
  "title": "Forbidden",
  "status": 403,
  "detail": "The API key scope does not include 'content.create'.",
  "code": "API_KEY_SCOPE_DENIED",
  "requestId": "…"
}
```
