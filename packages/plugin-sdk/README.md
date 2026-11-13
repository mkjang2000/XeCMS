# @xecms/plugin-sdk

XeCMS Trusted Plugin manifest, lifecycle과 호환성 도구를 제공합니다.

```bash
pnpm add @xecms/plugin-sdk@^2.0.0
```

2.x 패키지는 XeCMS core/admin 0.6.x를 기준으로 호환성을 검사합니다. XeCMS 0.5.x를
사용하는 프로젝트는 1.x 패키지를 유지하세요. npm 패키지 버전과 manifest의 SDK 계약 버전은
별개이며, `manifestVersion: 1`과 `compatibility.sdk: "1.x"`는 그대로 사용합니다.

Plugin 작성법은 [확장 개발](https://github.com/mkjang2000/XeCMS/blob/main/docs/extending.md)을
참고하세요.
