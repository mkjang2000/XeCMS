# M4-C5 Operations & Distribution 상세 사양

> 상태: 완료 — TypeScript·PostgreSQL·배포 artifact·Chromium 누적 Gate 통과 (2026-07-15)
> 상위 계획: [M4-C 구현 계획](./m4c-administration-productization-plan.md)
> 선행 조건: [M4-C4 Trusted Plugin Platform](./m4c4-plugin-platform.md) 완료

## 1. 목표

C5는 XeCMS MVP를 빈 디렉터리에서 생성하고, 실행·진단·백업·복원·upgrade할 수 있는
배포 단위로 닫는다. Admin HTTP API와 운영자 로컬 CLI의 신뢰 경계를 분리하며, CLI가
콘텐츠/권한 Application Service를 우회하는 일반 mutation 통로가 되지 않게 한다.

```text
create-xecms / xecms init
          ↓
starter config + canonical Schema + generated types + compose
          ↓
xecms migrate → xecms dev → Admin bootstrap / first publish
          ↓
xecms doctor → backup create → empty restore → doctor
```

## 2. 배포와 버전 계약

- Core/Admin/Public API release line은 `0.4.x`, Plugin SDK는 `1.x`다.
- Public API는 같은 minor 안에서 additive change만 허용하고 제거/의미 변경은 다음 minor로
  넘긴다. 보안상 fail-closed 강화와 오류 수정은 patch에서 가능하다.
- DB migration은 forward-only이며 ID와 적용 순서는 release artifact에 고정한다.
- downgrade migration과 자동 rollback은 제공하지 않는다. restore는 upgrade 전 backup으로 한다.
- Plugin Manifest가 선언한 core/Admin/SDK range를 startup에서 검사한다.

## 3. CLI

`@xecms/cli`가 `xecms`와 `create-xecms` binary를 제공한다.

```text
xecms init [directory] --starter minimal|blog|community
xecms dev
xecms migrate
xecms schema validate [file]
xecms schema export [file]
xecms generate types [--source file|active]
xecms doctor [--json]
xecms backup create <directory>
xecms backup restore <directory> --confirm-empty
xecms version
```

- `.env`를 project root에서 읽되 secret을 출력하지 않는다.
- `migrate`는 core advisory lock과 transaction을 그대로 사용하며 재실행 가능하다.
- file 기반 Schema validate/type generation은 DB 없이 결정론적으로 동작한다.
- active Schema export/type generation은 DB의 active revision을 canonicalize한다.
- `dev`는 설치된 Server package와 Admin asset 경로를 사용한다.
- 오류는 non-zero exit, stable code, 해결 힌트를 함께 제공한다.

## 4. Starter와 scaffold

세 starter는 같은 실행 계약을 사용하고 Schema만 다르게 시작한다.

| Starter | 포함 범위 |
| --- | --- |
| minimal | 빈 canonical Schema, Admin에서 처음부터 설계 |
| blog | Posts, Pages, Category hierarchy와 일반 Blog field |
| community | auth-enabled Members Realm, Posts와 Profile 기반 |

scaffold는 `package.json`, `xecms.config.json`, `.env`, `.env.example`, `.gitignore`,
`compose.yaml`, canonical `xecms.schema.json`, `xecms.generated.ts`, `README.md`를 만든다.
비어 있지 않은 디렉터리를 암묵적으로 덮어쓰지 않는다.

## 5. Doctor

Doctor 결과는 `pass | warn | fail` check 목록과 최종 exit code로 제공한다.

- Node runtime과 production secret/config
- PostgreSQL 연결 및 server version
- core migration 누락·순서·미지원 future migration
- active Schema hash와 project Manifest drift
- enabled Plugin manifest digest와 migration checksum/history
- media storage read/write와 source/Admin 경로 밖 전용 volume 여부
- Worker enabled 상태, 오래된 pending outbox/dead delivery 요약
- backup 도구 실행 가능 여부

secret, connection password, session/API key 원문은 결과에 넣지 않는다.

## 6. Health와 readiness

- `/api/live`: process event loop가 응답할 수 있는지 확인하며 DB를 요구하지 않는다.
- `/api/health`: 기존 호환 endpoint로 DB ping을 포함한다.
- `/api/ready`: DB, 최신 core migration, media storage 접근과 enabled Plugin startup 검사를
  통과한 process만 `200 ready`를 반환한다. 실패 시 `503`과 비민감 check만 반환한다.
- 요청 로그는 request ID를 가진 구조화 JSON을 유지하고 readiness probe에도 같은 형식을 쓴다.

## 7. Backup과 restore

backup directory는 다음 원자 artifact를 가진다.

```text
backup-manifest.json
database.dump
media.tar.gz
```

manifest는 format/release, 생성 시각, DB schema, dump/media SHA-256와 active Schema hash를
기록한다. DB dump는 credential/URL을 manifest에 넣지 않고 `pg_dump` custom format을 쓴다.
media는 DB dump와 같은 maintenance window에서 별도 archive한다.

restore는 다음을 강제한다.

1. checksum과 format/version 사전 검증
2. `--confirm-empty`와 대상 DB schema 부재, media directory 비어 있음
3. path traversal 없는 media archive
4. DB restore 성공 후 staging media를 원자 이동
5. migration/Schema/Plugin/media를 Doctor로 사후 검증
6. 실패 시 이번 restore가 만든 빈 대상 schema와 staging만 정리

운영 중인 Instance 위로 merge restore하거나 일부 table만 자동 복구하지 않는다.

## 8. Upgrade와 복구

- 이전 release fixture는 migration 일부가 적용된 populated DB로 보존한다.
- 현재 `xecms migrate`를 두 번 실행해 first upgrade와 idempotency를 검증한다.
- migration은 schema advisory lock과 transaction 안에서 실패하므로 해당 core migration ID를
  기록하지 않는다.
- upgrade 전 backup, application 정지, migration, Doctor, application 시작 순서를 runbook으로
  고정한다.
- 실패한 migration에서 수동 SQL로 migration history를 위조하지 않는다.

## 9. 완료 Gate

- 빈 디렉터리에서 세 starter를 생성하고 Schema build/type generation을 완주한다.
- scaffold → migrate → server readiness → Admin bootstrap/첫 게시 흐름이 실행된다.
- source backup을 별도 빈 DB/media root에 restore하고 Schema, Document, Identity,
  Authorization, Plugin과 media checksum을 비교한다.
- 이전 fixture upgrade와 migration 재실행이 멱등하다.
- Doctor가 정상/Schema drift/migration drift/plugin drift/storage failure를 구분한다.
- M0~M4-C5 package, PostgreSQL, HTTP와 Chromium 누적 Gate가 통과한다.

## 10. 구현 및 검증 결과

- `@xecms/cli` 0.4.0이 `xecms`와 `create-xecms` binary, 세 starter, Doctor,
  forward-only migration, Schema/type 명령과 backup/restore를 제공한다.
- CLI release tarball에는 실행용 `dist`와 manifest만 포함하며 test와 build metadata는 제외한다.
- 실제 PostgreSQL에서 이전 release fixture의 18개 core migration upgrade와 재실행 멱등성을
  검증했다.
- 별도 source/target DB와 media root를 사용해 Identity, Authorization, Schema, Document,
  Revision, Plugin, Media metadata와 file SHA-256가 보존되는 empty restore를 검증했다.
- `/api/live`, `/api/health`, `/api/ready`와 release/API version header를 PostgreSQL 및
  Chromium에서 검증했다.
- M1, M2+M3, M4-A, M4-B, M4-C1~C5를 독립 DB schema와 media root에서 실행하는 누적
  Chromium 11개 시나리오를 통과했다.
- 재현 명령은 `pnpm verify:m4c5`, 운영 절차는
  [XeCMS 0.4 운영 Runbook](./operations-runbook.md)을 따른다.

## 11. 제외

- hosted control plane, 자동 cloud provisioning
- online zero-downtime major migration orchestration
- PITR/WAL archive와 외부 object storage snapshot 구현
- downgrade와 서로 다른 Instance의 merge restore
- package registry publish 및 container registry push 자동화
