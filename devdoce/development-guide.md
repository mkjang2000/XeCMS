# XeCMS 개발 가이드

## 1. 요구 사항

- Node.js 22.13 이상
- pnpm 10.30 이상
- Docker Engine과 Docker Compose v2
- Chromium E2E 실행 시 Playwright browser

```bash
corepack enable
pnpm install
pnpm exec playwright install chromium
```

## 2. 로컬 실행

환경 파일과 PostgreSQL을 준비한다.

```bash
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev:m1
```

`dev:m1`은 역사적인 script 이름이며 현재는 M0~M4 전체 기능의 Server와
Admin Studio를 실행한다. 개발 실행기는 workspace source를 직접 참조하므로
사전 build가 필요하지 않다.

| 대상 | 기본 주소 |
| --- | --- |
| Admin Studio | `http://127.0.0.1:5173/admin` |
| REST API | `http://127.0.0.1:3100/api` |
| Liveness | `http://127.0.0.1:3100/api/live` |
| Readiness | `http://127.0.0.1:3100/api/ready` |
| PostgreSQL | `127.0.0.1:54320` |

빈 DB에서는 `/admin/setup`으로 이동한다. 실행 환경과 관계없이 Owner 계정은
자동 생성되지 않으며, 최초 사용자가 12자 이상의 비밀번호로 직접 생성한다.

## 3. 주요 환경 변수

| 변수 | 목적 |
| --- | --- |
| `NODE_ENV` | `development`, `test`, `production` 실행 환경 |
| `DATABASE_URL` | XeCMS PostgreSQL 연결 문자열 |
| `XECMS_HOST`, `XECMS_PORT` | API bind 주소와 port |
| `XECMS_ADMIN_ORIGINS` | Admin session을 허용할 origin 목록 |
| `XECMS_CONTENT_ORIGINS` | Content Realm session을 허용할 origin 목록 |
| `XECMS_SESSION_SECRET` | session token 보호 secret |
| `XECMS_MEDIA_STORAGE_ROOT` | local media byte 저장 경로 |
| `XECMS_WORKER_*` | durable event Worker 설정 |
| `XECMS_E2E_*` | 격리된 PostgreSQL과 E2E server 설정 |

공유 환경이나 production에서는 loopback bind, 개발 DB credential과
`.env.example`의 session secret을 그대로 사용하면 안 된다.

## 4. 저장소 경계

```text
apps/admin        React Admin Studio
apps/server       Fastify HTTP server와 runtime 조립

packages/core           순수 domain model
packages/schema         Schema IR, decode, validation, diff
packages/authorization  순수 authorization kernel
packages/application    use case와 transaction boundary
packages/database       PostgreSQL store와 migration
packages/contracts      REST DTO
packages/client         TypeScript HTTP client
packages/admin          Admin API adapter와 공용 field registry
packages/ui             공용 React UI primitives
packages/plugin-sdk     trusted Plugin contract
packages/cli            CLI, doctor, scaffold, backup/restore
```

의존 방향은 UI/HTTP에서 Application으로, Application에서 Domain과 Store
interface로 향한다. Admin이나 Plugin이 PostgreSQL table을 직접 조작해서는 안 된다.

## 5. 일반 검증

```bash
pnpm check
```

`check`는 다음을 실행한다.

- package boundary 검사
- 문서 링크 검사
- TypeScript typecheck
- 환경 독립 Vitest

PostgreSQL 조건부 suite 전체는 별도로 실행한다.

```bash
pnpm test:postgres:all
```

대규모 hierarchy, unified audit와 Plugin export 측정은 다음 명령을 사용한다.

```bash
pnpm test:p2:benchmarks
```

## 6. E2E와 Release Gate

개별 누적 journey:

```bash
pnpm test:e2e
pnpm test:e2e:m2
pnpm test:e2e:m3
pnpm test:e2e:m4a
pnpm test:e2e:m4b
pnpm test:e2e:m4c4
pnpm test:e2e:m4c5
```

현재 전체 release gate:

```bash
pnpm verify:m4c5
```

이 Gate는 production Admin bundle, 전체 PostgreSQL 조건부 suite, CLI package,
upgrade/backup/restore 경계와 M1~M4-C5 Chromium journey를 검증한다.

E2E는 개발 DB와 다른 PostgreSQL service/schema 및 임시 media root를 사용한다.
개발 DB를 초기화할 목적으로 E2E 정리 명령을 사용하지 않는다.

## 7. DB와 개발 환경 정리

PostgreSQL process만 중지:

```bash
pnpm db:down
```

개발 데이터를 포함한 volume 전체 제거:

```bash
docker compose down --volumes
```

두 번째 명령은 복구할 수 없으므로 로컬 데이터를 정말 삭제해도 되는 경우에만 사용한다.

## 8. 자주 발생하는 문제

### Admin에서 502가 발생하는 경우

Vite가 아니라 proxy 대상 API가 종료된 경우가 대부분이다.

```bash
curl --fail http://127.0.0.1:3100/api/live
```

`XECMS_SERVER_URL`, API port와 Vite proxy target을 함께 확인한다.

### Origin이 거부되는 경우

브라우저에서 실제로 사용한 scheme, host와 port를 `XECMS_ADMIN_ORIGINS` 또는
`XECMS_CONTENT_ORIGINS`에 정확히 추가한다. `127.0.0.1`과 `localhost`는 다른 origin이다.

### Setup 화면이 나오지 않는 경우

대상 DB에 Owner Identity가 이미 존재한다. 환경 변수만 변경해서 Setup을 다시 열 수 없다.
DB volume을 삭제하기 전에 필요한 데이터가 없는지 확인한다.

### E2E port가 충돌하는 경우

개발 server와 다른 port를 사용하도록 `XECMS_SERVER_URL`과
`XECMS_E2E_ADMIN_URL`을 함께 변경한다.

## 9. 변경 작업 체크리스트

1. 관련 사양과 DTO를 먼저 확인한다.
2. Domain/Application 경계를 우회하지 않는다.
3. migration은 idempotent하고 forward-only로 작성한다.
4. 상태 변경 API에는 CSRF, 재인증과 optimistic concurrency 요구를 검토한다.
5. 권한 변경에는 Scope, hierarchy, delegation과 protected object 회귀 테스트를 추가한다.
6. UI 변경에는 loading/error/empty/keyboard 상태를 포함한다.
7. 관련 누적 E2E와 `pnpm check:docs`를 통과시킨다.
