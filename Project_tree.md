# Project Structure

## Overview

- Project Name: XeCMS 0.6.0
- Purpose: Schema 기반 콘텐츠 관리 엔진과 관리 UI. 업무 화면 빌더는 선택 확장으로 제공
- Main Language: TypeScript, React TSX; 개발 도구는 Node.js MJS
- Framework: Fastify(API), React + Vite(Admin), 자체 domain/application 계층
- Runtime: Node.js >=22.22.0 (package.json 선언)
- Package Manager: pnpm 10.30.1 workspace
- Database: PostgreSQL 16 이상 (프로젝트 문서 기준)
- Main Entry Points: `packages/cli/src/bin.ts`, `apps/server/src/main.ts`, `apps/admin/src/main.tsx`
- Build Commands: `pnpm build` (엔진), `pnpm build:all` (엔진·예제)
- Run Commands: `pnpm dev` / `pnpm start`
- Test Commands: `pnpm check` (엔진), `pnpm check:all`, `pnpm test:database:all`, `pnpm verify` (전체)
- Release Preparation: `pnpm release:pack --output <directory>`, `pnpm release:check-install <directory>` (엔진 15개 패키지, npm 미게시)

## Related Repositories

- [XeCMS-Plugin-AppBuilder](https://github.com/mkjang2000/XeCMS-Plugin-AppBuilder): 빌더 소스·UI·서버 확장·자체 테스트.
- [XeCMS-Docs](https://github.com/mkjang2000/XeCMS-Docs): 비공개 내부 설계·분석·개발 기록. `devdocs/` 원본을 이전했다.
- 공개 설치·API·운영 문서는 이 엔진 저장소의 `docs/`에서 관리한다.

## Managed Project Structure

```text
XeCMS/
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── main.ts                    # 프로세스 시작과 종료 신호 처리
│   │       ├── server.ts                  # 서비스 조립과 기능별 API 연결
│   │       ├── server-lifecycle.ts        # startup/listen 실패 정리, Worker drain, 서버 종료
│   │       ├── server-extensions.ts       # 빌더 독립적인 서버 확장 context·정적 화면·목록 API
│   │       ├── server-module-loader.ts    # 프로젝트에서 명시한 확장/Plugin만 로딩
│   │       ├── audience-authentication.ts # 확장의 System/Content Realm 인증 context
│   │       ├── schema-projection.ts       # Schema/권한 투영의 revision과 fence 조정
│   │       ├── content-hierarchy-runtime.ts # 계층 이동/순서와 권한 투영 처리
│   │       ├── realm-profile-schema.ts    # Realm profile Schema 생성과 활성화
│   │       ├── request-authentication.ts  # 세션, CSRF, Origin 및 API actor 처리
│   │       ├── response-presenters.ts     # HTTP 응답 DTO 변환
│   │       ├── config.ts                  # 환경 설정 및 운영 값 검증
│   │       ├── *-routes.ts                # 콘텐츠, 권한, Realm, 사용자, 운영 및 Plugin API
│   │       └── *.integration.test.ts      # 실제 PostgreSQL 기반 API 검증
│   └── admin/
│       ├── src/
│       │   ├── main.tsx / router.tsx      # React Provider와 지연 로딩 라우트
│       │   ├── client-adapter.ts          # SDK와 Admin UI API 계약 연결
│       │   ├── components/               # 공통 관리 화면·설치된 확장 진입 링크
│       │   ├── pages/                    # 콘텐츠, Schema, Realm, 운영 화면
│       │   │   ├── access/               # 권한 관리 화면별 모듈
│       │   │   └── identity-realms/       # Realm 페이지와 소유자/회원/접근 상한/위임 관리 패널
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
│   ├── plugin-sdk/                       # Plugin manifest, 호환성, extension 계약
│   ├── cli/                              # server-command 수명주기, scaffold, doctor, backup/restore, Plugin 복구
│   └── create-xecms/                     # 프로젝트 생성 CLI 진입점
├── examples/                             # domain prototype, example-plugin, blog 예제
├── tests/e2e/                            # Playwright 사용자 여정
├── scripts/                              # 개발 실행, 경계/문서 검사, DB/E2E/release 검증
│   ├── pack-release.mjs                  # 엔진 공개 tarball·LICENSE/고지·버전·checksum 생성
│   └── check-release-install.mjs         # 저장소 밖 tarball 설치·생성기·서버/SPA 검증
├── docs/                                 # 사용자·개발자 공개 문서
├── .github/workflows/ci.yml               # quick/audit, 격리 DB, 전체 release/브라우저 검증
├── package.json / pnpm-workspace.yaml / pnpm-lock.yaml
├── tsconfig{,.all}.json                  # 엔진 / 엔진·예제 TypeScript 빌드 경계
├── vitest.config.ts / playwright.config.ts
├── docker-compose.yml                    # PostgreSQL 개발/테스트 서비스
└── xecms.config.json / .env*.example       # 프로젝트 설정과 환경 변수 예시
```

소스 인접 단위 테스트는 각 패키지의 `src/`에 있다. 빌드 출력, 실제 `.env`, 미디어,
캐시, 의존성 디렉터리는 유지보수 구조에서 제외한다. `apps/admin/dist-types/`는
TypeScript 생성물로 Git 추적에서 제외하며 빌드로 재생성한다.
`pnpm clean`은 workspace 빌드 결과와 테스트 보고서·캐시를 제거한다. 소스 테스트는
유지하며 npm 패키지에서 제외한다. 루트 `dist/releases/`의 배포 준비물, 의존성,
환경 설정과 `.xecms/` 런타임 데이터는 clean 대상이 아니다.

## Main Execution Flow

```text
CMS Studio → Admin API adapter → REST client → Fastify routes
                                           → Application service
                                           → Domain validation / authorization
                                           → PostgreSQL store → PostgreSQL

선택 확장 설정 → 설치한 외부 서버 모듈 로딩 → 공개 ServerExtension context → 확장 service/routes/SPA
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
- **선택 서버 확장:** `server-extensions.ts`의 공개 host context를 사용한다. 빌더의 화면 모델·저장소·API는
  별도 AppBuilder 저장소가 소유하며 엔진은 빌더 패키지를 import하지 않는다. 설정으로 선택하는
  서버 확장과 기존 DB 기반 Plugin lifecycle은 별개이며 둘 다 trusted code다.
- **검증:** `scripts/check-*-boundaries.mjs`가 package 의존성을 검사하고,
  `check-engine-isolation.mjs`가 빌더/예제의 엔진 production 의존 유입을 차단한다.
  `run-postgres-tests.mjs`와 `run-e2e.mjs`가 엔진의 DB/release 검증을 실행한다.

## Architecture Notes

- 순수 domain(schema/core/authorization)은 외부 런타임 의존성 없이 유지하는 구조다.
- application이 저장소 인터페이스를 정의하고 database가 구현한다. server가 이들을 조립한다.
- 한 인스턴스의 기본 Workspace를 사용한다. Realm 분리를 완전한 SaaS tenant 격리로 해석하지 않는다.
- Plugin은 trusted code이며 sandbox가 아니다. 기본 서버의 Plugin/extension 목록은 비어 있다.
- 엔진의 source workspace와 production dependency 모두 빌더를 포함하지 않는다.
  별도 빌더는 엔진 package API에 의존하며 엔진 내부 소스/상대경로에 의존하지 않는다.
- 엔진 관리 SPA는 미리 번들된 정적 파일로 배포한다. React·콘텐츠 편집기 등 UI 빌드 의존성을
  소비 프로젝트에서 중복 설치하지 않는다. 별도 UI 라이브러리 패키지는 해당 peer 의존성을 유지한다.
- 기존 빌더 DB migration·권한 식별자는 역사적 호환층으로 유지하며 데이터나 적용 이력을 삭제하지 않는다.
- 개발 기록은 XeCMS-Docs의 devdocs, 공개 사용·배포 문서는 이 저장소 docs에서 관리한다.
  내부 개발 기록을 이 저장소에 복제하거나 공개 패키지에 포함하지 않는다.
- TypeScript project reference 빌드와 Vite 번들 빌드가 분리되어 있다.
- 빌더를 등록한 구성에서 `/admin/apps`, `/admin-apps/:appId/screens`, `/apps/:appKey/*`를 제공한다.
  이 route·SPA·관련 E2E는 별도 AppBuilder 저장소에서 소유한다.
- 권한 facade 내부는 단일 policy context와 entitlement cache를 공유한다. API/권한 불변식을
  유지하며 기능별 서비스로 위임한다. DB facade도 단일 pool과 기존 투영 잠금을 공유한다.
- 일부 기존 Realm 서비스/route/저장소는 여전히 크며, 후속 작업에서도 기능별 책임 분리를 유지한다.
- 2026-11-13, 엔진·AppBuilder·Docs의 독립 저장소 분리 구조를 기준으로 갱신했다.
