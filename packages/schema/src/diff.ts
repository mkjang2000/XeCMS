import type {
  CollectionAuthDefinition,
  CollectionDefinition,
  ComponentDefinition,
  FieldDefinition,
  SchemaChange,
  SchemaIrV1,
  SchemaObjectId,
} from "./types.js";

interface IndexedObject {
  readonly id: SchemaObjectId;
  readonly name: string;
  readonly label?: string;
  readonly objectType: "collection" | "component" | "field";
  readonly path: readonly string[];
  readonly field?: FieldDefinition;
  readonly collection?: CollectionDefinition;
  readonly ownerId?: SchemaObjectId;
}

export function diffSchemas(previous: SchemaIrV1, next: SchemaIrV1): readonly SchemaChange[] {
  const before = indexSchema(previous);
  const after = indexSchema(next);
  const changes: SchemaChange[] = [];

  for (const [id, object] of before) {
    const nextObject = after.get(id);
    if (nextObject === undefined) {
      changes.push({
        kind: "object-deleted",
        objectId: id,
        objectType: object.objectType,
        severity: "destructive",
        path: object.path,
        before: object,
      });
      continue;
    }

    if (object.name !== nextObject.name) {
      changes.push({
        kind: "object-renamed",
        objectId: id,
        objectType: object.objectType,
        severity: "safe",
        path: nextObject.path,
        before: object.name,
        after: nextObject.name,
      });
    }

    if (object.label !== nextObject.label) {
      changes.push({
        kind: "object-label-changed",
        objectId: id,
        objectType: object.objectType,
        severity: "safe",
        path: [...nextObject.path, "label"],
        before: object.label ?? null,
        after: nextObject.label ?? null,
      });
    }

    if (object.collection !== undefined && nextObject.collection !== undefined) {
      const beforeAuth = object.collection.auth;
      const afterAuth = nextObject.collection.auth;
      if (!collectionAuthDefinitionsEqual(beforeAuth, afterAuth)) {
        changes.push({
          kind: "collection-auth-changed",
          objectId: id,
          objectType: "collection",
          severity: classifyCollectionAuthChange(beforeAuth, afterAuth),
          path: [...nextObject.path, "auth"],
          before: beforeAuth ?? null,
          after: afterAuth ?? null,
        });
      }
    }

    if (object.field !== undefined && nextObject.field !== undefined) {
      if (object.ownerId !== nextObject.ownerId) {
        changes.push({
          kind: "field-owner-changed",
          objectId: id,
          objectType: "field",
          severity: "destructive",
          path: nextObject.path,
          before: object.ownerId,
          after: nextObject.ownerId,
        });
      }
      if (object.field.type !== nextObject.field.type) {
        changes.push({
          kind: "field-type-changed",
          objectId: id,
          objectType: "field",
          severity: "destructive",
          path: nextObject.path,
          before: object.field.type,
          after: nextObject.field.type,
        });
      }

      if (
        object.field.type === "relation" &&
        nextObject.field.type === "relation" &&
        (object.field.relationId !== nextObject.field.relationId ||
          object.field.targetCollectionId !== nextObject.field.targetCollectionId ||
          object.field.cardinality !== nextObject.field.cardinality ||
          (object.field.onDelete ?? "restrict") !==
            (nextObject.field.onDelete ?? "restrict"))
      ) {
        changes.push({
          kind: "relation-changed",
          objectId: id,
          objectType: "field",
          severity: "risky",
          path: nextObject.path,
          before: object.field,
          after: nextObject.field,
        });
      }

      if (object.field.required !== nextObject.field.required || object.field.unique !== nextObject.field.unique) {
        changes.push({
          kind: "field-constraint-changed",
          objectId: id,
          objectType: "field",
          severity:
            nextObject.field.required === true || nextObject.field.unique === true ? "risky" : "safe",
          path: nextObject.path,
          before: {
            required: object.field.required ?? false,
            unique: object.field.unique ?? false,
          },
          after: {
            required: nextObject.field.required ?? false,
            unique: nextObject.field.unique ?? false,
          },
        });
      }
    }
  }

  for (const [id, object] of after) {
    if (before.has(id)) {
      continue;
    }
    const requiredField = object.field?.required === true && !hasDefaultValue(object.field);
    changes.push({
      kind: "object-created",
      objectId: id,
      objectType: object.objectType,
      severity: requiredField ? "risky" : "safe",
      path: object.path,
      after: object,
    });
  }

  return changes.sort(compareChanges);
}

function indexSchema(manifest: SchemaIrV1): ReadonlyMap<SchemaObjectId, IndexedObject> {
  const index = new Map<SchemaObjectId, IndexedObject>();

  manifest.collections.forEach((collection) => {
    indexContainer(index, collection, "collection", ["collections", collection.name]);
  });
  (manifest.components ?? []).forEach((component) => {
    indexContainer(index, component, "component", ["components", component.name]);
  });

  return index;
}

function indexContainer(
  index: Map<SchemaObjectId, IndexedObject>,
  container: CollectionDefinition | ComponentDefinition,
  objectType: "collection" | "component",
  path: readonly string[],
): void {
  index.set(container.id, {
    id: container.id,
    name: container.name,
    ...(container.label === undefined ? {} : { label: container.label }),
    objectType,
    path,
    ...(objectType === "collection"
      ? { collection: container as CollectionDefinition }
      : {}),
  });
  indexFields(index, container.fields, path, container.id);
}

function indexFields(
  index: Map<SchemaObjectId, IndexedObject>,
  fields: readonly FieldDefinition[],
  parentPath: readonly string[],
  ownerId: SchemaObjectId,
): void {
  fields.forEach((field) => {
    const path = [...parentPath, "fields", field.name];
    index.set(field.id, {
      id: field.id,
      name: field.name,
      ...(field.label === undefined ? {} : { label: field.label }),
      objectType: "field",
      path,
      field,
      ownerId,
    });
    if (field.type === "object" || field.type === "array") {
      indexFields(index, field.fields, path, field.id);
    }
  });
}

function hasDefaultValue(field: FieldDefinition): boolean {
  return "defaultValue" in field && field.defaultValue !== undefined;
}

export function collectionAuthDefinitionsEqual(
  left: CollectionAuthDefinition | undefined,
  right: CollectionAuthDefinition | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.realmKey === right.realmKey
    && sameStringArray(left.identifierFieldIds, right.identifierFieldIds)
    && left.acceptSystemIdentities === right.acceptSystemIdentities
    && left.provisioning === right.provisioning
    && sameStringArray(left.defaultRoleIds, right.defaultRoleIds);
}

export function classifyCollectionAuthChange(
  before: CollectionAuthDefinition | undefined,
  after: CollectionAuthDefinition | undefined,
): SchemaChange["severity"] {
  if (before === undefined && after !== undefined) return "risky";
  if (before !== undefined && after === undefined) return "destructive";
  if (before === undefined || after === undefined) return "destructive";
  return before.realmKey !== after.realmKey
    || !sameStringArray(before.identifierFieldIds, after.identifierFieldIds)
    ? "destructive"
    : "risky";
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareChanges(left: SchemaChange, right: SchemaChange): number {
  const idComparison = String(left.objectId).localeCompare(String(right.objectId), "en-US");
  return idComparison !== 0 ? idComparison : left.kind.localeCompare(right.kind, "en-US");
}
