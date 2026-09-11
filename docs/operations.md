# 운영 가이드

XeCMS 인스턴스를 운영하기 위한 CLI, 헬스 체크, 백업/복구, 진단, 마이그레이션을
설명합니다. 대부분 `xecms` CLI로 수행합니다.
프로덕션 빌드와 최초 실행은 [빌드 및 배포](./deployment.md)를 먼저 참고하세요.

## CLI 개요

```text
xecms init [directory] --starter minimal|blog|community
xecms dev
xecms start
xecms migrate
xecms schema validate [file]
xecms schema export [file]
xecms generate types [--source file|active] [--output file]
xecms doctor [--json]
xecms plugin inspect [--json]
xecms plugin disable <id> --offline [--expected-revision <n>]
xecms plugin sync [--apply]
xecms backup create <directory>
xecms backup restore <directory> --confirm-empty
xecms version
```

전역 옵션: `--cwd <project-directory>`.

## 헬스 체크

로드밸런서·오케스트레이터의 프로브로 사용합니다.

| 엔드포인트 | 용도 |
| --- | --- |
| `GET /api/live` | Liveness — 프로세스 생존 |
| `GET /api/ready` | Readiness — DB·의존성 준비 완료 |
| `GET /api/health` | 상세 헬스 정보 |

## Doctor (진단)

인스턴스 상태를 종합 점검합니다.

```bash
xecms doctor          # 사람이 읽는 출력
xecms doctor --json   # 자동화용 JSON
```

점검 항목:

| 항목 | 내용 |
| --- | --- |
| `runtime` | Node.js 버전 호환성 |
| `database` | PostgreSQL 연결 |
| `migrations` | 적용된 마이그레이션이 릴리스와 일치하는지 |
| `schema` | 활성 Schema와 매니페스트 일치 |
| `plugins` | 설치된 Plugin 레코드 정합성 |
| `worker` | 백그라운드 작업 큐 가독성 |
| `storage` | 미디어 저장소 읽기/쓰기 |
| `configuration` | 설정 로딩 |
| `backup-tools` | `pg_dump`/`pg_restore`/`tar` 실행 가능 여부 |

전체 상태는 `healthy` / `degraded` / `unhealthy`로 요약됩니다.

## Plugin 시작 실패 복구

활성 Plugin의 패키지 누락, manifest·migration 불일치, health 실패로 서버가 시작되지
않으면 서버를 중지하고 DB 자격 증명이 설정된 프로젝트에서 다음 명령을 사용합니다.

```bash
xecms plugin inspect --json
xecms plugin disable example-greeter --offline --expected-revision 2
xecms start
```

`inspect`와 `disable --offline`은 서버나 Plugin 패키지를 로드하지 않습니다. `inspect`는
저장된 상태, revision, manifest digest, migration ID·순서·checksum을 검사합니다.
실행 패키지의 존재와 health는 검사하지 않으며 Plugin config도 출력하지 않습니다.
`--expected-revision`에 조회한 revision을 지정하면 조회 이후 변경된 Plugin을 덮어쓰지 않습니다.
비활성화는 다음 서버 시작에 반영되고 config, Plugin 데이터, migration 이력을 보존합니다.
표시된 활성 의존 Plugin도 확인하고 필요한 항목을 각각 비활성화하세요. 해당 Plugin 기능과
필드를 사용하는 화면은 패키지와 이력을 복구하여 다시 활성화할 때까지 사용할 수 없습니다.

패키지는 정상이고 manifest만 변경된 경우 기존 동기화 명령을 사용할 수 있습니다.

```bash
xecms plugin sync
xecms plugin sync --apply
```

미리보기는 조회용이며 `--apply`가 실행 시점의 상태를 transaction에서 다시 검증합니다.
digest가 같아도 migration 이력이 다르면 갱신하지 않습니다. schema 변경이 필요한 이력을
동기화로 덮어쓰지 말고 일치하는 패키지·이력을 복구한 후 lifecycle plan을 사용하세요.
sync와 offline disable은 revision을 증가시키고 감사 로그와 outbox를 함께 기록합니다.
실패하면 해당 transaction을 rollback하며 기존 Admin preview는 revision 충돌로 거부됩니다.
DB 자격 증명에 의한 복구는 `cli:offline-recovery`와 실제 DB `session_user`/`current_user`,
변경 전후 version으로 기록되고 애플리케이션 사용자 identity를 가장하지 않습니다.
동일 상태에 대한 재실행은 revision이나 감사를 중복 생성하지 않습니다.

## 백업과 복구

백업은 데이터베이스 덤프와 미디어 저장소를 함께 담습니다.

### 백업 도구 설정

`pg_dump`/`pg_restore` 실행 방법을 환경 변수로 지정합니다(로컬 설치 또는 컨테이너 실행).

```bash
XECMS_PG_DUMP_COMMAND_JSON=["docker","compose","exec","-T","postgres","pg_dump"]
XECMS_PG_RESTORE_COMMAND_JSON=["docker","compose","exec","-T","postgres","pg_restore"]
XECMS_BACKUP_DATABASE_URL=postgresql://user:pass@host:5432/xecms
XECMS_RESTORE_DATABASE_URL=postgresql://user:pass@host:5432/xecms
```

### 백업 생성

```bash
xecms backup create ./backups/2026-07-19
```

### 복구

복구는 **비어 있는 대상**에만 수행합니다. 안전을 위해 명시적 확인 플래그가 필요합니다.

```bash
xecms backup restore ./backups/2026-07-19 --confirm-empty
```

복구는 원자적으로 진행되며, 무결성 검사에 실패하면 대상을 비운 상태로 되돌려 재시도할 수
있게 합니다.

## 마이그레이션과 Upgrade

```bash
xecms migrate
```

- 마이그레이션은 **forward-only**입니다(자동 롤백 없음).
- 새 버전으로 Upgrade할 때는 마이그레이션을 적용하기 전에 반드시 백업하세요.
- 이전 버전의 데이터베이스도 순방향 마이그레이션으로 최신 스키마에 맞춰집니다.

## 백그라운드 Worker

Transactional Outbox와 lease 기반 Worker가 비동기 작업(감사, 데이터 보존 등)을
처리합니다.

| 변수 | 설명 |
| --- | --- |
| `XECMS_WORKER_ENABLED` | Worker 활성화 여부 |
| `XECMS_WORKER_POLL_MS` | 폴링 주기 |
| `XECMS_WORKER_BATCH_SIZE` | 배치 크기 |
| `XECMS_WORKER_LEASE_MS` | lease 시간 |
| `XECMS_WORKER_MAX_ATTEMPTS` | 최대 재시도 횟수 |

## 감사 로그와 데이터 보존

모든 중요한 변경(권한 변경, 소유자 이전, Full Access 등)은 감사 로그에 기록됩니다.
데이터 보존 정책으로 오래된 revision·감사 항목의 보관 기간을 관리할 수 있습니다.
이 기능은 Admin Studio의 `운영 및 감사` 화면에서 구성합니다.

## 주요 환경 변수

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `XECMS_HOST` / `XECMS_PORT` | API 서버 바인딩 |
| `XECMS_SESSION_SECRET` | 세션 서명 키 |
| `XECMS_ADMIN_ORIGINS` | Admin Studio 허용 Origin (CSRF) |
| `XECMS_CONTENT_ORIGINS` | 회원 사용자 공간 허용 Origin |
| `XECMS_MEDIA_STORAGE_ROOT` | 미디어 저장 경로 |
| `XECMS_MEDIA_MAX_UPLOAD_BYTES` | 업로드 최대 크기 |
| `XECMS_MEDIA_ALLOWED_MIME_TYPES` | 허용 MIME 타입 |

전체 목록은 프로젝트의 `.env.example`을 참고하세요.
