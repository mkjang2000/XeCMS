# XeCMS v0.4.0 MVP 코드 점검 후 수정/검증 요청서

대상 저장소: `mkjang2000/XeCMS`  
기준 버전: MVP 완료 직후 `0.4.0` 프리릴리스  
목적: 현재 구현을 무조건 수정하지 말고, 아래 지적사항이 실제로 유효한지 먼저 재현·검증한 뒤 필요한 항목만 수정한다.

---

## 작업 원칙

1. 아래 항목을 그대로 믿고 바로 고치지 말 것.
2. 각 항목마다 먼저 현재 코드와 테스트를 확인하고 실제 문제가 있는지 판정할 것.
3. 실제 문제라면 최소 재현 테스트를 먼저 추가하거나 기존 테스트를 확장할 것.
4. 수정 후 관련 Unit / PostgreSQL integration / HTTP / Chromium / release gate를 가능한 범위에서 재실행할 것.
5. 이미 다른 경로에서 방어되고 있어 문제가 아닌 경우, 왜 문제가 아닌지 근거를 남길 것.
6. 기존 권한 불변조건, 트랜잭션 경계, fail-closed 정책, audit/outbox 원자성을 약화시키지 말 것.
7. 과도한 리팩터링은 피하고, 현재 아키텍처와 public contract를 최대한 보존할 것.

---

# P0 / 우선 확인 권장

## 1. Backup Restore 실패 후 최종 Media Root 잔존 가능성

관련 파일:

`packages/cli/src/backup.ts`

현재 restore 흐름은 대략 다음과 같다.

```text
checksum/format 검증
→ target DB schema가 비어 있는지 확인
→ media directory가 비어 있는지 확인
→ pg_restore
→ media archive를 staging에 압축 해제
→ 기존 mediaRoot 삭제
→ staging을 mediaRoot로 rename
→ migration integrity 검사
```

잠재 문제:

`rename(staging, mediaRoot)`까지 성공한 뒤 이후 integrity 검사에서 실패하면 catch 경로에서 staging은 이미 존재하지 않고, 최종 `mediaRoot`는 남을 가능성이 있다.

현재 catch는 대략:

```text
staging 삭제
DB schema 삭제
throw
```

이므로 다음 시나리오가 가능한지 검증할 것.

```text
1차 restore
→ DB restore 성공
→ media promotion 성공
→ 마지막 integrity check 실패
→ DB schema rollback cleanup
→ mediaRoot는 남음

2차 restore 재시도
→ target media directory not empty
→ 재시도 실패
```

### 검증 요청

- 실제로 이 문제가 재현되는지 확인.
- 재현되면 integration test 추가.
- 이번 restore가 생성한 최종 mediaRoot를 실패 시 안전하게 정리하도록 수정.
- 기존 사용자 파일을 잘못 삭제하지 않도록 반드시 “이번 restore가 만든 mediaRoot인지” 추적할 것.
- DB schema cleanup과 media cleanup이 함께 재시도 가능한 상태를 만들도록 할 것.

권장 테스트 예:

```text
- empty target에서 restore 시작
- DB와 media promotion 이후 강제 integrity failure 유도
- 실패 후 target schema 없음 확인
- 실패 후 target mediaRoot 비어 있음 또는 없음 확인
- 같은 backup으로 즉시 재시도 가능 확인
```

---

## 2. Retention Preview가 Exact Candidate Set이 아니라 Count만 비교하는 문제

관련 파일:

`packages/application/src/retention.ts`  
`packages/database/src/postgres-retention.ts`

현재 preview는 candidate count를 저장하고 apply 시 다시 count를 측정해 다음과 같이 stale 여부를 판단하는 것으로 보인다.

```ts
if (!sameCounts(current.counts, plan.counts)) {
  throw RETENTION_PLAN_STALE;
}
```

잠재 문제:

후보 집합이 바뀌었지만 개수만 같으면 preview에서 보지 못한 새 대상이 삭제될 수 있다.

예:

```text
Preview 당시:
A, B, C = 3건

Apply 직전:
A는 사라짐
D가 새 후보가 됨

현재:
B, C, D = 3건
```

count는 동일하지만 candidate set은 달라졌다.

### 검증 요청

- 실제 데이터 모델에서 이런 후보 교체가 가능한지 확인.
- 가능한 경우 exact candidate identity를 검증하도록 강화.
- 전체 candidate row를 plan에 저장할 필요는 없으며, 각 category별 정렬된 stable identifier 집합의 deterministic hash를 저장하는 방식을 우선 검토.
- apply 직전 같은 방식으로 다시 hash를 계산해 exact match가 아니면 fail-closed.
- count와 hash를 둘 다 유지해 운영 UI에는 기존 count/estimated bytes를 계속 제공.

주의:

- candidate ID는 각 source에서 안정적이어야 한다.
- system audit / document event / authorization audit / outbox / delivery / session 등 category별 ID 충돌을 피할 것.
- digest 계산이 DB row order에 영향받지 않도록 반드시 정렬 후 계산.
- preview/apply 사이 동일 candidate set이면 순서 차이 때문에 stale 처리되지 않아야 한다.

권장 테스트 예:

```text
- preview 생성
- 기존 후보 1건 제거
- 다른 후보 1건 삽입
- 총 count는 동일하게 유지
- apply 시 RETENTION_PLAN_STALE 발생 확인
- 어떤 candidate도 삭제되지 않았는지 확인
```

---

# P1 / MVP 안정화 시 권장

## 3. `verify:m4c5`가 모든 PostgreSQL 조건부 테스트를 실제 누적 실행하는지 확인

관련 파일:

`package.json`  
`scripts/run-m4c5-e2e.mjs`

현재 루트 script는 대략:

```text
verify:m4c5
→ pnpm check
→ pnpm test:e2e:m4c5
```

`pnpm check`의 일반 Vitest에서는 환경 의존 PostgreSQL test가 skip될 수 있고, `run-m4c5-e2e.mjs`는 특정 integration test 파일만 직접 실행한 뒤 milestone별 Chromium journey를 수행한다.

확인할 사항:

- `pnpm verify:m4c5` 한 번으로 현재 저장소의 모든 PostgreSQL integration suite가 실제로 실행되는가?
- 아니면 C1~C4의 일부 PostgreSQL test는 milestone별 gate에서만 실행되고 최종 C5 gate에서는 생략되는가?

### 권장 방향

정말 최종 release gate가 “전체 PostgreSQL 회귀 테스트 포함”을 의미한다면 다음 중 하나를 검토.

```text
pnpm test:postgres:all
```

또는 동일 역할의 script를 추가해:

```text
XECMS_RUN_POSTGRES_TESTS=true
→ 모든 PostgreSQL 조건부 test 실행
```

후 `verify:m4c5`에 포함.

주의:

- 테스트 시간이 지나치게 길어진다면 fast/full gate를 분리해도 됨.
- 문서에서 주장하는 release gate와 실제 실행 경로가 일치하도록 할 것.
- 이미 현재 구조가 충분히 누적 검증을 보장한다면, 그 근거를 문서화하고 변경하지 않아도 됨.

---

## 4. Backup Manifest 경로 검증 강화

관련 파일:

`packages/cli/src/backup.ts`

현재 restore는 manifest의:

```text
database.file
media.file
```

을 사용해 source directory 아래 경로를 resolve한다.

공식 생성 backup은 고정 파일명:

```text
database.dump
media.tar.gz
```

을 사용하지만, 수정된 manifest가 들어오면 경로 이탈 가능성이 없는지 확인할 것.

### 검토 권장

가장 단순하고 안전한 정책:

```text
manifest.database.file === "database.dump"
manifest.media.file === "media.tar.gz"
```

가 아니면 거부.

또는 basename/containment 검증을 명시적으로 수행.

목적은 외부에서 수정된 backup manifest를 적대적 입력으로 보더라도 project/source root 밖 파일을 읽지 않게 하는 것.

---

## 5. TAR Archive의 Symlink / Hardlink 우회 가능성 확인

관련 파일:

`packages/cli/src/backup.ts`

현재 media archive는 `tar -tzf` 결과의 entry path를 검사해:

- absolute path
- `..`

를 차단한다.

이것만으로 symlink 또는 hardlink target이 archive root 밖을 가리키는 경우까지 확실히 차단되는지 검증할 것.

### 검증 요청

- 악성 archive에 symlink 또는 hardlink entry를 넣었을 때 현재 restore가 외부 경로를 덮어쓸 수 있는지 확인.
- 안전하지 않다면 archive type 및 link target까지 검사하거나, 안전한 extraction 전략을 적용.
- 공식 backup만 복원한다고 가정하지 말고 restore 입력을 적대적 artifact로 취급.

---

## 6. Backup Version Compatibility 검증

현재 backup manifest에 XeCMS version이 포함되지만, restore 시 실제 release compatibility를 얼마나 검사하는지 확인.

검토할 항목:

- 미래 버전 backup을 과거 버전 XeCMS가 복원하려 할 때 거부해야 하는가?
- 같은 formatVersion이라도 incompatible release line이 존재할 수 있는가?
- restore 직후 migration으로 흡수할 수 있는 범위와 거부해야 하는 범위를 명확히 할 것.

지금 즉시 복잡한 compatibility matrix를 만들 필요는 없지만, 최소한 unsupported future backup에 대해 fail-closed하는 정책을 검토.

---

# P2 / 대규모 데이터 테스트 전후 집중 점검

## 7. Hierarchy Mutation의 전체 Snapshot / Closure Rebuild 병목

관련 파일:

`packages/database/src/postgres-hierarchy.ts`

현재 hierarchy mutation은 대략:

```text
collection 전체 hierarchy node 로드
→ 전체 snapshot 생성
→ mutation 계산
→ 결과 전체 node UPSERT
→ closure table 전체 삭제
→ recursive CTE로 closure 전체 재생성
```

이 방식은 정확성과 단순성 면에서는 좋지만, 노드 수가 커지면 하나의 move/reorder도 전체 collection 크기에 비례해 비용이 증가한다.

### 대량 데이터 테스트 권장

각 규모별로 측정:

```text
100 nodes
1,000 nodes
5,000 nodes
10,000 nodes
가능하면 50,000 nodes
```

시나리오:

```text
- leaf move
- root move
- 깊은 subtree move
- sibling reorder
- root list
- children list
- ancestors
- descendants
- full tree
```

측정값:

```text
- DB query time
- transaction time
- lock wait
- row count
- closure row count
- memory usage
```

### 향후 최적화 후보

문제가 실제로 나타날 때만 검토:

- affected subtree/path만 closure 갱신
- changed node만 update
- bulk multi-row upsert
- full rebuild는 recovery/reconciliation 용도로 제한

지금 즉시 성급하게 최적화하지 말고 실제 benchmark 결과를 기준으로 판단.

---

## 8. Unified Audit 대용량 조회 성능

관련 파일:

`packages/database/src/postgres-unified-audit.ts`

현재 여러 source를 `UNION ALL`로 통합해 read model을 만든다.

대규모 데이터에서 확인할 것:

```text
- system audit
- document events
- authorization audit
- dead deliveries
```

각 source가 수십만~수백만 건 이상일 때:

- filter pushdown
- source별 index 사용
- cursor pagination
- ORDER BY
- actor / target / realm / site / time range filter

에 대한 실제 `EXPLAIN ANALYZE` 측정.

필요 시에만 별도 materialized read model 또는 dedicated audit table 검토.

---

## 9. Plugin Export의 메모리/트랜잭션 폭증 가능성

관련 파일:

`packages/database/src/postgres-plugins.ts`

현재 uninstall `export` 경로는 plugin data table마다:

```sql
SELECT * FROM plugin_table
```

후 모든 row를 JS object에 모으고 전체 JSON을 DB JSONB artifact로 저장한다.

대형 Plugin data에서는:

- Node heap 급증
- 긴 transaction
- 거대한 JSONB row
- export 실패 시 긴 rollback

가능성이 있다.

### 검증 요청

적어도 다음 규모에서 메모리와 시간을 측정:

```text
10k rows
100k rows
가능하면 1M rows
```

장기적으로 필요하면:

```text
streaming export
→ 파일/Object Storage artifact
→ DB에는 manifest/hash/metadata만 저장
```

방식 검토.

MVP에서는 현 구조 유지 가능하나, 위험 한계점을 문서화하면 좋음.

---

## 10. Plugin Schema Usage 탐지 방식의 오탐/누락 가능성

관련 파일:

`packages/database/src/postgres-plugins.ts`

현재 Plugin field 사용 여부를 찾을 때 schema JSON text에 대해 대략:

```sql
schema_json::text LIKE '%field.id%'
```

형태를 사용하는 것으로 보인다.

확인할 것:

- 다른 문자열 안에 우연히 같은 field ID가 들어가 false positive가 발생할 수 있는가?
- escaping/JSON formatting 차이로 false negative가 가능한가?
- schema 구조를 정식으로 탐색하는 helper가 이미 있다면 그 경로를 재사용하는 편이 더 안전한가?

실제로 오탐/누락이 가능한 경우 exact schema traversal 방식으로 교체 검토.

---

# P3 / 보안·운영 품질 개선 후보

## 11. Plugin / Audit Metadata의 민감정보 Redaction 계약 강화

현재 Audit redaction은 재귀적이며 잘 되어 있지만 기본적으로 민감한 key 이름을 기반으로 한다.

예:

```text
password
token
secret
apiKey
privateKey
databaseUrl
...
```

Plugin이 임의 key 이름으로 credential-like 값을 넣으면 자동 redaction되지 않을 수 있다.

예:

```json
{
  "mySuperSensitiveCredentialValue": "secret"
}
```

### 장기 개선 후보

Plugin SDK 또는 Audit API에 다음 중 하나 검토:

- sensitive field 명시
- redacted metadata builder
- secret wrapper type
- plugin audit payload schema에서 민감값 금지

즉 redaction을 key heuristic에만 의존하지 않도록 확장 가능성을 고려.

---

## 12. Development Seed + Non-loopback Bind 방어

관련 파일:

`apps/server/src/config.ts`

현재 안전장치:

- `XECMS_DEV_SEED`는 development에서만 허용
- production session secret 최소 길이 강제
- production 기본 schema mode locked
- 기본 host는 `127.0.0.1`

하지만 사용자가 다음처럼 직접 설정하면:

```text
NODE_ENV=development
XECMS_DEV_SEED=true
XECMS_HOST=0.0.0.0
```

개발용 `admin/admin` 계정이 네트워크에 노출될 수 있다.

### 검토 권장

다음 중 하나:

- startup hard fail
- 매우 강한 warning
- loopback이 아닌 경우 dev seed 기본 계정 사용 금지

공유 개발 환경에서 실수 방지 목적.

---

# 추가 권장 테스트 매트릭스

MVP 이후 실사용/더미데이터 단계에서 다음을 한 번에 검증하면 좋다.

## 콘텐츠 규모

```text
Documents: 1k / 10k / 100k
Revisions per document: 1 / 10 / 100
Media: 1k / 10k / 100k metadata
Relations: sparse / dense
Hierarchy: 100 / 1k / 5k / 10k nodes
Audit: 100k / 1M+
```

## 동시성

```text
- 동일 document 동시 edit
- hierarchy move 동시 실행
- role/binding 동시 mutation
- retention preview 후 concurrent data change
- plugin plan preview 후 dependency/schema 변화
- same plugin plan concurrent apply
- same retention plan concurrent apply
```

## 실패 주입

```text
- migration 중 실패
- plugin migration 중 실패
- pg_restore 후 media promotion 전 실패
- media promotion 후 integrity check 실패
- outbox insert 직전/직후 실패
- worker lease 중 process 종료
- backup 생성 중 disk full
- restore 중 tar 실패
```

---

# 완료 기준

각 항목에 대해 아래 중 하나로 명확히 결론을 남길 것.

```text
VALID BUG
- 재현됨
- 테스트 추가
- 수정 완료
- 회귀 통과

NOT A BUG
- 현재 다른 방어 경로로 안전함
- 근거 코드/테스트 명시

DEFERRED
- 실제 문제 가능성은 있으나 MVP에서 즉시 수정 불필요
- 위험 조건과 임계점 문서화
- 후속 milestone 제안
```

최종적으로 다음을 요약할 것.

1. 실제로 발견된 버그
2. 수정된 파일
3. 추가된 테스트
4. 남겨둔 성능 리스크
5. `pnpm check`
6. 관련 PostgreSQL integration
7. 관련 HTTP/Chromium
8. 가능하면 `pnpm verify:m4c5` 결과

---

# 현재 우선순위 제안

가장 먼저 확인:

```text
1. Restore 실패 후 mediaRoot 잔존
2. Retention exact candidate set 검증
```

그다음:

```text
3. Final release gate의 PostgreSQL 전체 누적 실행 여부
4. Backup manifest path / tar symlink-hardlink 방어
5. Plugin schema usage 탐지 정확성
```

대량 더미데이터 단계:

```text
6. Hierarchy mutation scaling
7. Unified Audit scaling
8. Plugin export scaling
```

이 요청서의 목적은 무조건 수정하는 것이 아니라, 현재 XeCMS 0.4.0 MVP 구현을 실제 코드·테스트·재현을 기준으로 다시 검증하고, 유효한 문제만 최소 변경으로 고치는 것이다.
