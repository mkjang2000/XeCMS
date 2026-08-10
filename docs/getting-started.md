# 시작하기

XeCMS 서버를 설치하고, 최초 Owner 계정을 만들고, 첫 API 요청을 보내는 과정을 안내합니다.

## 요구 사항

- **Node.js** 22.22 이상
- **pnpm** 10 (`corepack enable`로 활성화)
- **PostgreSQL** 16 이상 (Docker Compose 제공)

## 1. 프로젝트 생성

```bash
corepack enable
pnpm create xecms my-cms
cd my-cms
pnpm install
```

기본 starter는 `minimal`이다. 생성 명령에 `--starter blog` 또는 `--starter community`를
추가해 다음 starter 중 하나를 선택할 수 있다.

| Starter | 용도 |
| --- | --- |
| `minimal` | 빈 Schema에서 Admin Studio로 시작 |
| `blog` | Posts, Pages, Category 계층 구조 |
| `community` | 로그인 가능한 회원 사용자 공간과 Posts |

## 2. 환경 설정

생성된 프로젝트에는 `.env.example`과 로컬 개발용 `.env`가 함께 들어 있습니다. `.env`의
session secret은 프로젝트마다 무작위로 생성되며, 다른 환경으로 복사하지 않습니다.

최소 필수 값:

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `XECMS_SESSION_SECRET` | 세션 서명 키 (32자 이상 권장) |
| `XECMS_PORT` | API 서버 포트 (기본 `3100`) |
| `XECMS_ADMIN_ORIGINS` | Admin Studio 허용 Origin (CSRF 보호용) |

## 3. 데이터베이스와 서버 실행

로컬 PostgreSQL이 없다면 제공된 Compose로 띄웁니다.

```bash
docker compose up -d --wait # PostgreSQL 시작 및 readiness 대기
pnpm migrate         # 스키마 마이그레이션 적용 (forward-only)
pnpm dev             # API + 설치된 Admin Studio 실행
```

실행 후 사용할 수 있는 주소:

| 용도 | 주소 |
| --- | --- |
| Admin Studio | <http://127.0.0.1:3100/admin> |
| REST API | <http://127.0.0.1:3100/api> |
| Liveness | <http://127.0.0.1:3100/api/live> |
| Readiness | <http://127.0.0.1:3100/api/ready> |

생성된 프로젝트의 `pnpm dev`는 개발 환경 설정으로 API와 npm에 포함된 Admin Studio를 함께
실행한다. XeCMS 자체 소스 변경을 감지하는 watch/Vite 환경은 [개발 및 검증](./development.md)의
저장소 개발 절차를 사용한다. production 모드 실행은 [빌드 및 배포](./deployment.md)를 참고한다.

## 4. 최초 설정 완료하기

빈 데이터베이스에서는 초기 계정이 자동 생성되지 않습니다. 첫 접근은
`/admin/setup`으로 이동하며 다음 순서로 진행합니다.

1. 12자 이상의 비밀번호로 최초 Owner 계정 생성
2. 빈 프로젝트, 블로그, 커뮤니티 중 템플릿 선택
3. 선택 기능과 컬렉션 표시 이름 조정
4. 구성을 확인하고 첫 Schema 적용

Owner 생성 뒤 화면을 닫아도 다시 로그인하면 템플릿 선택 단계부터 이어진다. 필드 타입,
기술 이름, ID와 Relation 같은 상세 설정은 초기 설정을 마친 뒤 Schema 편집기에서 변경한다.
커뮤니티 템플릿은 Members 인증 Schema에 필요한 Content Realm도 함께 준비한다.

동일한 작업을 API로도 할 수 있습니다.

```bash
# 부트스트랩이 필요한지 확인
curl http://127.0.0.1:3100/api/bootstrap/status

# 최초 Owner 생성 및 세션 쿠키 저장
curl -c cookies.txt -X POST http://127.0.0.1:3100/api/bootstrap \
  -H "Content-Type: application/json" \
  -d '{ "username": "owner", "password": "change-me-please-2026" }'

# 응답의 csrfToken을 사용해 빈 프로젝트 템플릿 적용
curl -b cookies.txt -X POST http://127.0.0.1:3100/api/setup/template \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <bootstrap 응답의 csrfToken>" \
  -d '{ "starter": "minimal", "enabledModuleIds": [], "collectionLabels": {} }'
```

`bootstrap/status`의 `required`는 Owner 생성 필요 여부, `templateRequired`는 첫 Schema 적용
필요 여부를 나타낸다.

## 5. 첫 API 요청

로그인 후 세션 쿠키로 콘텐츠를 조회합니다.

```bash
# 로그인 (세션 쿠키를 파일에 저장)
curl -c cookies.txt -X POST http://127.0.0.1:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "username": "owner", "password": "change-me-please-2026" }'

# Collection 목록 조회
curl -b cookies.txt http://127.0.0.1:3100/api/collections
```

외부 애플리케이션에서는 세션 대신 **API Key**를 쓰는 것이 일반적입니다.
발급 방법과 사용법은 [인증](./authentication.md)을 참고하세요.

## 다음 단계

- [핵심 개념](./concepts.md) — 데이터·권한 모델 이해
- [인증](./authentication.md) — API Key 발급과 사용
- [REST API 레퍼런스](./rest-api.md) — 콘텐츠 CRUD
- [Schema 정의](./schema.md) — 콘텐츠 구조 설계
- [개발 및 검증](./development.md) — 빌드, 테스트와 release gate
- [빌드 및 배포](./deployment.md) — production 환경 구성과 실행
