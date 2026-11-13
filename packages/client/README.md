# @xecms/client

XeCMS 엔진 REST API를 호출하는 TypeScript 클라이언트입니다.
업무 화면 빌더의 `adminApps` API는 선택 패키지 `@xecms/app-builder-client`에서 제공합니다.
서버 확장은 `client.transport`를 사용해 엔진과 동일한 인증·CSRF·오류 처리를 재사용할 수 있습니다.

```bash
pnpm add @xecms/client
```

사용법은 [TypeScript SDK](https://github.com/mkjang2000/XeCMS/blob/main/docs/typescript-sdk.md)를
참고하세요.
