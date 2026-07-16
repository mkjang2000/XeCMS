# XeCMS MVP P0~P2 점검 결과

기준 문서: [MVP 코드 점검 요청서](./XeCMS_MVP_post_review_for_Codex.md)  
점검일: 2026-07-16  
대상: XeCMS 0.4.0 MVP

## 결과 요약

| 번호 | 판정 | 결과 |
| --- | --- | --- |
| P0-1 | VALID BUG · FIXED | restore media promotion 뒤 integrity 실패 시 최종 media root까지 롤백 |
| P0-2 | VALID BUG · FIXED | count 외에 정렬된 category별 candidate ID 집합 SHA-256 검증 |
| P1-3 | VALID GAP · FIXED | 최종 C5 gate가 PostgreSQL 조건부 test 전체를 자동 탐색·직렬 실행 |
| P1-4 | VALID SECURITY GAP · FIXED | manifest artifact 파일명을 공식 고정 이름으로 제한 |
| P1-5 | VALID SECURITY GAP · FIXED | TAR symlink, hardlink와 일반 파일/디렉터리 외 entry 거부 |
| P1-6 | VALID COMPATIBILITY GAP · FIXED | 같은 0.4 release line의 현재 patch 이하만 복원 |
| P2-7 | VALID PERFORMANCE LIMIT · MITIGATED / DEFERRED | changed-node bulk UPSERT 적용, full closure rebuild는 후속 최적화 |
| P2-8 | VALID PERFORMANCE LIMIT · DEFERRED | 200k 통합 행에서 약 1초, dedicated read model 검토 필요 |
| P2-9 | VALID MEMORY RISK · MITIGATED | export JSONB를 DB에서 직접 조립해 Node heap 선형 증가 제거 |
| P2-10 | VALID BUG · FIXED | schema JSON 문자열 LIKE를 exact field-tree traversal로 교체 |

## P0

### 1. Restore 실패 후 media root 잔존

무결성 검사를 실패시키는 backup을 실제 PostgreSQL source/target DB로 복원했을 때 문제가
재현됐다. media promotion 여부를 추적하고 이번 restore가 promotion한 root만 catch에서
삭제하도록 변경했다. 실패 후 schema와 media root가 모두 없고 같은 backup으로 즉시
재시도할 수 있음을 통합 테스트로 확인했다.

### 2. Retention exact candidate set

preview 후 expired session 한 건을 삭제하고 다른 expired session을 넣어 count를 동일하게
유지하면 기존 구현이 plan을 적용하고 새 후보를 삭제했다. category 이름과 정렬된 stable ID
배열의 SHA-256을 plan digest에 포함하도록 변경했다. count가 같아도 후보가 치환되면
`RETENTION_PLAN_STALE`로 전체 transaction을 중단한다.

## P1

### 3. 전체 PostgreSQL gate

기존 C5 runner는 21개 조건부 PostgreSQL test 파일 중 CLI operations와 readiness 두 파일만
직접 실행했다. `pnpm test:postgres:all`을 추가해 source에서 조건부 파일을 자동 탐색하고
DB 부하 및 fixture 간섭을 피하도록 직렬 실행한다. 이 gate가 오래된 M3 identity fixture와
pre-0003 upgrade fixture를 실제로 발견했으며 둘 다 현재 identity/migration 모델에 맞게
수정했다.

### 4~6. Backup 적대적 입력과 호환성

- `database.dump`, `media.tar.gz` 외 manifest artifact 경로는 거부한다.
- manifest JSON과 필수 필드, SHA-256 형식을 런타임 검증한다.
- TAR listing의 entry path와 type을 모두 검사하고 일반 파일/디렉터리만 허용한다.
- format 1 restore는 같은 `0.4.x`의 현재 patch 이하만 허용한다.
- path 이탈, symlink, hardlink, 미래 version 입력이 DB 접속 전에 거부되는 unit test를 추가했다.

## P2 측정과 조치

측정은 별도 PostgreSQL 18 tmpfs container에서 실행했다. 재현 명령은 다음과 같다.

```bash
XECMS_TEST_DATABASE_URL=postgresql://xecms:xecms@127.0.0.1:54320/xecms \
  pnpm test:p2:benchmarks
```

환경별 절대 시간보다 크기 증가 추세와 plan 형태를 우선 판단해야 한다.

### 7. Hierarchy

| node | closure row | leaf move | root descendants | full list |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 316 | 43ms | 4ms | 2ms |
| 1,000 | 4,330 | 983ms | 74ms | 7ms |
| 5,000 | 24,648 | 1.76s | 57ms | 23ms |
| 10,000 | 54,648 | 4.21s | 6.45s | 42ms |

모든 node를 한 건씩 UPSERT하던 경로를 변경 node의 단일 bulk UPSERT로 교체했다. 다만
closure 전체 delete/rebuild와 recursive descendants는 여전히 scale limit이다. 정확성과
transaction 경계를 유지하기 위해 이번 점검에서는 incremental closure 알고리즘으로
교체하지 않고 후속 작업으로 남긴다.

### 8. Unified Audit

| source별 행 | 통합 행 | first page | cursor page | EXPLAIN execution |
| ---: | ---: | ---: | ---: | ---: |
| 10,000 | 40,000 | 209ms | 192ms | 207ms |
| 50,000 | 200,000 | 906ms | 978ms | 1.03s |

200,000 통합 행 plan에서 Seq Scan 11개와 최종 sort가 확인됐다. 현재 index는 source별 조회에는
유효하지만 계산된 workspace/filter와 전체 UNION 정렬을 충분히 줄이지 못한다. 일반 MVP
규모에서는 유지하되, 수십만 건부터 source별 top-N pushdown 또는 dedicated append-only audit
read model을 설계한다.

### 9. Plugin Export

기존 방식은 100,000행에서 Node heap이 약 33MB 증가했다. PostgreSQL이 각 data table을
`jsonb_agg(to_jsonb(...))`로 artifact에 직접 삽입하도록 변경한 뒤 결과는 다음과 같다.

| 행 | export | JSONB artifact | Node heap delta |
| ---: | ---: | ---: | ---: |
| 10,000 | 69ms | 0.42MB | 0.22MB |
| 100,000 | 606ms | 4.18MB | 0.19MB |

Node heap 선형 증가는 제거됐지만 거대한 JSONB 한 행과 긴 DB transaction이라는 한계는 남는다.
1M 이상 또는 큰 payload Plugin은 streaming file/Object Storage export로 전환해야 한다.

### 10. Plugin Field 사용 탐지

schema label에 Plugin Field ID가 들어가기만 해도 disable이 막히는 false positive를 재현했다.
active/draft schema의 collections/components와 중첩 object/array field tree만 순회해 정확히
`field.type`이 일치할 때만 blocker를 생성한다. 문자열 포함 오탐과 실제 type 사용 탐지를
한 테스트에서 함께 검증했다.

## 검증 명령

```bash
pnpm typecheck
pnpm test
pnpm test:postgres:all
pnpm test:p2:benchmarks
```

최종 실행 결과:

- `pnpm check`: 62 files passed, 378 tests passed, 환경 의존 75 tests skipped
- `pnpm test:postgres:all`: 21 files passed, 79 tests passed
- P2 benchmark: 3 scenarios passed
- `pnpm verify:m4c5`: build, Admin production bundle, CLI package, 전체 PostgreSQL gate와
  M1~M4-C5 Chromium 누적 journey 통과
