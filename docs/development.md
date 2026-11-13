# 개발 및 검증

이 저장소의 명령은 엔진과 엔진 관리 UI를 대상으로 합니다. 업무 화면 빌더는
[XeCMS-Plugin-AppBuilder](https://github.com/mkjang2000/XeCMS-Plugin-AppBuilder)에서
독립적으로 설치·개발·검증합니다. 내부 설계와 개발 기록은 비공개 XeCMS-Docs에서 관리합니다.

## 개발 명령

| 명령 | 용도 | 외부 서비스 |
| --- | --- | --- |
| `pnpm dev` | 엔진 API와 Vite CMS Studio 실행 | PostgreSQL |
| `pnpm build` | 엔진 패키지, 서버와 CMS Studio production 빌드 | 없음 |
| `pnpm start` | 빌드 산출물을 production 모드로 실행 | PostgreSQL |
| `pnpm build:all` | 엔진과 예제 전체 빌드 | 없음 |
| `pnpm clean` | 빌드 결과·테스트 보고서·도구 캐시 정리 | 없음 |
| `pnpm migrate` | forward-only DB 마이그레이션 적용 | PostgreSQL |
| `pnpm db:up` | 로컬 Compose PostgreSQL 시작 | Docker |
| `pnpm db:down` | 로컬 Compose PostgreSQL 중지 | Docker |

개발 서버는 소스를 감시하고 Admin을 별도 Vite Origin에서 제공합니다. production 동작을
확인할 때는 `pnpm build && pnpm start`를 사용합니다.
엔진 관리 UI의 개발 주소는 기본 `http://127.0.0.1:5173/admin/`입니다.

이 저장소의 `pnpm install`에는 빌더 workspace가 없습니다. 엔진 소비 프로젝트는
scaffold가 지정한 엔진 패키지만 설치하며, production 의존성에는 빌더나 차트 라이브러리가 없습니다.

## 검증 계층

| 명령 | 검증 범위 | 권장 시점 |
| --- | --- | --- |
| `pnpm test:unit` | 엔진 Vitest 단위 테스트 | 구현 중 |
| `pnpm typecheck` | 엔진 TypeScript project reference | 구현 중 |
| `pnpm check` | 경계·엔진 격리·문서·타입·엔진 단위 테스트 | 엔진 변경 시 |
| `pnpm check:all` | 엔진과 예제 전체 정적·단위 검증 | PR 전 |
| `pnpm verify:quick` | 엔진 `check` + source resolution + 빌드 | 엔진 변경 시 |
| `pnpm test:database` | 엔진 PostgreSQL 조건부 통합·회귀 테스트 | 엔진 DB 변경 시 |
| `pnpm test:database:all` | 엔진 PostgreSQL 회귀 (`test:database`와 동일) | 전체 DB 검증 시 |
| `pnpm test:e2e` | 엔진 Chromium 사용자 여정 | 엔진 UI/API 변경 시 |
| `pnpm verify` | 전체 정적·단위, 배포 tarball, DB, backup/restore, 엔진 E2E | 릴리스 전 |
| `pnpm release:pack --output <directory>` | 공개 패키지 전체 tarball·버전·파일·라이선스 검사 | 빌드 후 배포 준비 |
| `pnpm release:check-install <directory>` | tarball로 생성기·엔진을 독립 설치 | 배포 준비 |
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
docker compose --project-name xecms-engine-tests --profile e2e up --detach --wait postgres-e2e
pnpm build:packages
XECMS_E2E_DB_SERVICE=xecms-engine-tests-postgres-e2e-1 pnpm test:database
docker compose --project-name xecms-engine-tests --profile e2e down --volumes --remove-orphans
```

위 명령은 개발 DB와 다른 Compose project를 사용합니다. 기본 개발 project를 대상으로
`down --volumes`를 실행하면 개발 데이터 볼륨도 삭제되므로 테스트 정리에 사용하지 않습니다.

CI는 PR과 main 변경에서 엔진 검사, 격리 PostgreSQL 회귀, 전체 release 검증을 실행합니다.
릴리스 게시와 수동 실행도 동일한 검증을 수행하며, 브라우저 실패 자료는 artifact로 남깁니다.
`dist/`와 `dist-types/`는 빌드 생성물로 Git 추적에서 제외합니다.

## 생성 파일 관리

`pnpm clean`은 각 workspace의 `dist/`, `dist-types/`와 테스트 보고서·coverage·도구
캐시를 제거합니다. 다시 실행할 때는 `pnpm build`로 빌드 결과를 생성합니다.
`dist/releases/`의 배포 준비물, `node_modules/`의 설치 의존성, `.env`와 `.xecms/`의
환경 설정·런타임 데이터는 보존합니다. 오래된 배포 준비물은 필요한 최신 버전을
확인한 뒤 해당 디렉터리만 정리하세요.

소스의 `*.test.ts(x)`, `tests/e2e/`와 테스트 보조 파일은 CI에서 사용하는 검증 코드로
Git에서 관리합니다. TypeScript 검사 과정에서 생기는 테스트 JS·선언·맵은 생성물이며,
npm 배포 패키지에는 테스트와 테스트 전용 보조 파일을 포함하지 않습니다.
캐시·로그·로컬 `.npmrc`와 `.xecms/`는 Git에서 제외합니다.

## 게시 전 패키지 검증

다음 명령은 npm에 게시하지 않습니다. 빌드한 공개 패키지를 비어 있는 출력 디렉터리에
묶고, 저장소 밖의 임시 소비 프로젝트에 설치하여 생성기·Schema·엔진 실행을 검증합니다.

```bash
pnpm build:all
pnpm release:pack --output ./dist/releases/0.6.0
pnpm release:check-install ./dist/releases/0.6.0
```

`release-manifest.json`에는 엔진 공개 패키지 15개의 의존 순서와 SHA-512가 기록됩니다.
패키지에는 LICENSE와 Third-Party Notices가 포함됩니다. 이미 생성된 출력 디렉터리는
덮어쓰지 않으므로 다시 준비할 때는 새 디렉터리를 지정합니다.

설치 검증은 미게시 XeCMS 버전을 로컬 tarball로 지정하고, 외부 의존성만 registry에서
받습니다. npm 캐시가 준비되어 있으면 `--offline`으로 실행할 수 있습니다.
`XECMS_TEST_DATABASE_URL`에 테스트 전용 DB를 지정하면 실제 서버 readiness·관리 화면
파일 제공도 확인합니다. 임시 Schema와 설치 디렉터리는 종료 시 제거하며,
`--keep`을 지정하면 설치 디렉터리를 남깁니다. DB를 지정하지 않으면 실행 검증은 건너뜁니다.

## E2E 선택 실행

전체 E2E는 기능별로 격리된 suite를 순차 실행합니다. 특정 기능만 확인하려면 `--suite`를
사용합니다.

```bash
pnpm test:e2e -- --suite plugins
pnpm test:e2e -- --suite content-and-authorization
```

선택 가능한 suite는 다음과 같습니다.

`setup-and-content`, `content-and-authorization`, `identity-realms`, `event-worker`, `users`,
`settings-and-sites`, `operations`, `plugins`, `runtime-health`

각 suite는 임시 PostgreSQL Schema와 미디어 디렉터리를 사용하며 종료 시 정리합니다.
빌더 E2E는 별도 빌더 저장소에서 실행합니다. Plugin 예제는 `plugins` suite에서만 명시적으로 로드합니다.
`pnpm verify`는 항상 엔진 전체 suite를 실행합니다. release 모드는
`XECMS_E2E_SUITES`를 무시하고 `--suite`와의 조합은 거부합니다.
