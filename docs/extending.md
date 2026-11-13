# 확장 개발

기본 엔진과 CMS Studio에는 업무 화면 빌더가 포함되지 않습니다. 필요한 기능만 명시적으로 연결합니다.

- **Plugin** — 서버 라우트·문서 훅·마이그레이션·Admin 카드를 추가하는 trusted 확장.
- **선택 서버 확장** — 독립 UI와 서버 기능을 함께 등록하는 trusted 패키지. 업무 화면 빌더가 이 경계를 사용합니다.
- **외부 애플리케이션** — ERP 등 자체 UI/업무 흐름을 공개 REST API/SDK로 구현합니다.

## 패키지 등록

기존 Plugin SDK 패키지는 설치 후 `xecms.config.json`의 `plugins` 배열에 등록합니다.
이 목록이 Admin Studio의 Plugin catalog를 구성하며, 예제 Plugin은 자동 포함되지 않습니다.

```json
{
  "extensions": [],
  "plugins": ["@acme/xecms-my-plugin"]
}
```

서버 확장은 `extensions` 배열에 등록합니다. 직접 서버를 조립할 때는
`buildServer({ extensions, plugins })`로 주입할 수 있습니다. 기본값은 두 목록 모두 빈 배열입니다.
선택 모듈은 신뢰하는 서버 코드로 실행되며 sandbox가 아닙니다.
자세한 배포 설정은 [빌드 및 배포](./deployment.md)를 참고하세요.

### 선택 서버 확장 계약

`@xecms/server`의 `ServerExtension`을 구현하는 패키지를 default export합니다.
예를 들어 다음 확장은 기존 인증 context를 사용하는 API를 제공합니다.

```ts
import type { ServerExtension } from "@xecms/server";

export default {
  id: "erp",
  name: "회사 ERP",
  register({ app, requireActor }) {
    app.get("/api/erp/workspace", async (request) => {
      const actor = await requireActor(request, false);
      return { workspaceId: actor.workspaceId };
    });
  },
} satisfies ServerExtension;
```

Host context는 인증·재인증, System/Content Realm audience, 활성 Schema, 권한 service,
권한을 적용하는 콘텐츠 작업과 DB adapter를 제공합니다. 쓰기 API는 CSRF와 작업별 권한을
검사해야 합니다. DB adapter 접근과 `register`는 신뢰하는 서버 코드용이며 권한 sandbox가 아닙니다.

별도 UI가 있으면 `admin`에 `distDirectory`, `assetPrefix`, `spaRoutes`, `href`, `label`을
선언합니다. assetPrefix는 `/extensions/<id>/` 아래여야 하며 설정한 빌드 파일이 없으면 시작이 실패합니다.
API·기본 인증 화면 등 예약된 경로는 SPA 경로로 사용할 수 없습니다.
엔진 관리 UI는 `/api/extensions`의 공개 메뉴 정보만 읽고 확장의 UI 번들을 import하지 않습니다.

이 계약은 서버 시작 시 설정하는 선택 기능입니다. 등록 변경 후 재시작하며, 아래 Plugin 관리 화면의
DB 기반 설치/활성화/migration lifecycle과는 별개입니다. API만 필요한 확장은 `admin`을 생략합니다.

## Plugin

Plugin은 `@xecms/plugin-sdk`의 `definePlugin`으로 정의하는 하나의 모듈입니다. Manifest,
서버 확장, Admin 확장으로 구성됩니다.

```bash
pnpm add @xecms/plugin-sdk@^2.0.0
```

SDK npm 패키지 2.x는 XeCMS core/admin 0.6.x를 대상으로 한다. 기존 0.5.x 프로젝트는
SDK 1.x를 유지한다. npm 패키지 버전과 manifest의 SDK 계약 버전은 별개이므로
`manifestVersion: 1`과 `compatibility.sdk: "1.x"`는 변경하지 않는다.
이 문서의 0.6 릴리스 패키지는 아직 배포 준비 중이다.

### 기본 구조

```ts
import { definePlugin } from "@xecms/plugin-sdk";

export default definePlugin({
  manifest: {
    manifestVersion: 1,
    id: "my-plugin",
    packageName: "@acme/xecms-my-plugin",
    version: "1.0.0",
    displayName: "My Plugin",
    description: "예시 플러그인",
    compatibility: {
      core: ">=0.6.0 <0.7.0",
      admin: ">=0.6.0 <0.7.0",
      sdk: "1.x",
    },
  },
  server: {
    // migrations, routes, hooks, eventHandlers, health
  },
  admin: {
    // cards
  },
});
```

`compatibility` 범위는 설치 시점의 core/admin/sdk 버전과 대조되어, 호환되지 않으면
설치가 거부됩니다.

### 서버 확장

| 필드 | 설명 |
| --- | --- |
| `migrations` | Plugin 전용 DB 마이그레이션 (`id`, `checksum`) |
| `routes` | HTTP 라우트 (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`) |
| `hooks` | 문서 수명주기 훅 |
| `eventHandlers` | durable 이벤트 핸들러 |
| `health` | Plugin 자체 헬스 체크 |

**문서 훅** 단계: `beforeValidate`, `afterValidate`, `beforeCreate`, `beforeUpdate`,
`beforeDelete`.

```ts
server: {
  hooks: [
    {
      collection: "posts",
      stage: "beforeCreate",
      handler: async (ctx) => {
        // ctx.document.data 를 검사·변형
      },
    },
  ],
}
```

### Admin 확장

Admin Studio의 지정된 슬롯에 카드를 추가합니다.

슬롯: `dashboard.main`, `operations.overview`, `settings.after`.

```ts
admin: {
  cards: [
    { slot: "dashboard.main", title: "내 지표", /* ... */ },
  ],
}
```

### 설치와 수명주기

Plugin은 Admin Studio의 `플러그인` 화면에서 설치·설정·활성화·비활성화합니다. 설치 시
Manifest 호환성 검사와 Plugin 마이그레이션이 실행됩니다. 현재는 **trusted** Plugin만
지원하며, untrusted 샌드박스·마켓플레이스·핫 리로드는 범위 밖입니다.

## Custom Admin App

Custom Admin App은 [업무 화면 빌더 선택 확장](https://github.com/mkjang2000/XeCMS-Plugin-AppBuilder)이 제공하는 기능입니다.
엔진만 배포하면 관련 메뉴·API·실행기·편집기는 로드되지 않습니다.
빌더를 연결하면 특정 업무에 맞춘 운영 화면을 **선언형 Manifest**로 만들 수 있습니다.

### Admin Studio와의 차이

- **Admin Studio** — XeCMS가 제공하는 표준 통합 관리 UI.
- **Custom Admin App** — 팀이 정의한 목적별 화면. 같은 Application Service와 권한 모델
  위에서 동작하되, 노출(visibility)과 권한(authorization)을 분리해 안전하게 구성합니다.

### 핵심 원칙

- **Application Service 공유** — 별도 백엔드 없이 기존 서비스 계층을 재사용합니다.
- **선언형 Manifest 우선** — 화면·액션을 코드가 아닌 선언으로 정의하고, 가능한 부분은
  자동 생성합니다.
- **Visibility ≠ Authorization** — 화면에 보이는 것과 실제 허용되는 것은 별개이며,
  최종 판정은 항상 권한 모델을 따릅니다.
- **안전한 Action** — 액션은 명시적으로 선언된 것만 실행됩니다.

Custom Admin App은 자체 App Audience/App Resource/관리 Permission을 가지며, 이를 통해
누가 어떤 App에 접근하고 무엇을 실행할 수 있는지 통제합니다.

> Custom Admin App은 관리 도구를 만드는 기능으로, 외부 최종 사용자용 애플리케이션과는
> 다릅니다. 외부 앱은 [REST API](./rest-api.md)나 [SDK](./typescript-sdk.md)로
> 연동하세요.

## 어떤 방식을 선택할까

| 목적 | 방식 |
| --- | --- |
| 서버 로직·훅·라우트 추가 | **Plugin** |
| Admin Studio에 위젯 추가 | **Plugin** (admin cards) |
| 빌더로 목적별 운영 화면 작성 | **업무 화면 빌더 선택 확장** |
| ERP 등 자체 업무 화면·로직 | 공개 REST API / SDK 기반 외부 애플리케이션 |
| 외부 서비스·웹사이트 연동 | [REST API](./rest-api.md) / [SDK](./typescript-sdk.md) |
