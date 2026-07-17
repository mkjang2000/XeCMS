# XeCMS 0.4 운영 Runbook

## 1. 지원 상태

현재 `@xecms/*` package와 container image는 공개 Registry에 배포되지 않았다.
운영 검증은 이 저장소를 clone하고 lockfile을 보존한 설치를 기준으로 한다.

요구 사항:

- Node.js 22.13 이상
- pnpm 10.30 이상
- PostgreSQL 18
- media persistent volume
- `pg_dump`와 `pg_restore`

## 2. 첫 설치

```bash
git clone https://github.com/mkjang2000/XeCMS.git
cd XeCMS
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

운영용 `.env`에서 최소한 다음을 교체한다.

- `NODE_ENV=production`
- 32 byte 이상의 무작위 `XECMS_SESSION_SECRET`
- 별도 PostgreSQL 사용자와 password
- 명시적인 Admin/Content origin
- persistent media root
- 외부에서 불필요한 loopback 외 bind 금지

DB를 준비하고 migration을 적용한다.

```bash
pnpm db:migrate
pnpm build
pnpm build:admin
pnpm doctor
```

빈 DB의 첫 Admin 접근은 `/admin/setup`으로 이동한다.
자동 Owner seed와 기본 password는 제공하지 않는다.

## 3. 배포 전 확인

```bash
pnpm check
pnpm test:postgres:all
pnpm verify:m4c5
```

운영 artifact는 같은 commit의 Server, Admin bundle, CLI, migration과 Plugin package를
함께 배포해야 한다. 일부 package만 교체해 manifest 또는 migration drift를 만들면 안 된다.

## 4. Upgrade

1. 새 release가 현재 Node/PostgreSQL과 호환되는지 확인한다.
2. `xecms doctor --json` 결과를 저장한다.
3. Worker와 Server를 중지해 maintenance window를 연다.
4. DB와 media가 같은 복구 시점을 갖도록 pre-upgrade backup을 생성한다.
5. repository commit과 lockfile을 고정한 채 의존성을 설치한다.
6. build 후 migration을 한 번 실행한다.
7. `doctor`와 readiness를 통과시킨다.
8. Server와 Worker를 시작한다.
9. Admin login, active Schema, 대표 public read와 Plugin route를 smoke test한다.

```bash
pnpm xecms backup create backups/pre-upgrade
pnpm install --frozen-lockfile
pnpm build
pnpm build:admin
pnpm db:migrate
pnpm doctor
```

Migration은 forward-only다. `_xecms_core_migrations`를 수동으로 수정하거나
downgrade SQL을 실행하지 않는다.

Migration transaction이 실패하면 원인을 수정한 뒤 같은 release로 재실행한다.
이전 release로 돌아가야 한다면 새 빈 DB에 upgrade 전 backup을 복원한다.

## 5. Backup

```bash
pnpm xecms backup create backups/2026-07-17
```

생성 artifact:

- `backup-manifest.json`
- `database.dump`
- `media.tar.gz`

세 파일을 하나의 세트로 암호화된 외부 저장소에 복제한다.
manifest에는 DB credential이 없지만 dump와 media에는 개인정보와 secret성 데이터가
포함될 수 있다.

Backup 성공만 확인하지 말고 정기적으로 격리된 환경에서 restore를 검증한다.

## 6. 빈 Instance Restore

Restore 대상은 비어 있는 DB schema와 media root여야 한다.

```bash
pnpm xecms backup restore /secure/backups/2026-07-17 --confirm-empty
pnpm doctor
```

기존 데이터와 merge restore는 거부한다.

Restore는 실행 전에 다음을 검증한다.

- manifest format과 XeCMS version compatibility
- artifact 고정 파일명과 SHA-256
- DB schema 이름
- media archive path
- symlink/hardlink 및 path traversal

실패 시 이번 restore가 생성한 schema와 staging/final media root만 정리해야 한다.

복원 후 비교:

- active Schema hash
- Document, Identity, Role, Plugin과 Media count
- 대표 media SHA-256
- `/api/ready`

검증이 끝나기 전에 트래픽을 연결하지 않는다.

## 7. Health

| Endpoint | 의미 |
| --- | --- |
| `/api/live` | process가 요청에 응답하는가 |
| `/api/ready` | DB, migration, storage와 Plugin 상태가 트래픽을 받을 수 있는가 |

live 성공/ready 실패는 정상적인 degraded 상태일 수 있다.
readiness response와 `pnpm doctor -- --json`을 함께 확인한다.

## 8. 장애 판단

| 증상 | 조치 |
| --- | --- |
| `/api/live` 실패 | process/container와 runtime log 확인 |
| live 성공, ready 실패 | DB, migration, storage와 Plugin check 확인 |
| migration drift | 배포 commit/DB 대상 확인, history 수동 조작 금지 |
| Plugin manifest drift | 올바른 package artifact로 복구하거나 backup restore |
| storage failure | volume mount, owner/mode, disk와 inode 확인 |
| dead delivery 증가 | Handler 수정 후 Admin Operations에서 명시적 retry |
| Admin 502 | API process와 reverse proxy target 확인 |
| Origin 거부 | 실제 scheme/host/port와 allowlist 비교 |
| Audit 조회 지연 | filter 범위를 줄이고 대용량 read model 도입 여부 검토 |

## 9. Secret과 Audit

- password, session cookie, CSRF token과 API key 원문을 로그에 남기지 않는다.
- `.env`, backup과 DB dump에 접근 가능한 운영자를 최소화한다.
- 민감 설정 변경, Owner 이전, credential reset과 Plugin lifecycle은 Audit을 확인한다.
- 지원 요청에 DB dump나 전체 Audit export를 그대로 첨부하지 않는다.

## 10. 보존과 정리

Retention은 반드시 Preview 후 Apply한다.
Preview와 Apply 사이 candidate digest가 달라지면 plan을 새로 만든다.

Backup 보존, PostgreSQL PITR/WAL, 외부 Object Storage lifecycle과 log rotation은
현재 XeCMS core가 아니라 배포 환경이 담당한다.
