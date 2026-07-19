# XeCMS 문서

XeCMS를 설치하고, 콘텐츠를 모델링하고, 외부 애플리케이션에서 REST API 또는
TypeScript SDK로 연동하고, Plugin으로 확장하기 위한 공식 문서입니다.

프로젝트 개요는 [저장소 README](../README.md)를 참고하세요.

## 처음이신가요?

1. [시작하기](./getting-started.md) — 설치, 최초 Owner 설정, 첫 요청까지
2. [핵심 개념](./concepts.md) — Workspace, 사용자 공간(Realm), Collection, 권한 모델
3. [인증](./authentication.md) — 세션 로그인, API Key, CSRF, 회원 인증

## 외부 앱 연동

4. [REST API 레퍼런스](./rest-api.md) — 전체 엔드포인트, 요청/응답, 오류
5. [TypeScript SDK](./typescript-sdk.md) — `@xecms/client` 사용법
6. [Schema 정의](./schema.md) — 선언형 Schema, 필드 타입, 타입 생성, 마이그레이션

## 운영과 확장

7. [운영 가이드](./operations.md) — 백업/복구, Doctor, Upgrade, 감사 로그, 데이터 보존
8. [확장 개발](./extending.md) — Plugin SDK와 Custom Admin App

## 규약

- 모든 REST 엔드포인트는 `/api` 접두사를 가지며, 기본 포트는 `3100`입니다.
- 응답은 JSON입니다. 오류는 [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807)
  형식으로, `type`, `title`, `status`, `detail`, `code`, `requestId` 필드를 포함합니다.
- 이 문서의 예시는 `@xecms/*` 패키지가 설치되어 있고 서버가 실행 중이라고 가정합니다.

## 문서 범위

이 문서는 **외부 애플리케이션이 사용하는 공개 API**를 다룹니다: 콘텐츠 조회·작성,
회원 인증, Schema 조회, 헬스 체크 등입니다. 이 대부분은 API Key로 접근할 수 있습니다.

Admin Studio가 내부적으로만 사용하는 관리 API(권한 정책 편집, 사용자 공간 관리,
Plugin·Admin App 관리, 감사·운영 엔드포인트)는 공개 계약이 아니므로 이 문서의 대상이
아닙니다. 이 기능들은 Admin Studio UI 또는 [CLI](./operations.md)로 사용하세요.
