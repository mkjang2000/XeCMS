# 핵심 개념

XeCMS의 데이터 모델과 권한 모델을 이해하면 API 응답과 권한 오류를 훨씬 쉽게 다룰 수
있습니다. 이 문서는 외부 연동에 필요한 개념을 중심으로 설명합니다.

## 전체 구조

```text
XeCMS Instance
└── Workspace                     조직 전체의 최상위 컨테이너
    ├── Sites                     콘텐츠를 노출하는 논리적 사이트
    ├── 운영자 공간 (System Realm)  CMS 운영 계정과 권한
    ├── 사용자 공간 (Content Realm) 서비스 회원 계정과 독립 권한
    └── Collections               콘텐츠 구조 정의
        └── Documents             실제 콘텐츠 (Revision / 계층 / Media)
```

## Workspace

하나의 XeCMS 인스턴스는 하나의 **Workspace**를 가집니다. 모든 계정, 사용자 공간,
Collection, 콘텐츠가 이 안에 속합니다. (여러 Workspace를 제공하는 SaaS
멀티테넌시는 현재 범위 밖입니다.)

## Collection과 Document

**Collection**은 콘텐츠의 구조(스키마)를 정의합니다. 세 가지 종류가 있습니다.

| kind | 설명 |
| --- | --- |
| `collection` | 여러 Document를 담는 일반 컬렉션 (예: 블로그 글) |
| `singleton` | 단 하나의 Document만 갖는 컬렉션 (예: 사이트 설정) |
| `hierarchy` | 트리 구조를 갖는 컬렉션 (예: 카테고리, 페이지 트리) |

**Document**는 Collection의 실제 데이터 항목입니다. 각 Document는 다음을 갖습니다.

- **Revision** — 모든 변경은 새 revision으로 기록되며 복원할 수 있습니다.
- **Publication** — Draft / Published 수명주기와 게시·게시 취소.
- **Soft delete** — 삭제는 즉시 소멸이 아니라 복원 가능한 상태이며, `purge`로 영구 삭제합니다.
- **Hierarchy** (hierarchy 컬렉션) — 부모/자식, 수동 정렬, 이동 검증.

Collection 구조는 [Schema](./schema.md)로 선언합니다.

## 사용자 공간 (Content Realm)과 운영자 공간 (System Realm)

XeCMS는 **누가 로그인하는가**에 따라 계정 영역을 분리합니다.

- **운영자 공간 (System Realm)** — Admin Studio에 로그인해 CMS를 관리하는 운영자 계정.
- **사용자 공간 (Content Realm)** — 여러분의 서비스에 가입·로그인하는 **회원 계정**.
  서비스마다 독립된 사용자 공간을 만들 수 있고, 각 공간은 자체 로그인·권한·프로필을 갖습니다.

계정(Global Identity)은 로그인 자격 증명을 여러 공간에서 공유할 수 있지만,
**소속(Membership)·역할(Role)·권한 범위(Scope)는 공간마다 독립적**입니다.
CMS 운영 계정이라는 이유만으로 사용자 공간의 권한이 자동 부여되지는 않습니다.

외부 애플리케이션에서 회원 로그인/가입을 구현하려면 사용자 공간 API를 사용합니다
([인증](./authentication.md) 참고).

## 권한 모델

XeCMS의 접근 판정은 **수직축(관리 서열)** 과 **수평축(역할 분리)** 을 함께 사용합니다.

### 권한 등급 (Authority Level)

관리 서열을 나타냅니다. 상위 등급은 하위 등급을 관리할 수 있습니다. 같은 등급에 속한
서로 다른 역할은 **수평 관계**로, 서로를 임의로 관리하지 못합니다. 예를 들어 콘텐츠
관리자와 보안 관리자를 같은 등급의 다른 역할로 두면 책임은 나누되 상호 간섭은 막을 수
있습니다.

### 역할 (Role)과 권한 연결 (Binding)

- **역할(Role)** — 권한(permission)의 묶음.
- **권한 연결(Binding)** — 역할을 특정 **권한 대상(Subject, 사용자·그룹)** 에게,
  특정 **적용 범위(Scope)** 로 연결합니다.

### 적용 범위 (Resource Scope)

권한이 미치는 범위입니다. Site 전체, 특정 Collection, 특정 Document 하위 트리,
심지어 필드 단위 읽기·쓰기까지 지정할 수 있습니다.

### 최종 판정

한 요청이 허용되려면 다음을 **모두** 통과해야 합니다.

1. 올바른 공간(Realm)에 속하는가
2. 필요한 권한을 주는 역할이 연결(Binding)되어 있는가
3. 대상 리소스가 그 역할의 적용 범위(Scope) 안에 있는가
4. 역할의 제약(Constraint: 기간·소유자·상태 등)을 만족하는가

판정 결과와 그 이유는 `POST /api/access/evaluate-batch`로 미리 확인할 수 있습니다
([REST API](./rest-api.md) 참고).

## API Key

외부 애플리케이션은 대개 **API Key**로 인증합니다. API Key는 서비스 계정에 발급되며,
그 계정의 역할 권한과 key에 지정된 scope의 **교집합**만큼만 허용됩니다. 자세한 내용은
[인증](./authentication.md)을 참고하세요.
