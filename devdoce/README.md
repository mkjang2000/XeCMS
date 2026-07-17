# XeCMS 문서

이 디렉터리는 현재 동작과 앞으로 구현할 기능의 기준 문서만 유지한다.
완료된 milestone의 세부 작업 일지는 개별 파일로 계속 늘리지 않고
[`release-history.md`](./release-history.md)에 요약한다.

## 문서 구조

| 문서 | 역할 |
| --- | --- |
| [시스템 사양](./system-specification.md) | 제품 경계, 콘텐츠·Identity·권한·Plugin의 현재 불변 규칙 |
| [개발 가이드](./development-guide.md) | 로컬 실행, 테스트, package 경계와 변경 절차 |
| [운영 Runbook](./operations-runbook.md) | 설치, 배포, upgrade, backup/restore와 장애 대응 |
| [릴리스 이력](./release-history.md) | M0~M4 구현 결과와 0.4.1 안정화 기록 |
| [Custom Admin Apps 사양](./custom-admin-apps-specification.md) | 운영용 관리자 앱 생성 기능의 제품·기술 사양 |
| [Custom Admin Apps 개발 순서](./custom-admin-apps-roadmap.md) | 구현 단계, 선행 조건, 검증 Gate와 완료 기준 |

## 관리 원칙

1. 현재 코드가 따라야 하는 규칙은 사양 문서에만 기록한다.
2. 이미 끝난 작업의 상세 계획은 유지하지 않고 릴리스 이력에 결과만 남긴다.
3. 실행 명령은 개발 가이드와 운영 Runbook 중 한 곳에서만 관리한다.
4. 새 기능은 사양과 개발 순서를 분리한다.
5. 사양의 ID, Permission, Route와 환경 변수는 실제 코드와 함께 변경한다.
6. 문서를 삭제하거나 이름을 바꾸면 `pnpm check:docs`로 내부 링크를 검증한다.
