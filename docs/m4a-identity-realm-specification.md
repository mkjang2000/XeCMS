# M4-A Identity & Content Realm 사양

> 상태: 완료 (2026-07-15)  
> 상위 계획: [M4 구현 계획](./m4-implementation-plan.md)  
> 권한 기반: [M3 Authorization Platform](./m3-authorization-platform.md)

## 1. 목표

하나의 XeCMS Instance에서 CMS 운영 계정과 회원·고객·학생 같은 콘텐츠 계정을
함께 인증한다. 자격 증명은 Global Identity가 소유하고, 실제 활동 주체와 권한은
Realm Membership별 Subject로 분리한다.

```text
Global Identity
├── System Membership → CMS Operator Subject
├── Community Membership → Member Subject → members Document
└── Commerce Membership → Customer Subject → customers Document
```

Identity 공유는 authentication federation이다. System Role, Authority Level,
Binding 또는 Owner 상태를 Content Realm으로 자동 전파하는 authorization bridge가
아니다.

## 2. Schema 계약

일반 Collection에 `auth`를 활성화해 Content Realm의 Profile Collection으로 만든다.

```json
{
  "id": "col_community_members",
  "name": "members",
  "fields": [
    {
      "id": "fld_member_email",
      "name": "email",
      "type": "text",
      "required": true,
      "unique": true
    },
    {
      "id": "fld_member_name",
      "name": "displayName",
      "type": "text",
      "required": true
    }
  ],
  "auth": {
    "enabled": true,
    "realmKey": "community",
    "identifierFieldIds": ["fld_member_email"],
    "acceptSystemIdentities": true,
    "provisioning": "explicit",
    "defaultRoleIds": []
  }
}
```

규칙:

- `kind=singleton` Collection에는 auth를 활성화할 수 없다.
- Realm key는 Instance 안에서 유일한 소문자 slug다.
- 한 Content Realm에는 정확히 하나의 Profile Collection이 있다.
- identifier는 해당 Collection의 최상위 `text` Field여야 한다.
- identifier Field는 `required=true`, `unique=true`여야 한다.
- identifier는 NFKC 정규화와 Unicode-independent lowercase 후 비교한다.
- credential, password hash, session token은 Document Field에 저장하거나 API로
  노출하지 않는다.
- auth를 끄거나 Realm key/identifier를 변경하는 작업은 Identity/Membership이
  존재하면 별도 migration 없이는 거부한다.

Schema apply는 Realm configuration과 authorization Resource projection을 함께
동기화한다. 중간 실패 시 새 Schema revision만 활성화되거나 Realm만 바뀐 상태를
허용하지 않는다.

## 3. Identity와 Membership

### 3.1 Global Identity

기존 CMS `_xecms_identities` record를 Global Identity의 source of truth로 승격한다.
기존 Owner ID와 자격 증명은 바꾸지 않는다. Identity는 다음 정보를 소유한다.

- stable Identity ID
- 전역 정규화 identifier
- password hash와 이후 추가될 인증 수단
- credential origin Realm
- disabled/locked 상태

같은 identifier로 별도 Identity를 중복 생성하지 않는다. 기존 Identity가 있으면
로그인 후 Membership provisioning 또는 명시적 account linking을 사용한다.

### 3.2 Realm Membership

Membership은 다음 상태를 가진다.

```ts
interface RealmMembership {
  id: string;
  identityId: string;
  realmId: string;
  subjectId: string;
  profileDocumentId?: string;
  status: "pending" | "active" | "suspended";
  provisionedBy: "explicit" | "invitation" | "jit" | "account-link" | "signup";
}
```

- 한 Identity는 Realm마다 최대 하나의 Membership을 가진다.
- active Membership만 콘텐츠 세션을 만들 수 있다.
- suspended Membership은 기존 콘텐츠 세션도 즉시 무효화한다.
- Membership Subject는 같은 Realm의 M3 policy에만 속한다.
- Profile Document의 owner는 Membership Subject다.
- pending provisioning은 권한을 얻지 못하며 재시도 또는 정리 가능해야 한다.

기존 System Identity는 migration에서 System Membership과 identity-linked Subject로
연결한다. 이 작업으로 Content Membership을 만들지는 않는다.

## 4. 인증과 세션

System Admin 세션과 Content Realm 세션은 별도 cookie와 DB session kind를 사용한다.
따라서 같은 브라우저에서 Admin Studio와 콘텐츠 애플리케이션에 동시에 로그인할
수 있다.

- System: 기존 `xecms_session`
- Content: Realm이 기록된 `xecms_content_session`
- 모든 cookie는 HttpOnly, SameSite=Lax이며 production에서 Secure다.
- mutation은 session-bound CSRF와 Origin 검사를 통과해야 한다.
- 로그인 실패 응답은 Identity, Membership 또는 Realm 존재 여부를 구분하지 않는다.
- IP와 normalized identifier 조합으로 rate limit한다.
- 콘텐츠 세션에는 Identity ID, Realm ID, Membership ID와 Subject ID를 고정한다.
- Realm 경로와 session Realm이 다르면 `403 REALM_SESSION_MISMATCH`다.

### 4.1 가입

가입은 Profile data와 password를 받아 다음 durable workflow를 실행한다.

```text
Schema/Realm 확인
→ identifier와 Profile 검증
→ Identity + pending Membership + Profile Document 원자 저장
→ Realm Subject projection
→ Membership active 전환
→ Content session 발급
```

중간 실패한 pending Membership은 로그인할 수 없다. 동일 요청의 안전한 재시도와
startup recovery가 Subject projection을 수렴시킨다.

### 4.2 System Identity provisioning

- `explicit`: System 인증과 재인증 후 관리자가 Membership을 생성한다.
- `jit`: 첫 Content Realm 로그인 시 최소 Profile과 Membership을 생성한다.
- `defaultRoleIds`는 일반 콘텐츠 Identity와 동일하게 적용한다.
- 기본 Role이 비어 있으면 로그인은 가능하지만 보호 작업 권한은 없다.

Account linking은 양쪽 자격 증명 재확인 또는 보호된 관리자 작업을 요구하고 Audit에
남긴다. identifier가 같다는 이유만으로 자동 연결하지 않는다.

## 5. Realm Authorization

각 Content Realm은 독립된 M3 policy revision과 다음 graph를 갖는다.

```text
Realm root
├── Content root
│   ├── Collection
│   └── Document tree
├── Authorization
└── Audit
```

Collection/Document Resource ID는 Realm namespace를 포함한다. System Realm에서
사용하던 ID와 충돌하거나 grant가 교차 적용되면 안 된다. 콘텐츠 API는 session의
Membership Subject와 Realm policy로만 평가한다.

- Public Subject도 Realm마다 별개다.
- Role, Level, Group, Binding과 FieldAccess는 Realm FK로 격리한다.
- 다른 Realm의 Subject/Role/Resource 참조는 DB와 application에서 거부한다.
- simulator와 Audit도 선택한 Realm 안에서만 동작한다.
- System Owner라는 사실은 Content Realm 판정 입력이 아니다.

### 5.1 Realm Full Access

Full Access는 일반 Role wildcard가 아닌 별도의 보호된 Realm Binding이다.

- 기본 비활성
- 대상 Realm의 active Subject에게만 부여
- 대상 Realm Resource와 현재·미래 Permission에만 적용
- System Realm과 다른 Content Realm에는 적용하지 않음
- grant/revoke에는 System 보호 Permission, 재인증, reason이 필요
- 선택적인 `validUntil`
- grant, revoke와 실제 사용을 보안 Audit에 기록
- disabled/suspended Subject에는 적용하지 않음

일반 운영은 M3 Role Binding을 사용하고, Full Access는 초기 Realm 설정과 복구에만
사용한다.

## 6. HTTP 계약

Public/Content 인증:

```text
GET  /api/content-realms/:realmKey
POST /api/content-realms/:realmKey/signup
POST /api/content-realms/:realmKey/login
GET  /api/content-realms/:realmKey/session
POST /api/content-realms/:realmKey/logout
```

Content Realm API:

```text
GET/PATCH /api/content-realms/:realmKey/profile
GET       /api/content-realms/:realmKey/collections
GET/POST  /api/content-realms/:realmKey/collections/:collectionId/documents
GET/PATCH /api/content-realms/:realmKey/collections/:collectionId/documents/:documentId
```

System Admin API:

```text
GET  /api/identity-realms
GET  /api/identity-realms/:realmId
GET  /api/identity-realms/:realmId/memberships
POST /api/identity-realms/:realmId/memberships
PATCH /api/identity-realms/:realmId/memberships/:membershipId
POST /api/identity-realms/:realmId/full-access
DELETE /api/identity-realms/:realmId/full-access/:subjectId
```

Content Realm의 Role/Group/Binding API는 M3 contract를 Realm prefix 아래에서
재사용한다. 모든 mutation은 CSRF와 policy/membership revision CAS를 사용한다.

## 7. Admin과 사용자 경험

Admin Studio에 `Identity Realms` 영역을 추가한다.

- Realm 목록과 auth Collection 상태
- System Identity 허용, explicit/JIT와 기본 Role 설정
- Membership 목록, 상태와 Profile link
- 명시적 provisioning과 suspend/reactivate
- Realm Role/Group/Binding 관리로 이동
- Realm Full Access grant/revoke 확인 dialog
- provisioning/Audit 오류와 재시도 상태

Community acceptance 화면은 프레임워크 종속 starter가 아니라 XeCMS가 제공하는 최소
테스트 surface로 만든다. 가입, 로그인, Profile, 권한 없는 보호 작업 거부와 Role
부여 후 Scope 제한 성공을 Chromium에서 검증한다.

## 8. 보안과 일관성

- password는 현재 Scrypt 정책을 재사용하고 평문을 log/audit에 남기지 않는다.
- identifier 존재 여부, Membership 상태와 account linking 후보를 비인증 응답으로
  노출하지 않는다.
- 가입/Profile write는 Schema validation과 Field write policy를 우회하지 않는다.
- System/Content cookie confusion과 Realm path substitution을 회귀 테스트한다.
- provisioning과 policy projection은 다중 서버에서도 동일 advisory lock으로
  직렬화한다.
- active Membership인데 Subject/Resource projection이 없으면 fail-closed `503`이다.
- Profile purge, auth 비활성화와 Realm 제거는 Membership이 있으면 migration 없이는
  거부한다.
- session revoke, Membership suspend와 Identity disable은 다음 요청부터 반영된다.

## 9. 구현 순서

1. Schema auth 계약과 migration
2. Global Identity/Realm/Membership application 및 PostgreSQL store
3. 가입·로그인·세션과 provisioning recovery
4. Realm namespace Resource projection과 Content API gateway
5. Realm Role/Binding 관리 및 Full Access
6. Admin Identity Realms와 Community surface
7. unit, PostgreSQL, HTTP와 Chromium 전체 Gate

## 10. 완료 조건

- auth-enabled `members` Collection으로 가입·로그인·Profile 조회가 가능하다.
- System Identity가 explicit 및 JIT 정책에 따라 같은 자격 증명으로 로그인한다.
- Content Membership이 없는 System Identity는 Content Realm 권한을 얻지 못한다.
- Role을 부여한 Subject는 해당 Resource Scope 작업만 수행한다.
- 동일 Collection/Document에 대한 System/Content Realm grant가 서로 섞이지 않는다.
- Realm Full Access가 대상 Realm에서만 동작하고 사용 내역이 Audit에 남는다.
- suspend/disable/revoke가 기존 session에 즉시 적용된다.
- Schema/Realm provisioning 실패와 server restart 후 수렴 또는 fail-closed한다.
- Admin과 Community Chromium E2E에 page error와 예상 밖 5xx가 없다.

## 11. M4-A 제외

- MFA, passkey, OAuth/OIDC/SAML provider 제품화
- email verification과 password reset mail delivery
- 여러 Profile Collection을 합친 하나의 Realm
- anonymous guest Identity
- cross-Realm Role/Binding bridge
- untrusted authentication Plugin

확장 지점은 M4-C Plugin 계약에서 제공하되 M4-A 완료 기능으로 노출하지 않는다.

## 12. 완료 검증

M4-A는 다음 자동화 Gate를 통과한 상태로 완료 판정한다.

- `pnpm verify:m4a`: boundary/docs/typecheck/unit과 M4-A 실환경 Gate
- 실제 PostgreSQL: Schema auth 원자 materialization, Identity/Membership/Session,
  Realm policy, Scope Role, Full Access 사용 Audit, suspend와 재시작 복구
- 실제 HTTP: System/Content cookie·Origin·CSRF 분리, Realm 경로 격리와 rate limit
- Chromium: Admin Realm 상세·Realm 권한 편집과 Community 가입·프로필·권한 없는 상태,
  Collection Scope 부여 후 문서 생성·수정
- 브라우저 page error 0건, 예상 밖 5xx 0건

Content Realm 테스트 화면은 `/community/:realmKey`에서 제공한다. 이는 제품 starter가
아니라 M4-A의 인증 및 권한 계약을 직접 검증하기 위한 최소 surface다.
