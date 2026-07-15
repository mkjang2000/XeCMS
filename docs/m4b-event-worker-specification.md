# M4-B Hook, Event & Worker 사양

> 상태: 구현 및 검증 완료 (2026-07-15)  
> 상위 계획: [M4 구현 계획](./m4-implementation-plan.md)  
> 선행 조건: [M4-A Identity & Content Realm](./m4a-identity-realm-specification.md) 완료

## 1. 목표

동기 Hook과 commit 이후 비동기 Event를 명확히 분리하고, PostgreSQL transactional
outbox와 lease 기반 Worker로 이벤트 유실 없이 확장 작업을 실행한다.

```text
HTTP/Application command
→ synchronous lifecycle hooks
→ aggregate + audit event + outbox를 한 transaction으로 commit
→ delivery fan-out
→ lease claim
→ handler
→ success 또는 retry/dead
```

M4-B의 전달 보장은 at-least-once다. 코어가 exactly-once를 주장하지 않으며, 안정적인
idempotency key와 예제 Handler의 원자적 중복 제거로 동일한 최종 효과를 만든다.

## 2. 동기 Lifecycle Hook

Hook은 신뢰된 서버 확장 코드이며 같은 요청 흐름에서 순서대로 실행한다.

- `beforeValidate`: 입력 정규화 전, 요청 거부 가능
- `afterValidate`: Schema validation 이후의 immutable data 확인
- `beforeCreate`
- `beforeUpdate`
- `beforeDelete`

등록 계약:

- Hook ID는 전역에서 유일하다.
- 낮은 priority가 먼저 실행되고 같은 priority는 등록 순서를 따른다.
- Hook이 실패하면 command를 commit하지 않는다.
- Hook context는 workspace, realm, actor, collection, document, operation과 data를 포함한다.
- Hook에서 외부 시스템에 durable side effect를 만드는 사용법은 금지한다. commit 이후
  작업은 Event Handler를 사용한다.
- `afterCommit`이라는 동기 Hook은 제공하지 않는다. process crash와 응답 실패 때문에
  신뢰할 수 없기 때문이다.

M4-C Plugin registry는 이 계약에 Hook을 등록하되 M4-B 코어를 수정하지 않는다.

## 3. Durable Event Envelope

```ts
interface DurableEventV1 {
  specVersion: "1.0";
  id: string;
  topic: string;
  workspaceId: string;
  realmId?: string;
  aggregate: {
    type: "document" | "identity" | "realm" | "authorization" | "media";
    id: string;
    version?: number;
  };
  actor: { subjectId?: string; identityId?: string };
  occurredAt: string;
  payload: Record<string, unknown>;
}
```

- Event ID는 source transaction에서 한 번 정해지고 재시도 중 바뀌지 않는다.
- topic은 소문자 점 표기법을 사용한다.
- credential, session token, CSRF token과 password는 payload에 넣지 않는다.
- Document event payload는 Handler가 projection을 만들 수 있도록 revision data를 포함할
  수 있지만 일반 보안 Audit payload와는 별도로 저장한다.
- Document source transaction은 `document.created`, `document.draft-created`,
  `document.revision-restored`, `document.published`, `document.unpublished`,
  `document.archived`, `document.unarchived`, `document.deleted`,
  `document.restored`, `document.purged`를 그대로 발행한다. Identity/Realm 보안 이벤트와
  Authorization 변경도 각각 `identity.*`, `realm.*`, `authorization.*`,
  `role.binding.changed` envelope로 같은 Outbox에 저장한다.

## 4. Transactional Outbox

Source aggregate 변경, 기존 audit event와 `_xecms_outbox_events` insert는 같은 DB
transaction에 속한다. commit된 aggregate에 outbox가 없거나 rollback된 aggregate에
outbox만 남는 상태를 허용하지 않는다.

Outbox는 원본 Event를 한 번 저장한다. Handler별 실행 상태는
`_xecms_event_deliveries`로 fan-out한다.

```text
outbox event 1
├── handler search-index → delivery A
├── handler webhook-x    → delivery B
└── handler analytics    → delivery C
```

Handler가 나중에 등록되더라도 retention 안의 미분배 Event를 fan-out할 수 있다.
동일 `(eventId, handlerId)` delivery는 unique constraint로 한 번만 생성된다.

## 5. Worker와 Lease

Delivery 상태:

```text
pending → processing → succeeded
                    ├→ pending (retry)
                    └→ dead
dead → pending (관리자 수동 재시도)
```

- Worker는 `FOR UPDATE SKIP LOCKED`로 batch를 claim한다.
- claim 시 `lockedBy`, `lockedUntil`, attempt를 원자 갱신한다.
- processing lease가 만료되면 다른 Worker가 회수한다.
- 성공/실패 반영은 현재 lease owner만 할 수 있다.
- 기본 lease 30초, batch 20개, 최대 8 attempts다.
- retry delay는 `min(1초 × 2^(attempt-1), 5분)`이다.
- process 종료 시 lease를 억지로 성공 처리하지 않는다. 만료 후 회수한다.
- 등록되지 않은 Handler의 Event는 outbox에 보존하되 delivery를 만들지 않는다.

## 6. Idempotency

각 delivery는 다음 key를 Handler에 전달한다.

```text
xecms:event:<eventId>:handler:<handlerId>
```

Handler는 effect 저장과 key 기록을 하나의 transaction으로 처리해야 한다. 동일 key가
이미 성공했다면 같은 결과로 반환한다. 외부 Webhook 수신자에는 이 값을
`Idempotency-Key`로 전달한다.

M4-B 예제 `core.search-projection` Handler는 Document Event를
`_xecms_example_search_index`에 upsert하며 처리 key를 함께 기록한다. 같은 delivery를
lease 만료 후 다시 실행해도 projection은 한 번의 최종 상태만 가진다.

## 7. HTTP와 Admin

System Admin API:

```text
GET  /api/jobs
GET  /api/jobs/:deliveryId
POST /api/jobs/:deliveryId/retry
POST /api/jobs/run
```

- 조회에는 `job.read`, 재시도와 수동 cycle에는 `job.retry`가 필요하다.
- page, status, topic, handlerId filter를 제공한다.
- 오류 message는 비밀 값을 제거하고 길이를 제한한다.
- retry는 `dead` 또는 `pending` 상태만 허용하며 processing lease를 탈취하지 않는다.
- 모든 mutation은 Admin Origin, session-bound CSRF와 Audit을 적용한다.

Admin `이벤트 작업` 화면은 상태 요약, topic/handler/status, attempts, 다음 실행 시각,
lease, 마지막 오류와 수동 재시도를 표시한다.

## 8. Worker Runtime

Server process는 기본적으로 내장 Worker polling을 시작한다. 다음 설정을 제공한다.

- `XECMS_WORKER_ENABLED` (`true`)
- `XECMS_WORKER_POLL_MS` (`1000`)
- `XECMS_WORKER_BATCH_SIZE` (`20`)
- `XECMS_WORKER_LEASE_MS` (`30000`)
- `XECMS_WORKER_MAX_ATTEMPTS` (`8`)

여러 Server가 동시에 실행돼도 delivery lease로 중복 동시 실행을 방지한다. 테스트와
운영 복구를 위해 한 cycle을 실행하는 API를 제공하되 polling과 같은 코드를 사용한다.

## 9. 실패와 보존

- Handler 오류는 원본 Event와 aggregate commit을 되돌리지 않는다.
- 오류는 구조화된 `code`, 안전한 message와 발생 시각만 delivery에 기록한다.
- dead delivery는 자동 삭제하지 않는다.
- succeeded delivery와 dispatched outbox 정리는 M4-C 운영 retention 명령에서 다룬다.
- DB 연결 실패 중에는 Worker가 다음 poll에서 재시도하며 HTTP server 생명주기와
  process crash를 유발하지 않는다.

## 10. 완료 조건

- [x] Hook 순서, validation 전후 data와 실패 시 commit 차단을 Unit test로 검증했다.
- [x] Document transaction과 outbox의 commit/rollback 원자성을 실제 PostgreSQL로 검증했다.
- [x] 두 Worker의 동시 claim이 같은 delivery를 동시에 실행하지 않는다.
- [x] lease 만료 회수, exponential retry, dead 전환과 수동 retry가 동작한다.
- [x] stable idempotency key로 예제 Search projection의 중복 효과가 없다.
- [x] 새 Worker가 만료된 processing lease를 회수하고 pending delivery가 수렴한다.
- [x] Realm, Identity와 Role Binding event도 같은 outbox envelope로 관측된다.
- [x] Admin API와 UI에서 상태·attempt·payload를 확인하고 retry 가능 상태를 초기화할 수 있다.
- [x] PostgreSQL·HTTP·Chromium Gate에 예상 밖 5xx와 page error가 없다.

### 10.1 검증 결과

2026-07-15 기준 다음 누적 Gate를 통과했다.

```bash
pnpm check
# Test Files 54 passed | 6 skipped
# Tests 351 passed | 49 skipped

pnpm test:e2e:m4b
# M4-B PostgreSQL/HTTP 6 passed
# Chromium 1 passed
```

M4-B 전용 PostgreSQL Gate에는 migration 재실행, 동시 claim, lease 회수,
idempotent projection, Realm/Identity/Role Binding envelope, CSRF, 수동 실행·재시도와
강제 Outbox 실패 시 전체 rollback이 포함된다. Chromium Gate는 Admin 로그인부터
문서 생성, 빈 작업 목록, Worker cycle, delivery 상세 payload와 필터까지 완주한다.

## 11. 제외

- cron/scheduled workflow designer
- arbitrary user JavaScript Handler
- Kafka/SQS 같은 외부 broker adapter 제품화
- distributed workflow/Saga orchestration UI
- exactly-once 외부 side effect 보장
- Event schema registry의 독립 제품화
