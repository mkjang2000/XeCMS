# M4-C3 Unified Audit & Retention 상세 사양

> 상태: 구현 완료 — TypeScript·PostgreSQL·HTTP·Admin Chromium Gate 통과 (2026-07-15)
> 상위 계획: [M4-C 구현 계획](./m4c-administration-productization-plan.md)
> 선행 조건: [M4-C2 Sites & System Settings](./m4c2-sites-system-settings.md) 완료

## 1. 목표와 경계

분리된 보안 Audit, Document event, Authorization Audit와 Worker delivery를 하나의 시간축에서
조회하고, 운영 데이터 정리를 preview와 CAS를 거쳐 안전하게 실행한다.

```text
Immutable source records
├── Security / Identity audit
├── Document lifecycle events
├── Authorization audit
└── Worker delivery failures
          ↓ normalize + redact
Unified Audit read model / NDJSON export

Retention policy revision
          ↓ preview snapshot
Retention plan (counts + cutoffs + expiry)
          ↓ reauth + CAS + exact-count transaction
Safe operational cleanup + Audit/Outbox
```

- 원본 Audit table을 하나로 합치거나 기존 source ID를 변경하지 않는다.
- 통합 Audit는 append-only 원본을 정규화하는 read model이며 규제용 WORM 저장소를 주장하지 않는다.
- secret, credential, token, password hash, 원문 API key와 session cookie는 조회·export에 반환하지 않는다.
- 자동 Document hard purge와 filesystem media 삭제는 C3에서 실행하지 않는다.

## 2. 통합 Audit 모델

```ts
type AuditCategory =
  | "security" | "identity" | "content" | "schema" | "authorization"
  | "settings" | "site" | "worker" | "media" | "retention";

interface UnifiedAuditEntry {
  id: string;                     // source:id
  source: "system" | "document" | "authorization" | "delivery";
  sourceId: string;
  category: AuditCategory;
  action: string;
  outcome: "succeeded" | "failed" | "denied" | "informational";
  workspaceId: string;
  realmId?: string;
  siteId?: string;
  actorIdentityId?: string;
  actorSubjectId?: string;
  actorLabel?: string;
  targetType: string;
  targetId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  requestId?: string;
  occurredAt: string;
}
```

- System Audit는 login, Identity, Realm, settings, Site와 retention 작업을 포함한다.
- Document event는 payload 전체 대신 lifecycle 변화와 collection/document/version 식별자만 노출한다.
- Authorization Audit는 before/after와 실제 authorization decision을 redaction 후 제공한다.
- Worker는 `dead` delivery를 실패 Audit로, 관리자 retry를 System Audit로 표시한다.
- Site는 source에 저장된 값이 우선이며 과거 값이 없으면 현재 Collection binding으로 보완한다.
- 같은 mutation의 Document event와 Outbox는 중복 표시하지 않는다.

## 3. 조회, Cursor와 Export

```text
GET /api/audit?category=&source=&action=&actorId=&targetId=&realmId=&siteId=
               &outcome=&from=&to=&cursor=&limit=
GET /api/audit/:entryId
GET /api/audit/export?...same filters...
```

- 기본 50개, 최대 200개 keyset pagination을 사용한다.
- 정렬은 `occurredAt DESC, source rank, sourceId DESC`로 결정론적이다.
- cursor는 마지막 정렬 key를 base64url JSON으로 인코딩하며 형식과 범위를 엄격히 검증한다.
- 기간 최대 범위는 UI 조회 366일, export 90일이며 export 최대 50,000건이다.
- export는 UTF-8 NDJSON이고 각 line은 API와 동일하게 redaction된 record다.
- 목록은 `audit.read`, export는 `audit.export`를 Workspace Resource에서 요구한다.

## 4. Redaction

다음 key는 대소문자와 separator 차이를 정규화한 뒤 모든 깊이에서 `"[REDACTED]"`로 바꾼다.

```text
password, passwordHash, secret, token, tokenHash, session, cookie,
authorization, apiKey, apiKeyHash, credential, privateKey, databaseUrl
```

- `before`, `after`, `metadata`, decision context와 Worker error detail 모두 같은 함수로 처리한다.
- username, public ID, API key prefix, error code와 Permission key는 허용한다.
- 문자열 값 안에서 secret을 추측해 부분 치환하지 않고 source writer가 secret을 기록하지 않는
  기존 계약을 테스트로 계속 강제한다.
- Worker error message는 500자로 제한하고 제어문자를 제거한다.

## 5. Retention 정책

Workspace당 한 record와 CAS revision을 둔다.

```ts
interface RetentionPolicy {
  workspaceId: string;
  auditDays: number | null;               // null = preserve, min 90
  dispatchedOutboxDays: number | null;    // min 7
  succeededDeliveryDays: number | null;   // min 7
  deadDeliveryDays: number | null;        // default null, min 30
  expiredSessionDays: number | null;      // min 1
  softDeletedDocumentDays: number | null; // report-only, default null
  revision: number;
  updatedAt: string;
  updatedBy: string;
}
```

기본값은 Audit 영구 보존, dispatched Outbox 30일, succeeded delivery 30일, dead delivery
영구 보존, 만료·폐기 session 7일, soft-deleted Document 영구 보존이다.

- 정책 변경은 `retention.update`, CAS, System session, CSRF와 현재 password 재인증을 요구한다.
- Audit 보존 기간은 System/Document/Authorization source에 같은 cutoff를 적용한다.
- soft-deleted Document 기간은 후보 수와 예상 payload byte만 계산한다. apply가 Document를
  자동 purge하지 않으며 기존 ID 재입력·relation policy를 요구하는 문서별 purge를 사용한다.
- Media는 DB metadata와 storage file consistency report만 제공하고 자동 삭제하지 않는다.

## 6. Preview와 Apply

```text
GET  /api/retention/policy
PATCH /api/retention/policy
POST /api/retention/preview
GET  /api/retention/plans/:planId
POST /api/retention/plans/:planId/apply
GET  /api/media/consistency
```

Preview는 policy revision, 고정된 기준 시각, 각 cutoff, 대상 row 수와 가능한 경우 byte 추정,
soft-delete/media report, 15분 만료 시각과 digest를 durable plan으로 저장한다.

Apply 조건:

1. `retention.apply`, System session, Origin/CSRF, 현재 password 재인증
2. plan 상태 `previewed`, 만료 전, 현재 policy revision 일치
3. transaction에서 같은 cutoff로 대상 집합을 다시 계산
4. preview count와 다르면 `RETENTION_PLAN_STALE 409`로 전체 rollback
5. 일치할 때만 receipt, succeeded/dead delivery, orphan dispatched Outbox, session,
   설정된 Audit source 순서로 삭제
6. plan `applied`, System Audit와 `retention.applied` Outbox를 같은 transaction에 기록

동일 plan 재실행은 이미 적용된 결과를 반환하며 다른 plan이 같은 row를 먼저 정리하면 stale로
거부한다. processing/pending delivery와 미분배 Outbox는 절대 삭제하지 않는다.

## 7. PostgreSQL Migration

`0017_m4c3_audit_retention`:

- `_xecms_retention_policies`
- `_xecms_retention_plans`
- Audit source의 keyset/filter index
- session revoked/expired, Outbox dispatched와 delivery completion cleanup index
- `audit.export`, `retention.read/update/preview/apply`, `media.consistency.read` Permission
- Owner/Admin 기본 Role upgrade

Migration은 기존 Workspace에 기본 정책 revision 1을 backfill하고 재실행해도 plan, policy revision과
Audit source를 변경하지 않는다.

## 8. Admin Studio

- `Operations / Overview`: 최근 보안 실패, dead delivery, Site/Worker 상태와 retention 요약
- `Operations / Audit`: 기간·category·actor·target·Realm·Site filter, 상세 before/after
- `Operations / Retention`: 정책 편집, preview 영향 표, password apply와 최근 plan
- `Operations / Media consistency`: metadata/file 불일치 보고서
- 권한 전용 Audit 화면은 유지하되 통합 Audit로 이동하는 link를 제공한다.

## 9. 완료 Gate

- 게시, Role 변경, Identity 정지, Site 변경, login 실패와 Worker dead를 한 cursor에서 조회한다.
- API와 NDJSON export에 fixture secret이 나타나지 않는다.
- 권한·Realm·Site filter가 다른 scope record를 섞지 않는다.
- preview/apply 사이 정책 변경과 대상 집합 변화가 전체 정리를 차단한다.
- pending/processing delivery, undispatched Outbox와 soft-deleted Document는 보존된다.
- apply 실패와 재실행에서 부분 삭제나 이중 완료가 없다.
- migration 재실행, PostgreSQL·HTTP·Admin Chromium Gate를 통과한다.

### 9.1 완료 검증 기록

- 전체 package boundary·문서 링크·TypeScript·Vitest: 59 files, 365 tests 통과
- 실제 PostgreSQL: migration 재실행, source 통합/cursor/redaction, retry Audit,
  stale rollback, exact-count apply, 멱등 재실행과 보호 대상 보존을 포함한 3 files,
  8 tests 통과
- HTTP: query 계약, NDJSON export, CSRF·재인증·CAS, preview/apply와 읽기 전용
  media consistency 1 acceptance test 통과
- Admin production build와 Chromium: 로그인부터 감사 filter, retention durable preview,
  정책 대화상자와 media consistency까지 1 journey 통과
- 개발 서버는 `0.4.0-m4c3`로 실행되며 `admin/admin` 점검 계정을 유지한다.

## 10. 제외

- 외부 SIEM 전송 Adapter와 WORM 저장소
- 자동 Document hard purge
- 자동 media file/metadata 삭제
- 법률 관할별 사전 정의 policy pack
- 여러 Workspace를 가로지르는 Instance-wide Audit
