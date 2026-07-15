# M4-C Administration, Plugin & Productization 구현 계획

> 상태: M4-C1·M4-C2·M4-C3·M4-C4 완료, 다음 M4-C5 (2026-07-15)
> 상위 계획: [M4 구현 계획](./m4-implementation-plan.md)  
> 선행 조건: [M4-B Hook, Event & Worker](./m4b-event-worker-specification.md) 완료

## 1. 목표

M4-C는 Plugin API만 만드는 단계가 아니다. 현재 완성된 콘텐츠·권한·Identity·Worker
코어를 실제로 설치하고 장기간 운영할 수 있는 CMS 제품으로 닫는 단계다.

누락된 여섯 운영 영역을 다음 다섯 개의 순차 묶음으로 구현한다.

| 운영 영역 | 배치 |
| --- | --- |
| User & Identity Administration | M4-C1 |
| API Key & Session Management | M4-C1 |
| System/Workspace/Site Settings | M4-C2 |
| Unified Audit & Retention | M4-C3 |
| Plugin Platform | M4-C4 |
| Operations, Recovery & Productization | M4-C5 |

```text
M4-C1 Users & Credentials
→ M4-C2 Sites & System Settings
→ M4-C3 Audit & Lifecycle
→ M4-C4 Plugin Platform
→ M4-C5 Operations & Distribution
```

## 2. 공통 원칙

- System Realm과 Content Realm의 Identity, Membership, Subject를 한 계정처럼 섞지 않는다.
- Admin UI, REST client, CLI와 Plugin은 같은 Application Service와 권한 판정을 사용한다.
- secret, password hash, session token과 API key 원문은 일반 조회·Audit·Event에 넣지 않는다.
- 보호 작업은 재인증, 명시적인 Permission, CAS 또는 동등한 동시성 제어와 Audit을 요구한다.
- 운영 정리 작업은 preview 없는 destructive mutation을 제공하지 않는다.
- DB 설정과 배포 환경 설정을 구분한다. Admin Studio가 환경 변수와 secret을 임의로
  덮어쓰지 않는다.
- 각 묶음은 미완성 메뉴나 동작하지 않는 버튼을 다음 묶음의 완료 기능처럼 노출하지 않는다.

## 3. M4-C1 — Users & Credentials

> 완료: TypeScript·PostgreSQL·HTTP·Admin Chromium Gate 통과

### 3.1 목표

System 운영자와 Content Realm 사용자를 하나의 Admin 진입점에서 찾되, 실제 변경은
각 Identity와 Realm 경계를 보존하며 수행한다. 사용자 상태 변경이 session, API key와
권한 판정에 즉시 반영되어야 한다.

### 3.2 포함 범위

- Global Identity 검색, cursor pagination과 상세 조회
- identifier, origin Realm, 생성 시각, disabled/locked 상태 표시
- System 운영 Identity 생성 또는 초대 준비
- Identity 표시 정보 수정과 disable/reactivate
- Content Realm Membership 전체 조회, 명시적 생성, suspend/reactivate
- Identity별 System/Content Membership, Subject, Group, Role Binding 요약
- 안전한 credential reset과 다음 로그인 시 변경 요구
- System/Content session 목록과 개별·전체 revoke
- Owner 이전과 마지막 Owner 보호
- 서비스 계정 lifecycle
- scope, 만료 시각과 마지막 사용 시각을 가진 API key 생성·조회·폐기
- API key 원문은 생성 직후 한 번만 반환하고 digest만 저장
- 관련 Permission, Audit, Durable Event와 Admin UI

### 3.3 의도적 제외

- MFA, passkey, OAuth/OIDC/SAML 제품화
- email/SMS 실제 전송 Adapter
- 사용자가 직접 수행하는 이메일 기반 비밀번호 찾기
- 자동 Identity merge

초대와 reset은 전달 가능한 일회성 token 계약을 제공하되 실제 mail delivery는 M4-C4
Adapter로 연결한다. 로컬 개발에서는 명시적인 개발 전달 방식만 허용한다.

### 3.4 완료 Gate

- disable, Membership suspend, session revoke와 API key revoke가 다음 요청부터 적용된다.
- 마지막 Owner 제거와 권한 없는 credential reset이 fail-closed한다.
- API key 평문이 DB, 로그, Audit, Event와 재조회 응답에 남지 않는다.
- System Identity 관리가 Content Realm Role을 자동 부여하지 않는다.
- PostgreSQL·HTTP·Admin Chromium에서 생성, 검색, 정지, 복구, session/API key 폐기를 완주한다.

## 4. M4-C2 — Sites & System Settings

> 완료: TypeScript·PostgreSQL·HTTP·Admin Chromium Gate 통과
>
> 상세 계약: [M4-C2 Sites & System Settings 상세 사양](./m4c2-sites-system-settings.md)

### 4.1 목표

콘텐츠 Singleton과 플랫폼 설정을 혼동하지 않고 Instance, Workspace와 Site 운영 경계를
명시적으로 관리한다.

### 4.2 포함 범위

- 읽기 전용 Instance 정보와 단일 Workspace 설정
- Workspace 표시 이름, 기본 timezone과 Admin 표시 locale
- Site 생성, 수정, archive/reactivate와 기본 Site 지정
- Site별 key, 이름, canonical URL과 상태
- Site Resource를 M3 권한 tree에 원자 projection
- Collection/Document를 Site scope에 연결하는 최소 계약
- 운영 환경의 Admin Schema 편집 잠금과 Manifest-only mode
- storage, Worker, origin, upload limit 같은 환경 기반 설정의 masked/read-only 진단
- 설정 변경 revision, CAS, 재인증·Permission·Audit
- Settings와 Sites Admin 화면

### 4.3 경계

- MVP는 Workspace 하나만 생성한다.
- locale별 독립 콘텐츠 게시와 domain routing 자동화는 제외한다.
- secret과 DB 연결 정보는 Admin에서 변경하지 않는다.
- 일반 사이트 콘텐츠 설정은 여전히 Singleton Collection으로 관리한다.

### 4.4 완료 Gate

- Site scope Role이 다른 Site에 전파되지 않는다.
- archived Site의 신규 콘텐츠 작업 정책이 fail-closed한다.
- Schema lock이 UI뿐 아니라 REST/Local API에서도 우회되지 않는다.
- 설정 CAS 충돌과 권한 상승 회귀를 PostgreSQL·HTTP·Chromium으로 검증한다.

## 5. M4-C3 — Audit & Lifecycle

> 완료: TypeScript·PostgreSQL·HTTP·Admin Chromium Gate 통과
>
> 상세 계약: [M4-C3 Unified Audit & Retention 상세 사양](./m4c3-audit-retention.md)

### 5.1 목표

분리된 Document event, 보안 Audit, Authorization Audit와 Worker 상태를 운영자가 한
시간축에서 조사하고, 보존·정리 작업을 안전하게 실행할 수 있게 한다.

### 5.2 포함 범위

- 정규화된 통합 Audit read model
- content, schema, identity, session, API key, authorization, Full Access, settings,
  plugin, job 범주
- actor, Realm, Site, target, action, decision, request ID와 기간 filter
- cursor pagination, 상세 before/after와 원본 source reference
- Audit export의 권한 및 민감 필드 redaction
- Audit, Outbox, succeeded/dead delivery, expired session과 soft-deleted content 보존 정책
- 정리 preview, 예상 row/byte 영향과 명시적 apply
- Media consistency report 및 고아 metadata/file 정리 경계
- retention 실행도 Event와 Audit에 기록
- Overview 운영 요약과 통합 Audit/Retention Admin 화면

### 5.3 경계

- MVP Audit는 append-only application record이며 외부 규제용 WORM 저장소를 주장하지 않는다.
- 자동 hard purge는 기본 비활성이다.
- dead delivery는 명시적 보존 정책과 preview 없이 삭제하지 않는다.

### 5.4 완료 Gate

- 게시, Role 변경, Identity 정지, Full Access 사용과 Worker 실패를 한 UI에서 추적한다.
- redaction 이전의 secret이 Audit/Event/export에 존재하지 않는다.
- retention preview와 apply 사이의 revision 충돌이 destructive 실행을 차단한다.
- 보존 작업 실패 후 재실행이 멱등하고 부분 삭제를 완료 처리하지 않는다.

## 6. M4-C4 — Plugin Platform

> 완료: TypeScript·PostgreSQL·HTTP·Admin Chromium Gate 통과
>
> 상세 계약: [M4-C4 Trusted Plugin Platform 상세 사양](./m4c4-plugin-platform.md)

### 6.1 포함 범위

- trusted npm Plugin과 필수 Manifest
- core/Admin SDK 호환 범위와 dependency graph 검사
- server extension entry와 Admin extension entry
- namespaced Field, form widget, Permission, Route, Hook, Event Handler와 UI slot
- Plugin migration registry와 순서 보장
- 설치, 활성화, 설정, 비활성화, 제거 lifecycle
- disable/uninstall 전 Schema, data, migration과 dependent Plugin 검사
- 잔존 데이터 preserve/export/purge 선택
- Plugin 관리 API와 Admin 화면
- 최소 Field 또는 Admin slot 예제 Plugin

### 6.2 경계

- Plugin은 신뢰된 코드이며 설치·상태 변경 후 재시작을 요구한다.
- hot reload, marketplace, 자동 서명·심사와 process sandbox는 제외한다.
- Plugin이 core table을 임의로 소유한 것으로 간주하지 않는다.

### 6.3 완료 Gate

- 호환되지 않거나 namespace를 침범한 Plugin 설치가 startup 전에 거부된다.
- migration 실패가 활성 상태로 기록되지 않는다.
- 사용 중인 Field/data/dependency가 있는 destructive uninstall이 차단된다.
- 예제 Plugin을 설치한 뒤 실제 Admin/HTTP 흐름에서 확장 기능을 사용한다.

## 7. M4-C5 — Operations & Distribution

### 7.1 포함 범위

- `create-xecms` 또는 동등한 project scaffold
- `xecms init`, `dev`, `schema`, `migrate`, `generate types`, `doctor`
- runtime, DB, migration, plugin, schema drift, storage 권한과 Worker 진단
- backup manifest, PostgreSQL dump와 media archive 절차
- 빈 Instance restore와 무결성 확인
- 이전 release fixture에서 현재 release로 upgrade 재현
- 실패한 migration/restore의 복구 경계와 runbook
- minimal, blog, community starter
- Public API, Plugin API와 migration version policy
- 구조화 로그, health/readiness와 기본 운영 문서
- 설치부터 전체 MVP 최종 사용자 시나리오까지 누적 E2E

### 7.2 완료 Gate

- 빈 디렉터리에서 scaffold, 설치, bootstrap과 첫 게시를 문서 명령만으로 완주한다.
- backup을 별도 빈 Instance에 restore하고 Schema, content, Identity, media와 권한을 검증한다.
- 이전 fixture upgrade가 멱등하며 downgrade를 지원하지 않는 경계를 명시한다.
- 세 starter가 CI에서 생성·build·실행된다.
- M0부터 M4-C5까지 누적 PostgreSQL·HTTP·Chromium Gate를 통과한다.

## 8. 구현 순서와 병렬화 경계

공식 완료 순서는 C1부터 C5까지다. 다음 작업은 독립적으로 준비할 수 있지만 선행 묶음의
데이터 계약이 확정되기 전 제품 API로 고정하지 않는다.

- C1 API key digest utility와 C2 settings UI shell
- C2 Site projection과 C3 Audit read-model query prototype
- C3 retention preview engine과 C4 Manifest parser
- C4 example Plugin과 C5 starter template

각 묶음의 실제 구현 순서는 다음으로 통일한다.

```text
상세 사양과 위협 모델
→ Application contract
→ PostgreSQL migration/store
→ REST contract/client
→ Admin UI
→ Unit/PostgreSQL/HTTP/Chromium
→ 운영 문서와 완료 판정
```

## 9. 다음 작업

다음 구현 대상은 M4-C4 Plugin Platform이다. C3에서 닫은 Audit·Outbox·보존 경계를
Plugin lifecycle과 migration에도 그대로 적용하면서 Manifest, extension entry,
호환성 검증과 예제 Plugin의 상세 계약부터 확정한다.
