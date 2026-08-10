# XeCMS에 기여하기

Issue와 Pull Request를 환영합니다. 큰 기능이나 공개 API 변경은 구현 전에 Issue에서 방향을
먼저 논의해 주세요.

## 개발 환경

- Node.js 22.22 이상
- pnpm 10
- PostgreSQL 16 이상과 Docker Compose (통합/E2E 검증 시)

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm migrate
pnpm dev
```

## 변경 검증

```bash
pnpm check
pnpm verify:quick
```

DB 또는 사용자 여정에 영향을 주는 변경은 `pnpm test:database`나 `pnpm test:e2e`도 실행해
주세요. 릴리스 전 최종 검증은 `pnpm verify`입니다. 테스트 이름과 내부 코드에는 과거 MVP
마일스톤 표기가 남아 있을 수 있지만, 문서와 package script에서는 기능 기반 공개 명령만
사용합니다.

Commit에는 한 가지 논리적 변경을 담고, 새로운 동작에는 회귀 테스트와 관련 문서 변경을 함께
포함해 주세요. 기여한 코드는 프로젝트의 Apache-2.0 라이선스로 배포됩니다.

보안 문제는 공개 Issue 대신 [보안 정책](./SECURITY.md)의 비공개 제보 경로를 이용해 주세요.
