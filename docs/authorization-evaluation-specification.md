# XeCMS Authorization Evaluation 사양

> 단계: M0 — Domain Prototype  
> 상태: 구현 기준  
> 관련 패키지: `@xecms/authorization`

## 1. 목적

Authority Level, 동일레벨 Role, Resource Scope, Permission 및 Delegation을 하나의 설명 가능한 판정기로 결합한다. M0 판정기는 DB, HTTP, UI 및 실제 인증에 의존하지 않는다.

## 2. 핵심 요소

```text
Subject
+ Role Binding
+ Role
+ Authority Level
+ Permission
+ Resource Scope
+ Delegation Policy
= Access Decision
```

Role inheritance와 explicit Deny는 M0에서 지원하지 않는다.

## 3. Permission

일반 Role에는 Permission Catalog에 등록된 정확한 key만 저장한다. 미래 Permission까지 자동 획득하는 wildcard는 M4 `Realm Full Access`에만 예약한다.

Permission Definition은 다음 metadata를 가진다.

- hierarchy guard
- delegatable 여부
- protected 여부

미등록 Permission을 포함한 Policy는 snapshot 생성 시 거부한다.

## 4. Authority Level과 Role

- Authority Level rank는 Realm 안에서 고유하다.
- 높은 Level은 관리 서열이며 기능 Permission의 상위 집합을 의미하지 않는다.
- 같은 Level의 여러 Role은 서로 동급이다.
- 관리 작업은 `actor grant rank > target rank`일 때만 가능성이 있다.
- 같은 Level Role과 Subject는 서로 관리할 수 없다.

## 5. Scope

```text
self
children
self-and-children
```

`children`은 직계 자식만이 아니라 모든 엄격한 후손을 의미한다.

일반 Permission 판정은 Scope가 요청 Resource에 적용되는지 확인한다. Role Binding 관리 작업은 Actor Scope가 Target Scope 집합 전체를 포함하는지 확인한다.

예를 들어 Site `self` 권한으로 Site `self-and-children` Binding을 만들 수 없다.

## 6. Policy Snapshot

외부 입력은 검증된 immutable policy snapshot으로 변환한 후 평가한다.

검증 범위:

- 객체 ID uniqueness
- Realm root
- Resource parent와 cycle
- Cross-Realm reference
- Realm 내 Authority Level rank uniqueness
- Role의 Level reference
- Role Permission 등록 여부
- `delegatablePermissions ⊆ permissions`
- protected/non-delegatable Permission 위임 금지
- Binding의 Subject, Role, Resource reference
- Binding 유효 기간

## 7. 일반 Permission 판정

```text
1. Permission 등록 확인
2. Actor와 Resource 존재 확인
3. Realm 일치 확인
4. Actor Binding 조회
5. Binding 유효 기간 확인
6. Scope 적용 확인
7. Role Permission 확인
8. Permission Grant 생성
9. 하나 이상의 Grant가 있으면 Allow
10. 없으면 Default Deny
```

일반 기능 Permission은 여러 Role에서 합산할 수 있다.

## 8. 관리 Permission 판정

관리 작업은 여러 Grant의 일부 조건을 합성하지 않는다.

> 하나의 Permission Grant가 action, rank, scope 및 delegation을 모두 단독으로 만족해야 한다.

```text
Grant.action includes requested action
AND Grant.scope contains complete target scope
AND Grant.rank > protected target rank
AND same source Role delegates all affected permissions
AND affected permissions are delegatable
AND same Realm
AND target is not protected
AND operation is not self escalation
```

다음 합성은 금지한다.

```text
Role A: Level 80 + content delegation, role.assign 없음
Role B: Level 20 + role.assign, delegation 없음

A의 Level/Delegation + B의 role.assign → 거부
```

## 9. Mutation별 보호

### Role Create

- 새 Role Level은 Actor Grant보다 낮아야 한다.
- 새 Permission과 delegation 전체가 Actor Grant 하나의 위임 범위 안에 있어야 한다.

### Role Update

- 기존/새 Level 중 높은 rank를 target으로 평가한다.
- 기존/새 Permission과 delegation의 영향을 모두 평가한다.
- Role을 먼저 낮춘 뒤 수정하는 downgrade 우회를 방지한다.

### Role Delete

- 기존 Level과 전체 Permission을 target으로 평가한다.

### Binding Create/Update

- 할당 Role의 Level과 Permission을 평가한다.
- Actor Scope가 새 Target Scope 전체를 포함해야 한다.
- Update는 기존/새 Role의 높은 Level과 Scope 영향을 모두 평가한다.
- 자기 Binding 생성 또는 확대를 거부한다.

### Subject Action

- 특정 Scope 작업은 해당 Scope에서 Subject의 최고 적용 Level을 사용한다.
- Realm 전체 비활성화는 Realm 전체에서 Subject가 가진 최고 Level을 사용한다.

## 10. Access Decision

Decision은 boolean만 반환하지 않는다.

```ts
interface AccessDecision {
  allowed: boolean;
  action: PermissionKey;
  reasonCode: string;
  matchedGrants: readonly PermissionGrant[];
  evaluatedScope: Scope;
  actorLevel?: number;
  targetLevel?: number;
}
```

Permission Grant에는 source Role, Level, rank, Binding, Scope 및 membership path가 포함된다.

## 11. 주요 거부 이유

```text
UNKNOWN_PERMISSION
REALM_MISMATCH
NO_PERMISSION
SCOPE_MISMATCH
TARGET_NOT_LOWER
DELEGATION_NOT_ALLOWED
NON_DELEGATABLE_PERMISSION
PROTECTED_TARGET
SELF_BINDING_MUTATION
INACTIVE_BINDING
NO_SINGLE_GRANT_SATISFIES_MANAGEMENT
INVALID_POLICY_GRAPH
```

## 12. M0 완료 검증

- 일반 Permission 합산
- same/children/self-and-children Scope
- 형제 Scope 격리
- 같은 Level 관리 거부
- 낮은 Level의 상위 대상 관리 거부
- action/rank/delegation 교차 Role 합성 거부
- 전체 Target Role Permission의 원자적 delegation
- protected/non-delegatable Permission 보호
- 자기 Binding 승격 거부
- expired/not-yet-active Binding 제외
- Cross-Realm 거부
- Resource cycle과 잘못된 Policy reference 거부
- Role create/update/delete 판정
- Binding create/update/remove 판정
- Subject 및 Realm 범위 관리 판정
- 결과의 Grant Provenance와 reason code

