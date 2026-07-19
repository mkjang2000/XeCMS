# Schema 정의

XeCMS의 콘텐츠 구조는 **선언형 Schema** 하나로 정의합니다. 이 Schema로부터 Admin UI,
검증, REST API, TypeScript 타입이 모두 파생됩니다.

## Schema 파일

프로젝트 루트의 `xecms.schema.json`에 Collection과 필드를 선언합니다.

```json
{
  "format": "xecms.schema",
  "formatVersion": 1,
  "collections": [
    {
      "id": "col_posts",
      "name": "posts",
      "label": "블로그 글",
      "kind": "collection",
      "fields": [
        { "id": "fld_title", "name": "title", "label": "제목",
          "type": "text", "required": true, "minLength": 1, "maxLength": 160 },
        { "id": "fld_slug", "name": "slug", "label": "슬러그",
          "type": "text", "required": true, "unique": true, "maxLength": 180 },
        { "id": "fld_body", "name": "body", "label": "본문",
          "type": "rich-text", "required": true }
      ]
    }
  ]
}
```

- `id`는 변경 불가한 안정 식별자입니다(마이그레이션의 기준).
- `name`은 API `data`의 키로 쓰입니다.
- `label`은 Admin UI 표시명입니다.

## Collection 종류 (kind)

| kind | 설명 |
| --- | --- |
| `collection` | 여러 Document를 담는 일반 컬렉션 |
| `singleton` | 단 하나의 Document만 갖는 컬렉션 (사이트 설정 등) |
| `hierarchy` | 부모/자식 트리 구조를 갖는 컬렉션 |

## 필드 타입

| type | 설명 | 주요 속성 |
| --- | --- | --- |
| `text` | 한 줄 텍스트 | `minLength`, `maxLength`, `unique` |
| `textarea` | 여러 줄 텍스트 | `maxLength` |
| `rich-text` | 서식 있는 본문 | — |
| `blocks` | 블록 기반 콘텐츠 | — |
| `number` | 숫자 | `min`, `max` |
| `boolean` | 참/거짓 | — |
| `date` | 날짜 | — |
| `datetime` | 날짜+시간 | — |
| `enum` | 단일 선택 (고정 목록) | `options` |
| `select` | 다중 선택 | `options` |
| `relation` | 다른 Collection 참조 | `collectionId` |
| `upload` | 미디어 업로드 | — |
| `json` | 임의 JSON | — |
| `object` | 중첩 객체 | `fields` |
| `array` | 반복 필드 | `of` |
| `component` | 재사용 컴포넌트 그룹 | `fields` |

공통 속성: `required`(필수), `unique`(고유), `label`, `description`.

### 예시

```json
{ "id": "fld_theme", "name": "theme", "label": "테마", "type": "enum",
  "required": true,
  "options": [
    { "label": "밝게", "value": "light" },
    { "label": "어둡게", "value": "dark" }
  ] }
```

```json
{ "id": "fld_post", "name": "post", "label": "대상 글",
  "type": "relation", "required": true, "collectionId": "col_posts" }
```

## 검증

Schema를 적용하기 전에 구조를 검사합니다.

```bash
xecms schema validate            # xecms.schema.json 검사
xecms schema validate other.json # 특정 파일 검사
```

콘텐츠 저장 시에는 이 Schema에 따라 각 필드의 `required`, 길이, enum 값 등이 자동으로
검증되며, 위반 시 `422`와 필드별 오류가 반환됩니다.

## TypeScript 타입 생성

Schema로부터 콘텐츠 `data`의 타입을 생성해 SDK와 함께 사용할 수 있습니다.

```bash
# 파일 기준으로 생성 (기본)
xecms generate types

# 실제 적용된(active) Schema 기준으로 생성
xecms generate types --source active --output src/xecms.generated.ts
```

생성된 타입을 import하면 [SDK](./typescript-sdk.md) 호출을 타입 안전하게 만들 수 있습니다.

## 마이그레이션

Schema 변경은 데이터베이스 마이그레이션으로 적용됩니다.

```bash
xecms schema export     # 현재 Schema를 export
xecms migrate           # 마이그레이션 적용 (forward-only)
```

- 마이그레이션은 **forward-only**입니다(자동 롤백 없음).
- 필드 `id`를 유지하면 이름·라벨 변경이 데이터 손실 없이 반영됩니다.
- 파괴적 변경(필드 삭제 등)은 데이터에 영향을 주므로 [백업](./operations.md) 후
  진행하세요.
