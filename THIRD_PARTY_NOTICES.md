# Third-Party Notices

XeCMS는 외부 오픈 소스 구성요소를 사용한다. 각 구성요소는 해당 저작권자와 라이선스의
적용을 받으며, XeCMS의 Apache-2.0 라이선스가 그 조건을 변경하지 않는다.

## BlockNote 0.52.1

다음 패키지는 Mozilla Public License 2.0에 따라 배포된다.

- `@blocknote/core`
- `@blocknote/mantine`
- `@blocknote/react`

라이선스 원문은 [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/)에서,
해당 버전의 소스는 [BlockNote 저장소](https://github.com/TypeCellOS/BlockNote)와 각 npm
패키지 배포본에서 확인할 수 있다. XeCMS는 위 패키지의 소스 파일을 수정하지 않는다.

그 밖의 설치된 프로덕션 의존성과 라이선스 목록은 다음 명령으로 확인할 수 있다.

```bash
pnpm licenses list --prod
```

공식 패키지와 컨테이너 배포물은 번들에 포함된 외부 구성요소의 저작권 및 라이선스 고지를
함께 보존해야 한다.
