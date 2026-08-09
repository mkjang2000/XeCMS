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
