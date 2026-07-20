# XeCMS M2 Blog example

이 예제는 M2 Content Core의 설치 후 검증과 회귀 테스트에 사용하는 canonical Schema다.

- [`xecms.schema.json`](./xecms.schema.json): export/import 가능한 canonical Schema Manifest
- [`xecms.generated.ts`](./xecms.generated.ts): 위 Manifest에서 생성한 byte-reproducible TypeScript 계약

## 포함 기능

| 기능 | 예제 |
|---|---|
| Singleton | `siteSettings` |
| 재사용 Component | `seoMetadata`, `heroBlock`, `calloutBlock` |
| Schema breadth | text, textarea, number, boolean, date, datetime, select, enum, JSON, object, array, rich-text, blocks |
| Stable Relation | Post → Author/Category/Post, Comment → Post |
| hard purge 정책 | Post → Author의 생략된 기본값 `restrict`, Category/Related Post의 `nullify`, Comment → Post의 `cascade` |
| Hierarchy | `categories`, `pages`; forest, manual order, `maxDepth: 2` |
| Upload | Site logo, Author avatar, Post cover/gallery |

`onDelete: "restrict"`는 Schema IR의 기본값이므로 canonical Manifest에서는 생략된다. 이름을 바꾸거나 배열 순서를 바꾸면 사용자에게 보이는 Schema 순서가 달라지지만, optional 기본값을 명시하는 것은 canonical export에서 다시 생략된다.

## 적용 순서

1. Admin Studio에서 Manifest를 import한다.
2. Migration Preview의 risky/destructive 변경을 검토한다.
3. Schema를 적용한다.
4. Media에 이미지를 업로드한다.
5. `siteSettings` 하나와 Author, Category, Post를 차례로 만든다.
6. `pages`에서 여러 root를 만들고 Tree View에서 이동·정렬한다.

자동화된 전체 여정은 [`tests/e2e/m2-content-core.spec.ts`](../../tests/e2e/m2-content-core.spec.ts)가 수행한다. 독립 PostgreSQL, `3110` 포트와 임시 Media 저장소에서 실행하려면 저장소 루트에서 다음 명령을 사용한다.

```bash
pnpm test:e2e:m2
```

## Rich Text 최소 값

```json
{
  "format": "xecms.rich-text",
  "formatVersion": 2,
  "content": [
    {
      "id": "blk-1",
      "type": "paragraph",
      "props": {},
      "content": [{ "type": "text", "text": "Hello XeCMS", "styles": {} }],
      "children": []
    }
  ]
}
```

Relation과 Upload Field에는 Revision이나 파일 경로가 아니라 각각 stable Document ID와 Media ID를 저장한다.
soft delete는 identity, Relation과 tree 위치를 보존하며 세 Relation 삭제 정책은 hard purge에서 실행된다.

M2의 Relation과 Upload Field는 Collection의 최상위 필드에서만 지원한다. object, array, component 또는 blocks 내부에 중첩하면 Schema 검증이 `UNSUPPORTED_NESTED_REFERENCE`로 거부한다.
