# XeCMS M1 로컬 실행 및 검증

> 상태: 완료 (2026-07-15)  
> 기준일: 2026-07-15  
> 상위 문서: [XeCMS MVP 사양서](./mvp-specification.md)

이 문서는 M1 Vertical Slice를 로컬에서 실행하고 브라우저 및 REST API로
검증하는 단일 절차를 정의한다.

## 1. 필요한 도구

- Node.js 22.13 이상
- pnpm 10.30 이상
- Docker Engine과 Docker Compose v2

공식 개발 DB 이미지는 PostgreSQL 18 Alpine을 사용한다.

처음 한 번 의존성과 Playwright Chromium을 설치한다.

```bash
pnpm install
pnpm exec playwright install chromium
```

## 2. 개발 환경 시작

환경 파일을 만들고 PostgreSQL을 시작한다.

```bash
cp .env.example .env
pnpm db:up
```

서버와 Admin Studio를 함께 실행한다. 개발 모드는 workspace 소스를 직접
참조하므로 사전 빌드가 필요하지 않으며, 서버 시작 시 core migration을
idempotent하게 적용한다. 실행 중 `pnpm clean`이나 검증 Gate를 실행해도
개발 서버가 삭제되는 `dist` 산출물에 의존하지 않는다.

```bash
pnpm dev:m1
```

배포 파이프라인이나 점검 과정에서 migration만 명시적으로 실행하려면 다음
명령을 사용한다.

```bash
pnpm db:migrate
```

기본 주소는 다음과 같다.

| 대상 | 주소 |
|---|---|
| Admin Studio | `http://127.0.0.1:5173/admin/login` |
| Server API | `http://127.0.0.1:3100/api` |
| Health check | `http://127.0.0.1:3100/api/health` |
| PostgreSQL | `127.0.0.1:54320` |

개발 서버와 Admin Studio는 별도 프로세스로 실행되지만, Admin Studio의
`/api` 요청은 Vite 개발 프록시를 거쳐 XeCMS 서버로 전달된다.

## 3. 로컬 초기 계정

`.env.example`의 개발 기본 설정을 그대로 사용하면 다음 계정이 한 번만
생성된다.

```text
사용자 이름: admin
비밀번호: admin
```

이 계정은 개인 로컬 개발에서 UI를 바로 확인하기 위한 편의 기능이다.
`XECMS_DEV_SEED=true`는 `NODE_ENV=development`에서만 허용된다. 서버는 다른
환경에서 이 옵션이 설정되면 시작을 거부해야 한다.

> **보안 경고:** `admin/admin`을 인터넷에 노출된 서버, 공유 개발 서버,
> 스테이징 또는 운영 환경에서 사용하지 않는다. `.env`는 커밋하지 않고,
> 공유 환경에서는 `XECMS_DEV_SEED=false`로 설정한 뒤 `/admin/setup`에서
> 고유한 최초 Owner 계정을 만든다. 일반 bootstrap 비밀번호는 12자 이상이며
> 사용자 이름과 달라야 한다.

개발 seed는 이미 사용자가 있는 데이터베이스의 비밀번호를 다시
설정하거나 기존 계정을 덮어쓰지 않는다.

## 4. M1 브라우저 확인 흐름

Admin Studio에서 다음 흐름을 확인한다.

```text
admin/admin 로그인
→ Schema 메뉴
→ Posts Collection 생성
→ title, body, publishedAt 필드 추가
→ 변경 사항 검토
→ Migration 적용
→ Content 메뉴
→ Post 생성, 편집, 삭제
→ REST API 결과 확인
```

M1의 필드 타입은 `text`, `number`, `boolean`, `datetime`으로 제한한다.
Schema 변경은 먼저 preview하고, 명시적으로 적용해야 DB에 반영된다.

로그인한 브라우저에서 Collection 목록을 확인할 수 있다.

```bash
curl --fail http://127.0.0.1:3100/api/health
```

인증이 필요한 REST 요청은 브라우저의 HttpOnly 세션 쿠키를 사용한다.
상태를 변경하는 요청에는 로그인 응답 또는 세션 응답에서 받은 CSRF
토큰도 함께 전송해야 한다.

## 5. 자동화된 E2E 검증

다음 명령은 개발 DB와 별개인 `127.0.0.1:55432`의 임시 PostgreSQL을
시작하고 Chromium 검증이 끝나면 제거한다. E2E는 watcher가 아니라 production
build를 사용하며, XeCMS 서버가 빌드된 Admin 정적 파일을 같은 origin에서
제공하는 실제 배포 경로를 검증한다.

```bash
pnpm test:e2e
```

검증 흐름은 다음과 같다.

1. 실제 PostgreSQL에서 서버 integration과 개발 seed 시나리오를 실행한다.
2. 빈 DB에서 `/admin/setup`으로 강한 테스트 비밀번호를 사용한 최초 Owner를 생성한다.
3. 세션을 지우고 `/admin/login`에서 같은 계정으로 다시 로그인한다.
4. Posts Collection과 세 필드를 UI로 정의한다.
5. migration preview를 확인하고 적용한다.
6. 문서를 UI에서 생성하고 REST API에서 같은 데이터를 확인한다.
7. 문서를 UI에서 편집·삭제하고 REST API 결과가 일치하는지 확인한다.
8. 최초 Owner bootstrap을 다시 실행할 수 없는지 확인한다.
9. 새 문서를 게시한 뒤 비공개 Draft를 저장해 Public data, Revision ID와
   `updatedAt`이 게시 Revision에 고정되는지 확인한다.
10. Revision history에서 과거 snapshot을 새 Draft로 복원하고 다시 게시한다.
11. soft delete, trash restore와 문서 ID 확인을 요구하는 purge UI를 완주한다.
    stale purge 충돌에서는 대화상자를 닫고 최신 버전을 다시 불러온 뒤 재시도하며,
    성공 후 Admin Document, Revision과 Public 조회가 모두 `404`인지 확인한다.

E2E에서는 `XECMS_DEV_SEED=false`로 실제 bootstrap 경계를 검증한다. 임시 DB는
Docker Compose의 `postgres-e2e` profile과 tmpfs를 사용하므로 개발 DB volume을
삭제하지 않는다.

전체 M1 검증은 다음 명령으로 실행한다.

```bash
pnpm verify:m1
```

M2-A까지 포함한 누적 Gate는 같은 기반 검사를 명시적인 milestone 이름으로
실행한다.

```bash
pnpm verify:m2a
```

## 6. 종료와 초기화

개발 PostgreSQL만 중지한다.

```bash
pnpm db:down
```

로컬 데이터를 완전히 비우고 최초 상태로 돌아가려면 다음 명령을 사용한다.

```bash
docker compose down --volumes
```

`--volumes`는 로컬 XeCMS 데이터 전체를 영구 삭제한다. E2E 정리를 위해 이
명령을 사용할 필요는 없다.

## 7. 주요 환경 변수

| 변수 | 개발 기본값 | 의미 |
|---|---|---|
| `DATABASE_URL` | `postgresql://xecms:xecms@127.0.0.1:54320/xecms` | 서버 DB 연결 문자열 |
| `XECMS_DB_SCHEMA` | 서버 기본값 | PostgreSQL schema 격리 경계 |
| `XECMS_PORT` | `3100` | API 서버 포트 |
| `XECMS_ADMIN_HOST` | `127.0.0.1` | Vite Admin 개발 서버 host |
| `XECMS_ADMIN_PORT` | `5173` | Vite Admin 개발 서버 port |
| `XECMS_ADMIN_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | 쉼표로 구분한 허용 Admin origin 목록 |
| `XECMS_SESSION_SECRET` | 로컬 전용 문자열 | 세션 서명 secret |
| `XECMS_DEV_SEED` | `true` | 개발 초기 계정 생성 여부 |
| `XECMS_DEV_ADMIN_USERNAME` | `admin` | 개발 초기 사용자 이름 |
| `XECMS_DEV_ADMIN_PASSWORD` | `admin` | 개발 초기 비밀번호 |
| `XECMS_E2E_DATABASE_URL` | 포트 `55432`의 임시 DB | E2E 전용 연결 문자열 |
| `XECMS_SERVER_URL` | `http://127.0.0.1:3100` | Vite proxy와 E2E가 사용할 API 주소 |
| `XECMS_E2E_ADMIN_URL` | `http://127.0.0.1:3100` | 같은 origin에서 제공되는 빌드 Admin 주소 |

포트를 변경할 때는 Server URL, Admin origin, Vite proxy target을 함께 맞춘다.

## 8. 자주 발생하는 문제

### PostgreSQL 포트가 이미 사용 중인 경우

`.env`에서 `XECMS_POSTGRES_PORT`와 `DATABASE_URL`의 포트를 같은 값으로
변경한다.

### Admin은 열리지만 API 요청이 실패하는 경우

`/api/health`를 먼저 확인하고, Vite proxy target이 서버 포트 `3100`을
가리키는지 확인한다. Admin의 `502 Bad Gateway`는 Vite 자체 오류가 아니라
proxy 대상 API가 실행 중이지 않다는 뜻이다. 현재 개발 실행기는 workspace
소스를 직접 참조하므로 `pnpm clean` 때문에 API가 종료되어서는 안 된다.

### E2E 실행 시 포트 충돌이 발생하는 경우

E2E는 잘못된 DB의 기존 서버를 재사용하지 않도록 의도적으로 별도 서버
프로세스를 시작한다. 개발 서버를 유지해야 한다면 별도 포트를 지정한다.

```bash
XECMS_SERVER_URL=http://127.0.0.1:3101 \
XECMS_E2E_ADMIN_URL=http://127.0.0.1:3101 \
pnpm test:e2e
```

### 초기 설정 화면이 나타나지 않는 경우

개발 seed가 활성화되었거나 해당 DB에 이미 Identity가 존재하는 상태다.
로컬 데이터를 정말 삭제해도 되는지 확인한 뒤에만 volume을 초기화한다.
