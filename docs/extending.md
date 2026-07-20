# 확장 개발

XeCMS는 두 가지 확장 방식을 제공합니다.

- **Plugin** — 서버 라우트·문서 훅·마이그레이션·Admin 카드를 추가하는 trusted 확장.
- **Custom Admin App** — 선언형 Manifest로 만드는 별도의 운영 화면.

## Plugin

Plugin은 `@xecms/plugin-sdk`의 `definePlugin`으로 정의하는 하나의 모듈입니다. Manifest,
서버 확장, Admin 확장으로 구성됩니다.

```bash
pnpm add @xecms/plugin-sdk
```

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
      core: ">=0.5.0 <0.6.0",
      admin: ">=0.5.0 <0.6.0",
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

Custom Admin App은 Admin Studio와 별개로, 특정 업무에 맞춘 운영 화면을 **선언형
Manifest**로 만드는 기능입니다.

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
| 목적별 별도 운영 화면 | **Custom Admin App** |
| 외부 서비스·웹사이트 연동 | [REST API](./rest-api.md) / [SDK](./typescript-sdk.md) |
