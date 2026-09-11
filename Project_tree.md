# Project Structure

## Overview

- Project Name: XeCMS 0.5.0
- Purpose: Schema 기반 콘텐츠 관리, Realm 권한, 관리 UI와 Plugin 확장을 제공하는 CMS
- Main Language: TypeScript, React TSX; 개발 도구는 Node.js MJS
- Framework: Fastify(API), React + Vite(Admin), 자체 domain/application 계층
- Runtime: Node.js >=22.22.0 (package.json 선언)
- Package Manager: pnpm 10.30.1 workspace
- Database: PostgreSQL 16 이상 (프로젝트 문서 기준)
- Main Entry Points: `packages/cli/src/bin.ts`, `apps/server/src/main.ts`, `apps/admin/src/main.tsx`
- Build Command: `pnpm build`
- Run Command: `pnpm dev` / 빌드 후 `pnpm start`
- Test Commands: `pnpm check`, `pnpm test:database`, `pnpm test:e2e`, `pnpm verify`

## Managed Project Structure

```text
XeCMS/
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── main.ts                    # 프로세스 시작과 종료 신호 처리
│   │       ├── server.ts                  # 서비스 조립과 기능별 API 연결
│   │       ├── server-lifecycle.ts        # startup/listen 실패 정리, Worker drain, 서버 종료
│   │       ├── schema-projection.ts       # Schema/권한 투영의 revision과 fence 조정
│   │       ├── content-hierarchy-runtime.ts # 계층 이동/순서와 권한 투영 처리
│   │       ├── realm-profile-schema.ts    # Realm profile Schema 생성과 활성화
│   │       ├── request-authentication.ts  # 세션, CSRF, Origin 및 API actor 처리
│   │       ├── response-presenters.ts     # HTTP 응답 DTO 변환
│   │       ├── config.ts                  # 환경 설정 및 운영 값 검증
│   │       ├── *-routes.ts                # 권한, Realm, 사용자, Plugin, Admin App 등 API
│   │       └── *.integration.test.ts      # 실제 PostgreSQL 기반 API 검증
│   └── admin/
│       ├── src/
│       │   ├── main.tsx / router.tsx      # React Provider와 지연 로딩 라우트
│       │   ├── client-adapter.ts          # SDK와 Admin UI API 계약 연결
│       │   ├── components/               # 공통 관리 화면 컴포넌트
│       │   ├── pages/                    # 콘텐츠, Schema, Realm, 운영 화면
│       │   │   ├── access/               # 권한 관리 화면별 모듈
│       │   │   ├── identity-realms/       # Realm 페이지와 소유자/회원/접근 상한/위임 관리 패널
│       │   │   └── composed-editor/      # Admin App 시각적 화면 편집기
│       │   └── rich-text/                # BlockNote 기반 콘텐츠 편집
│       └── vite.config.ts / tsconfig.json
├── packages/
│   ├── schema/                           # Schema IR, 검증, 변경 비교, starter
│   ├── core/                             # Document 수명주기 등 순수 domain
│   ├── authorization/                    # 권한 판정, scope, 관리 서열 domain
│   ├── application/
│   │   └── src/
│   │       ├── authorization.ts           # 기존 권한 API를 유지하는 facade
│   │       ├── authorization/             # 정책 context/CAS·평가·상한·관리·투영·seed·검증
│   │       └── *.ts                      # 콘텐츠/Realm/운영 use case와 저장소 interface
│   ├── database/
│   │   └── src/
│   │       ├── postgres.ts                # pool/투영 잠금 소유와 기존 DB API facade
│   │       ├── postgres/                 # Schema/Auth/콘텐츠 조회·쓰기 adapter 및 매핑
│   │       ├── postgres-plugin-recovery.ts # 서버 없이 수행하는 Plugin 상태 조회/복구 transaction
│   │       └── *.ts                      # 기능별 저장소, migration, media storage, password hashing
│   ├── contracts/                        # REST DTO와 요청/응답 계약
│   ├── client/                           # TypeScript REST SDK
│   ├── ui/                               # 공통 UI와 theme
│   ├── admin/                            # CMS UI API 추상화와 콘텐츠 입력 구성요소
│   ├── admin-apps/                       # Admin App manifest와 선언형 화면 모델
│   ├── admin-runtime/                    # 선언형 Admin App 실행 및 렌더링
│   ├── plugin-sdk/                       # Plugin manifest, 호환성, extension 계약
│   ├── cli/                              # server-command 수명주기, scaffold, doctor, backup/restore, Plugin 복구
│   └── create-xecms/                     # 프로젝트 생성 CLI 진입점
├── examples/                             # domain prototype, example-plugin, blog 예제
├── tests/e2e/                            # Playwright 사용자 여정
├── scripts/                              # 개발 실행, 경계/문서 검사, DB/E2E/release 검증
├── docs/                                 # 사용자·개발자 공개 문서
├── devdocs/                              # 로컬 내부 사양/진행 기록 (의도적으로 Git 제외)
│   ├── plans/                            # 개발 설계와 검증 계획
│   └── analysis/                         # 저장소 분석 및 개선 우선순위
├── .github/workflows/ci.yml               # quick/audit, 격리 DB, 전체 release/브라우저 검증
├── package.json / pnpm-workspace.yaml / pnpm-lock.yaml
├── tsconfig*.json / vitest.config.ts / playwright.config.ts
├── docker-compose.yml                    # PostgreSQL 개발/테스트 서비스
└── xecms.config.json / .env*.example       # 프로젝트 설정과 환경 변수 예시
```

소스 인접 단위 테스트는 각 패키지의 `src/`에 있다. 빌드 출력, 실제 `.env`, 미디어,
캐시, 의존성 디렉터리는 유지보수 구조에서 제외한다. `apps/admin/dist-types/`는
TypeScript 생성물로 Git 추적에서 제외하며 빌드로 재생성한다.

## Main Execution Flow

```text
CMS Studio → Admin API adapter → REST client → Fastify routes
                                           → Application service
                                           → Domain validation / authorization
                                           → PostgreSQL store → PostgreSQL

Composed Admin App → admin-runtime → runtime API → 권한/출력 보호 → 콘텐츠 service
Document mutation → Transactional Outbox → Event Worker → handler → delivery 상태 저장
CLI → 설정 로드 → server / database / schema / 운영 도구
```

## Important Components

- **인증·권한:** `packages/authorization/src/`, `packages/application/src/authorization.ts`,
  `authorization/`, `identity-realms.ts`, `entitlement-gate.ts`, `cross-realm-management-*.ts`.
  System/Content Realm, Membership, 역할/범위, Collection 접근 상한과 위임을 결합한다.
- **콘텐츠:** `packages/application/src/documents.ts`, `document-query.ts`, `hierarchy.ts`,
  `relations.ts`, `media.ts`. 수명주기, 검색, 계층, 관계, 미디어 책임을 담당한다.
- **DB:** `packages/database/src/postgres.ts`는 SchemaStore, DocumentStore, AuthStore의
  호환 facade다. `postgres/`의 adapter가 기존 pool과 transaction 경계로 실제 기능을 수행한다.
  다른 기능은 `postgres-*.ts`로 분리되어 있다. `migrate.ts`가 core migration을 조립한다.
- **확장:** `plugin-sdk`, application `plugins.ts`, database `postgres-plugins.ts`,
  server `plugin-routes.ts`, CLI `plugin-commands.ts`/`plugin-sync.ts`가 설치·실행·복구를 담당한다.
  offline inspect/disable은 Plugin code를 로딩하지 않으며 복구 변경은 revision·감사·outbox와 함께 커밋한다.
- **검증:** `scripts/check-*-boundaries.mjs`가 package 의존성을 검사하고,
  `run-postgres-tests.mjs`와 `run-e2e.mjs`가 조건부 DB 테스트 및 release 검증을 실행한다.

## Architecture Notes

- 순수 domain(schema/core/authorization)은 외부 런타임 의존성 없이 유지하는 구조다.
- application이 저장소 인터페이스를 정의하고 database가 구현한다. server가 이들을 조립한다.
- 한 인스턴스의 기본 Workspace를 사용한다. Realm 분리를 완전한 SaaS tenant 격리로 해석하지 않는다.
- Plugin은 trusted code이며 sandbox가 아니다. 기본 서버 catalog는 example-plugin을 포함한다.
- TypeScript project reference 빌드와 Vite 번들 빌드가 분리되어 있다.
- 권한 facade 내부는 단일 policy context와 entitlement cache를 공유한다. API/권한 불변식을
  유지하며 기능별 서비스로 위임한다. DB facade도 단일 pool과 기존 투영 잠금을 공유한다.
- 일부 기존 Realm 서비스/route/저장소는 여전히 크며, 후속 작업에서도 기능별 책임 분리를 유지한다.
- 2026-09-11, Git `60cc294`와 P1 안정화 작업의 실제 구조를 기준으로 갱신했다.
