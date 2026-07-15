# XeCMS 0.4 운영 Runbook

> 상세 계약: [M4-C5 Operations & Distribution](./m4c5-operations-distribution.md)

## 설치와 첫 실행

```bash
pnpm dlx --package=@xecms/cli create-xecms my-cms --starter blog
cd my-cms
pnpm install
docker compose up -d --wait
pnpm migrate
pnpm dev
```

`minimal`, `blog`, `community` starter를 선택할 수 있다. 개발 seed의 `admin/admin`은
로컬 점검 전용이다. 공유/운영 환경에서는 `NODE_ENV=production`, 32 byte 이상의 무작위
session secret, 별도 DB credential과 명시적인 origin을 사용하고 development seed를 끈다.

## 배포와 upgrade

1. 호환되는 Node.js와 PostgreSQL version을 확인하고 `xecms doctor`를 통과시킨다.
2. Worker와 Server를 정지해 maintenance window를 연다.
3. DB와 media가 같은 복구 시점을 갖도록 `xecms backup create backups/pre-upgrade`를 실행한다.
4. package lock을 보존한 상태에서 XeCMS package를 upgrade한다.
5. `xecms migrate`를 한 번 실행한다. 실패하면 재실행 전에 오류 원인을 수정한다.
6. `xecms doctor`, `/api/ready`를 통과한 뒤 Server와 Worker를 시작한다.
7. Admin 로그인, active Schema, 공개 read와 Plugin Route를 smoke test한다.

Migration은 forward-only다. `_xecms_core_migrations`를 수동으로 추가하거나 downgrade SQL을
실행하지 않는다. 실패한 migration은 transaction이 rollback하므로 같은 release에서 원인을
수정한 후 재실행한다. 이전 release로 돌아가야 하면 새 빈 DB에 upgrade 전 backup을 복원한다.

## Backup

```bash
xecms backup create backups/2026-07-15
```

생성된 `backup-manifest.json`, `database.dump`, `media.tar.gz`를 함께 외부 저장소로 복제한다.
manifest에는 DB credential이 없지만 dump와 media 자체는 민감 데이터이므로 암호화와 접근
통제를 적용한다. 외부 Object Storage, PostgreSQL PITR/WAL과 보존 정책은 배포 환경이 담당한다.

## 빈 Instance Restore

```bash
# DATABASE_URL과 media root가 비어 있는 새 Instance를 가리켜야 한다.
xecms backup restore /secure/backups/2026-07-15 --confirm-empty
xecms doctor
```

기존 schema 위 merge restore는 거부된다. checksum, media archive path, schema 이름을 먼저
검증하며 실패 시 이번 시도가 만든 대상 schema와 staging media만 정리한다. Restore 뒤에는
원본/복원 Instance의 active Schema hash, Document/Identity/Role/Plugin/Media count와 대표
파일 SHA-256를 비교하고 `/api/ready` 확인 전 트래픽을 연결하지 않는다.

## 장애 판단

| 증상 | 조치 |
| --- | --- |
| `/api/live` 실패 | process/container와 runtime log 확인 |
| live 성공, ready 실패 | readiness의 DB/migration/storage/plugin check와 `xecms doctor --json` 확인 |
| migration drift | 배포 package/DB 대상 확인; history 수동 조작 금지 |
| Plugin drift | 올바른 package artifact로 복구하거나 backup에서 복원 |
| storage failure | volume mount, owner/mode, disk 용량 확인 |
| dead delivery | Admin Operations에서 원인 확인 후 Handler 수정과 명시적 재시도 |

로그, Audit export와 backup 어디에도 password/session/API key 원문을 복사하지 않는다.
