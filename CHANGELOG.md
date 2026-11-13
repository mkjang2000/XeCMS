# Changelog

## 0.6.0 — 배포 준비 중

아직 npm에 게시하지 않았다. 아래 내용은 다음 릴리스의 변경 사항과 전환 절차다.

엔진과 CMS Studio를 기본 제품으로 구성하고, 개발 중인 업무 화면 빌더를 선택 확장으로
분리했다. 엔진·빌더·`create-xecms` 패키지는 0.6.0, Plugin SDK와 예제 Plugin 패키지는
2.0.0이다. Plugin manifest/SDK 계약은 v1을 유지한다.

SDK 2.x는 `definePlugin`의 기본 core/admin 호환성 검사를 XeCMS 0.6 기준으로 수행한다.
0.5용 프로젝트가 사용하는 SDK 1.x와 예제 Plugin 1.x에 영향을 주지 않도록 npm 패키지의
major 버전을 올렸다. npm 패키지 버전과 manifest의 `compatibility.sdk` 계약 버전은 별개다.

### 변경 사항

- CI 보안 감사에서 확인된 의존성을 수정 버전으로 갱신했다. Fastify 5.12.5,
  Vite 8.2.4와 관련 URI·편집기·빌드 의존성을 반영하며 기존 high 감사 기준은 유지한다.
- 엔진·CMS Studio는 XeCMS, 빌더 소스와 검증은 [XeCMS-Plugin-AppBuilder](https://github.com/mkjang2000/XeCMS-Plugin-AppBuilder),
  내부 개발 기록은 비공개 XeCMS-Docs로 저장소를 분리했다. 공개 설치·API 문서는 엔진에 유지한다.

- 기본 설치와 실행에서 업무 화면 빌더, 차트 runtime, 예제 Plugin을 제외한다.
- 빌더는 `@xecms/app-builder-server`를 설치하고 `xecms.config.json`의 `extensions`에
  등록할 때만 화면과 API를 제공한다. 빌더 관리 UI 번들은 해당 패키지에 함께 설치된다.
- 빌더 DTO와 client API는 `@xecms/contracts`·`@xecms/client`에서
  `@xecms/app-builder-client`로 이동했다. 모델과 렌더러 이름은
  `@xecms/admin-apps`·`@xecms/admin-runtime`을 유지한다.
- 기존 Plugin SDK 모듈은 `xecms.config.json`의 `plugins`에 명시한다.
  `extensions`와 `plugins`의 기본값은 모두 빈 배열이다.
- 저장소 기본 build/dev/test는 엔진을 대상으로 한다. 엔진 검증 명령은
  [개발 및 검증](./docs/development.md), 빌더 명령은 별도 빌더 저장소를 참고한다.

### 0.5.x에서 업그레이드

1. 기존 버전으로 DB와 미디어를 백업하고 서비스를 중지한다. 0.5.x 백업을 복원해야 한다면
   먼저 같은 0.5.x 환경에서 복원한 뒤 업그레이드한다. 백업 형식은 v1을 유지하며,
   직접 복원은 이전과 같이 동일 major/minor 버전만 허용한다.
2. 소비 프로젝트의 엔진 의존성을 함께 갱신한다. 직접 사용하는 다른 엔진·빌더 패키지도
   0.6.0으로 맞추고 변경된 lockfile을 배포에 포함한다.

   ```bash
   pnpm add @xecms/cli@^0.6.0 @xecms/server@^0.6.0 @xecms/admin-app@^0.6.0
   ```

3. 기존 빌더를 계속 사용한다면 `pnpm add @xecms/app-builder-server@^0.6.0` 후 설정에
   `"extensions": ["@xecms/app-builder-server"]`를 추가한다. 직접 작성한 빌더 SDK
   import는 `@xecms/app-builder-client`로 옮긴다.
4. 예제 Plugin을 사용 중이라면 `@xecms/example-plugin@^2.0.0`을 설치하고 설정에
   `"plugins": ["@xecms/example-plugin"]`를 추가한다. 자체 Plugin은
   `@xecms/plugin-sdk@^2.0.0`으로 갱신하고 0.6 호환성을 확인한 뒤 manifest의 core/admin
   범위를 갱신한다. `compatibility.sdk`는 `1.x`를 유지한다. 기존 설치 기록과 manifest가 달라지면
   `pnpm exec xecms plugin sync`로 확인하고 `--apply`로 반영한다. 이전에 활성화한 Plugin을
   더 이상 제공하지 않는다면 시작 전에 `pnpm exec xecms plugin disable <id> --offline`으로
   비활성화한다. 활성 Plugin 패키지가 등록 목록에 없으면 서버 시작이 차단된다.
5. `pnpm build`, `pnpm migrate` 후 서비스를 시작하고 `pnpm doctor` 및 `/api/ready`를
   확인한다. 운영 환경 파일 지정 방법은 [배포 안내](./docs/deployment.md)를 따른다.

기존 콘텐츠, 빌더 manifest·draft·revision, DB 테이블, 미디어와 migration 이력을 삭제하지
않는다. 빌더 확장을 등록하지 않으면 빌더 화면/API만 제공되지 않으며 저장 데이터는 남는다.
