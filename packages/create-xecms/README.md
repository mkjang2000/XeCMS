# create-xecms

XeCMS 프로젝트를 만드는 공식 CLI 진입점입니다.

0.6.x는 엔진과 CMS Studio를 기본 설치합니다. 업무 화면 빌더는 필요한 프로젝트에서
별도 확장으로 추가합니다.

```bash
pnpm create xecms my-cms
cd my-cms
pnpm install
docker compose up -d --wait
pnpm migrate
pnpm dev
```

Starter를 지정하려면 `--starter minimal`, `--starter blog` 또는 `--starter community`를
추가하세요.

전체 설치·운영 문서는 [XeCMS 저장소](https://github.com/mkjang2000/XeCMS)에서 확인할 수
있습니다. Apache-2.0 라이선스로 배포됩니다.
