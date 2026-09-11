# 개발 및 검증

XeCMS 저장소에서 사용하는 공개 개발 명령은 기능을 기준으로 이름 붙입니다. 과거 MVP 단계
코드에 따른 명령은 더 이상 사용하지 않습니다.

## 개발 명령

| 명령 | 용도 | 외부 서비스 |
| --- | --- | --- |
| `pnpm dev` | API와 Vite Admin 개발 서버 실행 | PostgreSQL |
| `pnpm build` | 전체 패키지, 서버와 Admin production 빌드 | 없음 |
| `pnpm start` | 빌드 산출물을 production 모드로 실행 | PostgreSQL |
| `pnpm migrate` | forward-only DB 마이그레이션 적용 | PostgreSQL |
| `pnpm db:up` | 로컬 Compose PostgreSQL 시작 | Docker |
| `pnpm db:down` | 로컬 Compose PostgreSQL 중지 | Docker |

개발 서버는 소스를 감시하고 Admin을 별도 Vite Origin에서 제공합니다. production 동작을
확인할 때는 `pnpm build && pnpm start`를 사용합니다.

## 검증 계층

| 명령 | 검증 범위 | 권장 시점 |
| --- | --- | --- |
| `pnpm test:unit` | DB 없이 실행되는 Vitest 단위 테스트 | 구현 중 |
| `pnpm typecheck` | 전체 TypeScript project reference | 구현 중 |
| `pnpm check` | 경계·문서·타입·단위 테스트 | PR 전 |
| `pnpm verify:quick` | `check` + source resolution + 전체 빌드 + prototype | PR 전 |
| `pnpm test:database` | PostgreSQL 조건부 통합·회귀 테스트 | DB 변경 시 |
| `pnpm test:e2e` | 격리 Schema를 사용하는 전체 Chromium 사용자 여정 | UI/API 변경 시 |
| `pnpm verify` | 배포 tarball, DB, backup/restore, 전체 E2E를 포함한 release gate | 릴리스 전 |
| `pnpm benchmark:database` | 대용량 hierarchy·audit·plugin export 특성 측정 | 성능 변경 시 |

`test:database`, `test:e2e`, `verify`는 Docker가 필요합니다. 브라우저가 설치되지 않은
환경에서는 먼저 다음 명령을 실행합니다.

```bash
pnpm exec playwright install chromium
```

`test:database`는 개발용 `.env`와 `DATABASE_URL`을 사용하지 않습니다. 기본 대상은
Compose의 테스트 DB(`127.0.0.1:55432/xecms_e2e`)입니다. 다른 격리 DB를 사용할 때는
`XECMS_TEST_DATABASE_URL`을 명시하세요. backup/restore 테스트에는 해당 PostgreSQL
컨테이너 이름을 `XECMS_E2E_DB_SERVICE`로 지정합니다.

```bash
docker compose --profile e2e up --detach --wait postgres-e2e
pnpm build:packages
pnpm test:database
docker compose --profile e2e down --volumes --remove-orphans
```

CI는 PR과 main 변경에서 빠른 검사, 격리 PostgreSQL 회귀, 전체 release 검증을 실행합니다.
릴리스 게시와 수동 실행도 동일한 검증을 수행하며, 브라우저 실패 자료는 artifact로 남깁니다.
`dist/`와 `dist-types/`는 빌드 생성물로 Git 추적에서 제외합니다.

## E2E 선택 실행

전체 E2E는 기능별로 격리된 suite를 순차 실행합니다. 특정 기능만 확인하려면 `--suite`를
사용합니다.

```bash
pnpm test:e2e -- --suite plugins
pnpm test:e2e -- --suite content-and-authorization
pnpm test:e2e:admin-apps
```

선택 가능한 suite는 다음과 같습니다.

`setup-and-content`, `content-and-authorization`, `identity-realms`, `event-worker`, `users`,
`settings-and-sites`, `operations`, `plugins`, `runtime-health`, `admin-apps`

각 suite는 임시 PostgreSQL Schema와 미디어 디렉터리를 사용하며 종료 시 정리합니다.
`pnpm verify`는 suite 선택 없이 항상 전체 release gate를 실행해야 합니다.
