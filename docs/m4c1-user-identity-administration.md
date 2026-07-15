# M4-C1 Users & Credentials 상세 사양

> 상태: 구현 및 검증 완료 (2026-07-15)
> 상위 계획: [M4-C 구현 계획](./m4c-administration-productization-plan.md)  
> 선행 조건: [M4-A Identity & Content Realm](./m4a-identity-realm-specification.md) 완료

## 1. 목표

운영자가 System Identity와 Content Realm Membership을 안전하게 조사·관리하고,
credential, session, 서비스 계정과 API key를 동일한 authorization kernel 아래에서
운영할 수 있게 한다.

```text
Global Identity
├── 사람 Identity
│   ├── System Membership → Admin sessions
│   └── Content Memberships → Content sessions
└── Service Identity
    └── System Subject → API keys
```

Identity를 비활성화하면 모든 Membership의 인증 주체가 즉시 무효가 된다. Membership
suspend는 대상 Realm에만 영향을 준다. Role과 Permission은 기존 M3 Binding에서만
얻으며 Identity 생성 자체로 권한을 부여하지 않는다.

## 2. Identity 계약

Identity 관리 record는 다음 정보를 제공한다.

```ts
interface ManagedIdentity {
  id: string;
  workspaceId: string;
  kind: "human" | "service";
  primaryIdentifier: string;
  originRealmId: string;
  isOwner: boolean;
  status: "active" | "disabled";
  credentialVersion: number;
  passwordChangeRequired: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
  memberships: MembershipSummary[];
}
```

- `primaryIdentifier`는 현재 username/email identifier 계약을 재사용한다.
- 사람 Identity만 password credential과 interactive session을 가질 수 있다.
- Service Identity는 password login과 Content signup 대상이 아니다.
- Identity 변경은 `expectedRevision` CAS를 요구한다.
- identifier 변경은 전역 normalized uniqueness를 유지하고 로그인 식별자도 함께 바꾼다.
- Identity disable은 `disabledAt`과 revision을 변경한다. session/API key row를 삭제하지
  않아도 resolver가 즉시 거부하지만, 운영 명확성을 위해 active credential을 함께 revoke한다.
- reactivate는 기존 Role/Membership을 자동 복원하지 않는다. Identity 자체만 활성화한다.

## 3. 생성과 초대

### 3.1 System 운영 Identity

관리자는 다음 두 방식 중 하나를 선택한다.

- `temporary-password`: 관리자가 임시 password를 지정하고 다음 로그인에서 변경을 강제
- `invitation`: password가 없는 pending Identity와 일회성 setup token 생성

Invitation token:

- 원문은 생성 응답에서 한 번만 반환한다.
- DB에는 SHA-256 digest만 저장한다.
- 기본 수명 24시간, 한 번 사용하면 재사용할 수 없다.
- 새 invitation을 만들면 이전 미사용 invitation을 revoke한다.
- Identity disable, credential reset 또는 Owner 변경 시 미사용 token을 revoke한다.
- token 조회 실패 응답은 존재·만료·사용 여부를 구분하지 않는다.
- 실제 email 전송은 M4-C4 mail Adapter 범위다.

개발 환경 UI는 token을 복사할 수 있지만 production은 명시적인 delivery Adapter 없이
원문을 다시 표시하지 않는다.

### 3.2 Content 사용자

Content 사용자의 Global Identity 생성은 기존 Realm signup/provisioning workflow를
재사용한다. Admin은 Identity 상세에서 다음 작업만 수행한다.

- Content Realm Membership 명시적 provisioning
- Membership suspend/reactivate
- Profile Document로 이동
- Realm Role/Group/Binding 화면으로 이동

Content Identity를 System 운영자로 승격하려면 System Membership과 Subject를 별도
보호 작업으로 생성해야 한다. 기존 Content Role은 전파하지 않는다.

## 4. Credential reset

- reset은 `identity.credentials.reset`과 현재 System Identity 재인증을 요구한다.
- temporary password 또는 일회성 reset token을 선택할 수 있다.
- 성공 시 `credentialVersion`을 증가시켜 기존 모든 interactive session을 무효화한다.
- 모든 미사용 invitation/reset token을 revoke한다.
- API key는 별도 credential이므로 기본적으로 유지한다. `revokeApiKeys=true`를 명시하면
  같은 transaction에서 모두 revoke한다.
- `passwordChangeRequired=true`인 사용자는 password 변경 외 Admin mutation을 할 수 없다.
- password history와 breached-password 외부 조회는 MVP에서 제외하지만 현재 password
  정책보다 약한 password는 허용하지 않는다.

## 5. Session 관리

Session은 원문 token이나 hash를 노출하지 않는 stable 관리 ID를 가진다.

```ts
interface ManagedSession {
  id: string;
  audience: "admin" | "content";
  identityId: string;
  realmId: string;
  membershipId: string;
  createdAt: string;
  authenticatedAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedByIdentityId?: string;
  revokeReason?: string;
  current: boolean;
}
```

- logout과 관리 revoke는 row를 즉시 삭제하지 않고 revoke metadata를 남긴다.
- resolver는 `revokedAt IS NULL`, expiry, Identity/Membership/Subject 상태와
  credentialVersion을 모두 확인한다.
- 사용자는 자신의 다른 session을 조회·revoke할 수 있다.
- `identity.session.revoke` 보유자는 관리 범위 안의 대상 session을 revoke할 수 있다.
- 현재 session revoke 응답이 commit된 뒤 다음 요청부터 `401`이다.
- Identity 전체 session revoke와 Realm Membership session revoke를 제공한다.

IP 원문과 전체 User-Agent는 MVP 영구 저장에서 제외한다. UI에는 audience, Realm,
생성·인증·만료·폐기 시각만 표시한다.

## 6. Owner 이전

MVP Workspace에는 정확히 하나의 Owner가 있다.

- 현재 Owner만 이전할 수 있다.
- 현재 Owner password 재인증을 요구한다.
- 대상은 active human Identity와 active System Membership을 가져야 한다.
- 하나의 transaction에서 기존 Owner를 해제하고 대상을 Owner로 지정한다.
- 기존 Owner의 일반 Role Binding은 변경하지 않는다.
- 모든 Admin session을 revoke하고 양쪽 Identity의 credentialVersion을 증가시킨다.
- Owner 이전은 reason을 요구하며 before/after와 함께 Audit/Event에 기록한다.
- Owner 삭제 기능은 제공하지 않는다. disable 전에 다른 Owner로 이전해야 한다.

## 7. Service Identity와 API key

Service Identity는 System Realm의 `service-account` Subject와 1:1이다.

- password, invitation, interactive session과 Content Membership을 가질 수 없다.
- 생성만으로 Permission을 얻지 않으며 M3 Role Binding을 별도로 부여한다.
- disable/reactivate와 revision CAS를 지원한다.

API key:

```ts
interface ApiKeyRecord {
  id: string;
  identityId: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}
```

- 원문 형식은 `xecms_<public-prefix>_<secret>`이며 생성 시 한 번만 반환한다.
- DB에는 key ID/prefix와 peppered SHA-256 digest만 저장한다.
- key scope는 M3 Permission key의 상한선이다. 실제 허용은
  `Role Binding 허용 ∩ API key scope`다.
- scope가 비어 있거나 대상 Service Subject가 권한을 잃으면 default deny다.
- expiry, Identity/Subject disabled와 revoke를 매 요청 확인한다.
- `Authorization: Bearer`를 지원하고 cookie/CSRF 인증과 한 요청에서 혼용하지 않는다.
- API key mutation은 `api-key.create`/`api-key.revoke`, 대상 관리 우선순위와 Audit을 요구한다.
- `lastUsedAt`은 요청마다 동기 write하지 않고 최소 5분 단위 best-effort 갱신한다.

API key로 다음 작업은 수행할 수 없다.

- Owner 이전
- credential reset과 invitation 생성
- 다른 API key 생성·폐기
- Realm Full Access grant/revoke
- bootstrap과 Plugin 설치/제거

## 8. HTTP 계약

System Admin Identity:

```text
GET    /api/identities
POST   /api/identities
GET    /api/identities/:identityId
PATCH  /api/identities/:identityId
POST   /api/identities/:identityId/disable
POST   /api/identities/:identityId/reactivate
POST   /api/identities/:identityId/credentials/reset
POST   /api/identities/:identityId/invitations
POST   /api/identities/:identityId/system-membership
POST   /api/owner/transfer
```

Session:

```text
GET    /api/identities/:identityId/sessions
DELETE /api/sessions/:sessionId
POST   /api/identities/:identityId/sessions/revoke
```

Service Identity와 API key:

```text
POST   /api/service-identities
GET    /api/service-identities/:identityId/api-keys
POST   /api/service-identities/:identityId/api-keys
DELETE /api/api-keys/:apiKeyId
```

Invitation/reset token 소비는 비인증 endpoint를 별도 rate limit한다.

```text
POST /api/credentials/setup
POST /api/credentials/reset/complete
POST /api/credentials/password
```

목록은 cursor, `query`, `kind`, `status`, `originRealmId`, `realmId` filter를 제공한다.
모든 Admin mutation은 Origin, session-bound CSRF, Permission과 필요한 경우 재인증을
통과한다.

## 9. Permission

기존 catalog의 다음 Permission을 실제 route에 연결한다.

```text
identity.read
identity.invite
identity.update
identity.disable
identity.credentials.reset
identity.session.revoke
api-key.create
api-key.revoke
```

다음을 추가한다.

```text
identity.owner.transfer
identity.system-membership.create
service-account.create
service-account.update
```

Owner는 recovery root지만 일반 운영자는 M3 level, target Subject와 delegatable
Permission 규칙으로 관리 가능 범위가 제한된다.

## 10. PostgreSQL migration

`0015_m4c1_users_credentials`에서 다음을 적용한다.

- `_xecms_identities`: `identity_kind`, `revision`, `password_change_required`,
  `updated_at`, `updated_by`, `locked_at`
- `_xecms_sessions`: `id`, revoke metadata와 관리 index
- `_xecms_credential_tokens`: invitation/reset digest, expiry, used/revoked metadata
- `_xecms_api_keys`: digest, prefix, scopes, expiry/use/revoke metadata
- Service Identity/System Subject/Membership FK 및 invariant
- Security Audit와 transactional outbox envelope

기존 Identity와 session은 `human`, revision 1과 stable session ID로 무손실 backfill한다.
Migration 재실행은 row ID, session, credentialVersion과 Owner를 바꾸지 않는다.

## 11. Admin Studio

`Users & Access` 아래에 다음 화면을 둔다.

- 사용자 목록: 검색, kind/status/origin/Realm filter와 Membership 요약
- 사용자 상세: Identity 상태, Membership, Role 이동, session, credential 작업
- 서비스 계정 상세: Subject/Role 이동과 API key lifecycle
- Owner 이전 dialog
- invitation/reset의 일회성 secret 표시 dialog

위험 작업은 대상 identifier, 영향 session/API key 수, Realm 영향과 재인증 입력을
확인 dialog에서 보여준다.

## 12. 구현 순서

### C1-A Identity administration

- [x] migration 기본 column과 Identity query/update
- [x] System Identity create/invite, disable/reactivate
- [x] Membership 종합 read model과 Owner 보호

### C1-B Credential & session

- [x] credential token과 password reset
- [x] session 관리 ID, 목록, 개별/전체 revoke
- [x] Owner 이전

### C1-C Service identity & API key

- [x] Service Subject provisioning
- [x] API key digest, lifecycle와 bearer authentication
- [x] M3 Permission과 scope 교집합

### C1-D Admin & acceptance

- [x] Users & Access UI
- [x] PostgreSQL, HTTP, Chromium과 재시작/upgrade Gate

## 13. 완료 조건

- Identity 검색·상세·생성·수정·disable/reactivate가 Realm 경계를 보존한다.
- invitation/reset token과 API key 원문은 한 번만 노출되고 DB/log/Audit에 없다.
- credential reset, Identity/Membership 정지와 session revoke가 즉시 인증을 무효화한다.
- Owner는 정확히 한 명이며 이전 실패가 Owner 없는 상태를 만들지 않는다.
- Service Identity는 interactive login할 수 없고 API key scope만으로 권한을 얻지 않는다.
- API key 인증이 M3 Role/Resource/Field 정책을 우회하지 않는다.
- Admin UI에서 사용자, Membership, session과 API key lifecycle을 완주한다.
- migration upgrade, 다중 요청 CAS, PostgreSQL·HTTP·Chromium Gate가 통과한다.

검증 결과:

- TypeScript project reference 및 Admin production build 통과
- Application/PostgreSQL C1 집중 검증 10개 통과
- 실제 PostgreSQL 기반 HTTP acceptance 통과
- Chromium Admin journey 통과: 사용자 생성·수정·정지·복구, token 1회 노출,
  credential reset, Owner 이전, 최초 비밀번호 변경, session 및 API key lifecycle
- API key의 Role∩scope, cookie 혼용 거부, Identity/Realm 관리 금지와 revoke 즉시 반영 확인

## 14. M4-C1 제외

- MFA, passkey와 외부 IdP
- 실제 mail/SMS delivery
- SCIM
- 조직도와 HR provisioning
- 사용자 정의 password policy UI
- 여러 Workspace 사이 Identity 이동
