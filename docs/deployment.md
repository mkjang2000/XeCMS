# 빌드 및 배포

XeCMS 소스 저장소를 production용으로 빌드하고 실행하는 절차를 설명합니다. 공개 Registry가
배포되기 전까지는 이 저장소를 배포 호스트에서 빌드하는 방식을 기준으로 합니다.

## 1. 프로덕션 빌드

```bash
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build`는 한 번에 다음 산출물을 만듭니다.

| 산출물 | 내용 |
| --- | --- |
| `packages/*/dist` | Core, SDK, CLI 등 TypeScript 패키지 |
| `apps/server/dist` | Node.js API 서버 |
| `apps/admin/dist` | 서버가 `/admin`에서 제공할 정적 Admin 번들 |
| `examples/example-plugin/dist` | 기본 Trusted Plugin 예제 |

`pnpm start`는 소스를 컴파일하지 않습니다. 위 산출물이 없는 새 checkout에서는 먼저
`pnpm build`를 실행해야 합니다.

## 2. 프로덕션 환경 설정

예제 파일을 별도 production 환경 파일로 복사합니다.

```bash
cp .env.production.example .env.production
```

최소한 다음 값은 배포 환경에 맞게 변경해야 합니다.

| 변수 | 필수 조건 |
| --- | --- |
| `DATABASE_URL` | 운영 PostgreSQL 연결 문자열 |
| `XECMS_SESSION_SECRET` | 32바이트 이상의 무작위 비밀값 |
| `XECMS_ADMIN_ORIGINS` | 사용자가 접속할 Admin의 HTTPS Origin |
| `XECMS_CONTENT_ORIGINS` | Content Realm 쿠키를 사용할 프런트엔드 Origin |
| `XECMS_MEDIA_STORAGE_ROOT` | 재시작 후에도 보존되는 절대 경로 |
| `XECMS_HOST` / `XECMS_PORT` | Reverse Proxy 뒤의 내부 바인딩 주소 |

환경 파일을 선택할 때는 `XECMS_ENV_FILE`을 사용합니다. 지정하지 않으면 `.env`를 읽습니다.

```bash
XECMS_ENV_FILE=.env.production pnpm doctor
```

production 모드는 짧은 session secret, 누락된 DB URL과 개발 전용 Origin 우회 설정을
거부합니다. 기본 Schema 모드는 `locked`이며, Studio에서 Schema를 직접 편집해야 하는 운영
방식이라면 변경 절차를 정한 뒤 `XECMS_SCHEMA_MODE=editable`을 명시합니다.

## 3. 마이그레이션과 실행

첫 실행과 모든 Upgrade에서 서버보다 먼저 마이그레이션을 적용합니다.

```bash
XECMS_ENV_FILE=.env.production pnpm migrate
XECMS_ENV_FILE=.env.production pnpm start
```

`pnpm start`는 `NODE_ENV=production`을 강제하고, 빌드된 API 서버가 `apps/admin/dist`도 함께
제공합니다. 기본 URL은 `http://127.0.0.1:3100/admin/`입니다. 프로세스 관리자는 `SIGTERM`을
보내 정상 종료를 기다려야 합니다.

인터넷에 직접 Node.js 포트를 노출하지 말고 TLS를 종료하는 Reverse Proxy 또는
로드밸런서 뒤에서 실행하세요. Proxy의 공개 주소는 `XECMS_ADMIN_ORIGINS`와 정확히 일치해야
합니다.

## 4. 배포 후 확인

```bash
curl --fail http://127.0.0.1:3100/api/live
curl --fail http://127.0.0.1:3100/api/ready
XECMS_ENV_FILE=.env.production pnpm doctor
```

오케스트레이터는 `/api/live`를 liveness probe, `/api/ready`를 readiness probe로 사용합니다.
새 프로세스가 ready가 되기 전에는 트래픽을 보내지 않습니다.

## 5. 영속 데이터와 Upgrade

다음 두 대상은 함께 보존하고 백업해야 합니다.

- `DATABASE_URL`이 가리키는 PostgreSQL 데이터베이스
- `XECMS_MEDIA_STORAGE_ROOT`의 파일 전체

Upgrade 순서는 다음과 같습니다.

1. 현재 버전에서 DB와 미디어 백업 생성
2. 새 소스 checkout에서 `pnpm install --frozen-lockfile && pnpm build`
3. `XECMS_ENV_FILE=.env.production pnpm migrate`
4. 새 프로세스 시작 후 readiness와 `pnpm doctor` 확인
5. 이상이 없을 때 이전 프로세스 종료

마이그레이션은 forward-only이므로 코드만 이전 버전으로 되돌리는 것을 rollback 절차로
간주할 수 없습니다. 자세한 백업·복구 방법은 [운영 가이드](./operations.md)를 참고하세요.
