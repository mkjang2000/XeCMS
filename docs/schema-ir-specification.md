# XeCMS Schema IR 사양

> 단계: M0 — Domain Prototype  
> 상태: 구현 기준  
> 관련 패키지: `@xecms/schema`

## 1. 목적

Schema IR은 Admin UI, 설정 SDK, Schema Registry, Migration 및 타입 생성기가 공유하는 canonical schema 표현이다. 이름이나 입력 순서가 아니라 안정적인 Schema Object ID를 기준으로 변경을 추적한다.

## 2. Canonical IR과 Registry 분리

Canonical IR은 JSON으로 직렬화 가능한 순수 snapshot이다.

```text
Canonical Schema IR
├── format
├── formatVersion
├── collections
├── fields
└── relations/components
```

다음 운영 metadata는 IR에 포함하지 않는다.

- Workspace ID
- Registry Revision ID
- Parent Revision ID
- 변경 Actor
- 생성·적용 시각
- Migration 상태

Registry는 별도 envelope로 IR을 감싼다.

```ts
interface SchemaRevisionEnvelope {
  revisionId: string;
  parentRevisionId?: string;
  schema: SchemaIrV1;
  actorId: string;
  createdAt: string;
  hash: string;
}
```

따라서 같은 canonical IR을 개발·스테이징·운영에 적용해도 환경 metadata 때문에 hash가 달라지지 않는다.

## 3. ID 계약

Schema Object ID는 이름, path 또는 배열 index에서 파생하지 않는 opaque ID다.

| 객체 | Prefix |
|---|---|
| Collection | `col_` |
| Field | `fld_` |
| Relation | `rel_` |
| Component | `cmp_` |

필수 규칙:

- graph 전체에서 ID가 고유해야 한다.
- rename 시 기존 ID를 보존한다.
- clone 시 하위 객체를 포함해 새 ID를 발급한다.
- export/import는 ID를 보존한다.
- 삭제된 ID의 재사용 방지는 M1 Schema Registry가 책임진다.
- ID의 정렬 순서를 도메인 의미로 사용하지 않는다.
- ID generator는 외부에서 주입하며 domain package가 시간이나 random source에 직접 의존하지 않는다.

## 4. 이름 계약

Machine name은 lower camel case를 사용한다.

```text
^[a-z][A-Za-z0-9]{0,63}$
```

다음 Field 이름은 core metadata와 충돌하므로 예약한다.

```text
id
createdAt
updatedAt
deletedAt
_로 시작하는 모든 이름
```

Collection 이름은 Schema 안에서 고유하고, Field 이름은 같은 소유 Container 안에서 고유해야 한다. 충돌 검사는 대소문자를 접은 값으로 수행한다.

Collection과 Component는 machine `name`과 별도로 선택적인 `label`을 가질 수 있다. `label`은 Admin에서 사용하는 사람용 표시 이름이며 API identifier나 physical storage identifier가 아니다. `label` 변경은 Schema Revision에는 남지만 physical migration을 만들지 않는다.

## 5. Relation

Relation Field는 Field ID와 별도로 Relation ID를 가진다.

```ts
interface RelationFieldDefinition {
  id: FieldId;
  relationId: RelationId;
  targetCollectionId: CollectionId;
  cardinality: "one" | "many";
}
```

- target은 Collection 이름이 아니라 Collection ID를 참조한다.
- 존재하지 않는 target은 거부한다.
- self relation은 허용한다.
- Relation ID도 graph 전체 ID uniqueness 검사에 포함한다.
- relation target, cardinality 또는 Relation ID 변경은 Migration 검토 대상이다.

## 6. Decode와 Normalization

외부 JSON은 곧바로 `SchemaIrV1`로 type assertion하지 않는다.

```text
unknown input
→ decode
→ validate
→ normalize
→ canonical Schema IR
```

Decoder는 다음 값을 거부한다.

- 알 수 없는 format version
- 알 수 없는 core property
- 알 수 없는 Field type
- 함수, Date, undefined
- NaN 및 Infinity
- 잘못된 default value
- 잘못된 ID prefix

Normalization은 다음 성질을 만족해야 한다.

- deterministic
- idempotent
- 입력 객체 불변
- JSON round-trip 가능
- 의미가 같은 입력은 동일한 canonical serialization 생성

## 7. Validation 결과

Validation은 가능한 오류를 모두 수집하며 구조화된 경로를 반환한다.

```ts
interface SchemaIssue {
  code: string;
  message: string;
  path: readonly (string | number)[];
  objectId?: string;
}
```

최소 검증 범위:

- format과 version
- ID prefix와 uniqueness
- 이름 형식, 중복 및 예약어
- Field별 option과 default type
- text/number/array range
- timezone이 포함된 datetime
- Relation 및 Component target
- hierarchy option
- 아직 구현하지 않은 기능의 명시적 unsupported 오류

## 8. Diff

Diff는 stable ID를 기준으로 계산한다.

```text
동일 ID + 이름 변경       → rename
동일 ID + label 변경      → safe metadata change
기존 ID 제거              → removal
동일 이름 + 새 ID         → remove + add
동일 Field ID 소유자 변경 → owner change
동일 ID type 변경         → type change
```

변경 위험도:

| 위험도 | 의미 |
|---|---|
| `safe` | 데이터 변환 없이 적용 가능 |
| `risky` | 제약 검사 또는 데이터 Migration 필요 |
| `destructive` | 데이터 손실 가능성이 있어 명시적 승인 필요 |

Field 삭제와 호환되지 않는 type 변경은 destructive다. 필수 Field 추가, unique 활성화 및 Relation 변경은 최소 risky로 분류한다.

## 9. M0 완료 검증

- 최소 Schema decode/validate 성공
- stable ID 기반 rename 검출
- 같은 이름의 새 ID는 remove/add로 검출
- Field 삭제 및 type 변경 위험도
- Field owner 이동 검출
- Relation target 및 Relation 변경 검출
- 전역 ID 중복과 ID kind mismatch 거부
- 예약 이름과 중복 이름 거부
- 잘못된 default/range/datetime 거부
- input mutation 없음
- deterministic issue/diff 순서
- normalization idempotence
- JSON round-trip
