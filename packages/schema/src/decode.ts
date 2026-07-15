import { SchemaDecodeError, type SchemaDecodeIssueCode } from "./errors.js";
import { normalizeSchemaUnchecked } from "./normalize.js";
import type {
  CollectionAuthDefinition,
  CollectionDefinition,
  CollectionId,
  ComponentDefinition,
  ComponentId,
  FieldDefinition,
  FieldId,
  HierarchyDefinition,
  RelationId,
  SchemaIrV1,
  SelectOption,
} from "./types.js";
import { assertValidSchema } from "./validate.js";

type DecodePath = readonly (string | number)[];
interface UnknownRecord extends Readonly<Record<string, unknown>> {
  readonly components?: unknown;
  readonly kind?: unknown;
  readonly hierarchy?: unknown;
  readonly auth?: unknown;
  readonly enabled?: unknown;
  readonly realmKey?: unknown;
  readonly identifierFieldIds?: unknown;
  readonly acceptSystemIdentities?: unknown;
  readonly provisioning?: unknown;
  readonly defaultRoleIds?: unknown;
  readonly maxDepth?: unknown;
  readonly ordering?: unknown;
  readonly orderingFieldId?: unknown;
  readonly slugPath?: unknown;
  readonly permissionInheritance?: unknown;
  readonly minLength?: unknown;
  readonly maxLength?: unknown;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
  readonly minItems?: unknown;
  readonly maxItems?: unknown;
  readonly integer?: unknown;
  readonly defaultValue?: unknown;
  readonly multiple?: unknown;
  readonly onDelete?: unknown;
  readonly repeatable?: unknown;
  readonly acceptedMimeTypes?: unknown;
  readonly editor?: unknown;
  readonly label?: unknown;
  readonly required?: unknown;
  readonly unique?: unknown;
  readonly localized?: unknown;
  readonly readOnly?: unknown;
}

const BASE_FIELD_KEYS = [
  "id",
  "name",
  "type",
  "label",
  "required",
  "unique",
  "localized",
  "readOnly",
] as const;

/**
 * Decodes an untrusted JSON-compatible value, validates it, and returns the
 * detached canonical Schema IR. Unknown keys are never silently discarded.
 */
export function decodeSchema(input: unknown): SchemaIrV1 {
  assertJsonCompatible(input, [], new Set());
  const manifest = decodeManifest(input, []);
  assertValidSchema(manifest);
  return normalizeSchemaUnchecked(manifest);
}

/** Parses JSON text and applies the same strict decoder used for unknown data. */
export function parseSchema(serialized: string): SchemaIrV1 {
  let input: unknown;
  try {
    input = JSON.parse(serialized) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    fail("INVALID_JSON_SYNTAX", `Schema is not valid JSON.${detail}`, []);
  }
  return decodeSchema(input);
}

function decodeManifest(input: unknown, path: DecodePath): SchemaIrV1 {
  const value = record(input, path);
  knownKeys(value, ["format", "formatVersion", "collections", "components"], path);
  return {
    format: literal(required(value, "format", path), "xecms.schema", [...path, "format"]),
    formatVersion: literal(required(value, "formatVersion", path), 1, [
      ...path,
      "formatVersion",
    ]),
    collections: array(required(value, "collections", path), [...path, "collections"]).map(
      (entry, index) => decodeCollection(entry, [...path, "collections", index]),
    ),
    ...(has(value, "components")
      ? {
          components: array(value.components, [...path, "components"]).map((entry, index) =>
            decodeComponent(entry, [...path, "components", index]),
          ),
        }
      : {}),
  };
}

function decodeCollection(input: unknown, path: DecodePath): CollectionDefinition {
  const value = record(input, path);
  knownKeys(value, ["id", "name", "label", "kind", "fields", "hierarchy", "auth"], path);
  return {
    id: string(required(value, "id", path), [...path, "id"]) as CollectionId,
    name: string(required(value, "name", path), [...path, "name"]),
    ...(has(value, "label") ? { label: string(value.label, [...path, "label"]) } : {}),
    ...(has(value, "kind")
      ? {
          kind: oneOf(value.kind, ["collection", "singleton"] as const, [...path, "kind"]),
        }
      : {}),
    fields: decodeFields(required(value, "fields", path), [...path, "fields"]),
    ...(has(value, "hierarchy")
      ? { hierarchy: decodeHierarchy(value.hierarchy, [...path, "hierarchy"]) }
      : {}),
    ...(has(value, "auth")
      ? { auth: decodeCollectionAuth(value.auth, [...path, "auth"]) }
      : {}),
  };
}

function decodeComponent(input: unknown, path: DecodePath): ComponentDefinition {
  const value = record(input, path);
  knownKeys(value, ["id", "name", "label", "fields"], path);
  return {
    id: string(required(value, "id", path), [...path, "id"]) as ComponentId,
    name: string(required(value, "name", path), [...path, "name"]),
    ...(has(value, "label") ? { label: string(value.label, [...path, "label"]) } : {}),
    fields: decodeFields(required(value, "fields", path), [...path, "fields"]),
  };
}

function decodeHierarchy(input: unknown, path: DecodePath): HierarchyDefinition {
  const value = record(input, path);
  knownKeys(
    value,
    [
      "enabled",
      "maxDepth",
      "ordering",
      "orderingFieldId",
      "slugPath",
      "permissionInheritance",
    ],
    path,
  );
  return {
    enabled: literal(required(value, "enabled", path), true, [...path, "enabled"]),
    ...(has(value, "maxDepth")
      ? { maxDepth: finiteNumber(value.maxDepth, [...path, "maxDepth"]) }
      : {}),
    ...(has(value, "ordering")
      ? {
          ordering: oneOf(value.ordering, ["manual", "created-at", "field"] as const, [
            ...path,
            "ordering",
          ]),
        }
      : {}),
    ...(has(value, "orderingFieldId")
      ? {
          orderingFieldId: string(value.orderingFieldId, [
            ...path,
            "orderingFieldId",
          ]) as FieldId,
        }
      : {}),
    ...(has(value, "slugPath")
      ? { slugPath: boolean(value.slugPath, [...path, "slugPath"]) }
      : {}),
    ...(has(value, "permissionInheritance")
      ? {
          permissionInheritance: boolean(value.permissionInheritance, [
            ...path,
            "permissionInheritance",
          ]),
        }
      : {}),
  };
}

function decodeCollectionAuth(input: unknown, path: DecodePath): CollectionAuthDefinition {
  const value = record(input, path);
  knownKeys(
    value,
    [
      "enabled",
      "realmKey",
      "identifierFieldIds",
      "acceptSystemIdentities",
      "provisioning",
      "defaultRoleIds",
    ],
    path,
  );
  return {
    enabled: literal(required(value, "enabled", path), true, [...path, "enabled"]),
    realmKey: string(required(value, "realmKey", path), [...path, "realmKey"]),
    identifierFieldIds: array(
      required(value, "identifierFieldIds", path),
      [...path, "identifierFieldIds"],
    ).map(
      (entry, index) =>
        string(entry, [...path, "identifierFieldIds", index]) as FieldId,
    ),
    acceptSystemIdentities: boolean(
      required(value, "acceptSystemIdentities", path),
      [...path, "acceptSystemIdentities"],
    ),
    provisioning: oneOf(
      required(value, "provisioning", path),
      ["explicit", "jit"] as const,
      [...path, "provisioning"],
    ),
    defaultRoleIds: array(
      required(value, "defaultRoleIds", path),
      [...path, "defaultRoleIds"],
    ).map((entry, index) => string(entry, [...path, "defaultRoleIds", index])),
  };
}

function decodeFields(input: unknown, path: DecodePath): readonly FieldDefinition[] {
  return array(input, path).map((entry, index) => decodeField(entry, [...path, index]));
}

function decodeField(input: unknown, path: DecodePath): FieldDefinition {
  const value = record(input, path);
  const typeValue = required(value, "type", path);
  if (typeof typeValue !== "string") {
    fail("INVALID_INPUT_TYPE", "Field type must be a string.", [...path, "type"]);
  }

  const base = decodeFieldBase(value, path);
  switch (typeValue) {
    case "text":
    case "textarea":
      knownFieldKeys(value, ["minLength", "maxLength", "defaultValue"], path);
      return {
        ...base,
        type: typeValue,
        ...(has(value, "minLength")
          ? { minLength: finiteNumber(value.minLength, [...path, "minLength"]) }
          : {}),
        ...(has(value, "maxLength")
          ? { maxLength: finiteNumber(value.maxLength, [...path, "maxLength"]) }
          : {}),
        ...(has(value, "defaultValue")
          ? { defaultValue: string(value.defaultValue, [...path, "defaultValue"]) }
          : {}),
      };
    case "number":
      knownFieldKeys(value, ["minimum", "maximum", "integer", "defaultValue"], path);
      return {
        ...base,
        type: "number",
        ...(has(value, "minimum")
          ? { minimum: finiteNumber(value.minimum, [...path, "minimum"]) }
          : {}),
        ...(has(value, "maximum")
          ? { maximum: finiteNumber(value.maximum, [...path, "maximum"]) }
          : {}),
        ...(has(value, "integer")
          ? { integer: boolean(value.integer, [...path, "integer"]) }
          : {}),
        ...(has(value, "defaultValue")
          ? { defaultValue: finiteNumber(value.defaultValue, [...path, "defaultValue"]) }
          : {}),
      };
    case "boolean":
      knownFieldKeys(value, ["defaultValue"], path);
      return {
        ...base,
        type: "boolean",
        ...(has(value, "defaultValue")
          ? { defaultValue: boolean(value.defaultValue, [...path, "defaultValue"]) }
          : {}),
      };
    case "date":
    case "datetime":
      knownFieldKeys(value, ["defaultValue"], path);
      return {
        ...base,
        type: typeValue,
        ...(has(value, "defaultValue")
          ? { defaultValue: string(value.defaultValue, [...path, "defaultValue"]) }
          : {}),
      };
    case "json":
      knownFieldKeys(value, ["defaultValue"], path);
      return {
        ...base,
        type: "json",
        ...(has(value, "defaultValue")
          ? { defaultValue: cloneJsonValue(value.defaultValue) }
          : {}),
      };
    case "select":
    case "enum":
      knownFieldKeys(value, ["options", "multiple", "defaultValue"], path);
      return {
        ...base,
        type: typeValue,
        options: array(required(value, "options", path), [...path, "options"]).map(
          (entry, index) => decodeSelectOption(entry, [...path, "options", index]),
        ),
        ...(has(value, "multiple")
          ? { multiple: boolean(value.multiple, [...path, "multiple"]) }
          : {}),
        ...(has(value, "defaultValue")
          ? {
              defaultValue: Array.isArray(value.defaultValue)
                ? array(value.defaultValue, [...path, "defaultValue"]).map((entry, index) =>
                    string(entry, [...path, "defaultValue", index]),
                  )
                : string(value.defaultValue, [...path, "defaultValue"]),
            }
          : {}),
      };
    case "relation":
      knownFieldKeys(
        value,
        ["relationId", "targetCollectionId", "cardinality", "onDelete"],
        path,
      );
      return {
        ...base,
        type: "relation",
        relationId: string(required(value, "relationId", path), [
          ...path,
          "relationId",
        ]) as RelationId,
        targetCollectionId: string(required(value, "targetCollectionId", path), [
          ...path,
          "targetCollectionId",
        ]) as CollectionId,
        cardinality: oneOf(
          required(value, "cardinality", path),
          ["one", "many"] as const,
          [...path, "cardinality"],
        ),
        ...(has(value, "onDelete")
          ? {
              onDelete: oneOf(value.onDelete, ["restrict", "nullify", "cascade"] as const, [
                ...path,
                "onDelete",
              ]),
            }
          : {}),
      };
    case "object":
      knownFieldKeys(value, ["fields"], path);
      return {
        ...base,
        type: "object",
        fields: decodeFields(required(value, "fields", path), [...path, "fields"]),
      };
    case "array":
      knownFieldKeys(value, ["fields", "minItems", "maxItems"], path);
      return {
        ...base,
        type: "array",
        fields: decodeFields(required(value, "fields", path), [...path, "fields"]),
        ...(has(value, "minItems")
          ? { minItems: finiteNumber(value.minItems, [...path, "minItems"]) }
          : {}),
        ...(has(value, "maxItems")
          ? { maxItems: finiteNumber(value.maxItems, [...path, "maxItems"]) }
          : {}),
      };
    case "component":
      knownFieldKeys(value, ["componentId", "repeatable"], path);
      return {
        ...base,
        type: "component",
        componentId: string(required(value, "componentId", path), [
          ...path,
          "componentId",
        ]) as ComponentId,
        ...(has(value, "repeatable")
          ? { repeatable: boolean(value.repeatable, [...path, "repeatable"]) }
          : {}),
      };
    case "blocks":
      knownFieldKeys(value, ["allowedComponentIds"], path);
      return {
        ...base,
        type: "blocks",
        allowedComponentIds: array(
          required(value, "allowedComponentIds", path),
          [...path, "allowedComponentIds"],
        ).map(
          (entry, index) =>
            string(entry, [...path, "allowedComponentIds", index]) as ComponentId,
        ),
      };
    case "upload":
      knownFieldKeys(value, ["multiple", "acceptedMimeTypes"], path);
      return {
        ...base,
        type: "upload",
        ...(has(value, "multiple")
          ? { multiple: boolean(value.multiple, [...path, "multiple"]) }
          : {}),
        ...(has(value, "acceptedMimeTypes")
          ? {
              acceptedMimeTypes: array(value.acceptedMimeTypes, [
                ...path,
                "acceptedMimeTypes",
              ]).map((entry, index) =>
                string(entry, [...path, "acceptedMimeTypes", index]),
              ),
            }
          : {}),
      };
    case "rich-text":
      knownFieldKeys(value, ["editor"], path);
      return {
        ...base,
        type: "rich-text",
        ...(has(value, "editor") ? { editor: string(value.editor, [...path, "editor"]) } : {}),
      };
    default:
      fail("UNKNOWN_FIELD_TYPE", `Unknown field type '${typeValue}'.`, [...path, "type"]);
  }
}

function decodeFieldBase(value: UnknownRecord, path: DecodePath) {
  return {
    id: string(required(value, "id", path), [...path, "id"]) as FieldId,
    name: string(required(value, "name", path), [...path, "name"]),
    ...(has(value, "label") ? { label: string(value.label, [...path, "label"]) } : {}),
    ...(has(value, "required")
      ? { required: boolean(value.required, [...path, "required"]) }
      : {}),
    ...(has(value, "unique") ? { unique: boolean(value.unique, [...path, "unique"]) } : {}),
    ...(has(value, "localized")
      ? { localized: boolean(value.localized, [...path, "localized"]) }
      : {}),
    ...(has(value, "readOnly")
      ? { readOnly: boolean(value.readOnly, [...path, "readOnly"]) }
      : {}),
  };
}

function decodeSelectOption(input: unknown, path: DecodePath): SelectOption {
  const value = record(input, path);
  knownKeys(value, ["label", "value"], path);
  return {
    label: string(required(value, "label", path), [...path, "label"]),
    value: string(required(value, "value", path), [...path, "value"]),
  };
}

function knownFieldKeys(
  value: UnknownRecord,
  variantKeys: readonly string[],
  path: DecodePath,
): void {
  knownKeys(value, [...BASE_FIELD_KEYS, ...variantKeys], path);
}

function knownKeys(value: UnknownRecord, allowed: readonly string[], path: DecodePath): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value)
    .filter((key) => !allowedSet.has(key))
    .sort()[0];
  if (unknown !== undefined) {
    fail("UNKNOWN_PROPERTY", `Unknown property '${unknown}'.`, [...path, unknown]);
  }
}

function required(value: UnknownRecord, key: string, path: DecodePath): unknown {
  if (!has(value, key)) {
    fail("MISSING_PROPERTY", `Missing required property '${key}'.`, [...path, key]);
  }
  return value[key];
}

function has(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function record(value: unknown, path: DecodePath): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_INPUT_TYPE", "Expected an object.", path);
  }
  return value as UnknownRecord;
}

function array(value: unknown, path: DecodePath): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail("INVALID_INPUT_TYPE", "Expected an array.", path);
  }
  return value;
}

function string(value: unknown, path: DecodePath): string {
  if (typeof value !== "string") {
    fail("INVALID_INPUT_TYPE", "Expected a string.", path);
  }
  return value;
}

function boolean(value: unknown, path: DecodePath): boolean {
  if (typeof value !== "boolean") {
    fail("INVALID_INPUT_TYPE", "Expected a boolean.", path);
  }
  return value;
}

function finiteNumber(value: unknown, path: DecodePath): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("INVALID_INPUT_TYPE", "Expected a finite number.", path);
  }
  return value;
}

function literal<TValue extends string | number | boolean>(
  value: unknown,
  expected: TValue,
  path: DecodePath,
): TValue {
  if (value !== expected) {
    fail("INVALID_LITERAL", `Expected literal ${JSON.stringify(expected)}.`, path);
  }
  return expected;
}

function oneOf<const TValues extends readonly string[]>(
  value: unknown,
  choices: TValues,
  path: DecodePath,
): TValues[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    fail("INVALID_LITERAL", `Expected one of: ${choices.join(", ")}.`, path);
  }
  return value as TValues[number];
}

function assertJsonCompatible(value: unknown, path: DecodePath, active: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("INVALID_JSON_VALUE", "JSON numbers must be finite.", path);
    }
    return;
  }
  if (typeof value !== "object") {
    fail(
      "INVALID_JSON_VALUE",
      `Values of type '${typeof value}' are not valid JSON values.`,
      path,
    );
  }

  if (active.has(value)) {
    fail("INVALID_JSON_VALUE", "Circular references are not valid JSON values.", path);
  }
  active.add(value);

  if (Array.isArray(value)) {
    validateArrayProperties(value, path);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail("INVALID_JSON_VALUE", "Sparse arrays are not valid JSON values.", [...path, index]);
      }
      assertJsonCompatible(value[index], [...path, index], active);
    }
  } else {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      fail(
        "INVALID_JSON_VALUE",
        "Only plain objects are accepted; class instances and Date objects are not JSON values.",
        path,
      );
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        fail("INVALID_JSON_VALUE", "Symbol-keyed properties are not valid JSON values.", path);
      }
      validateDataProperty(value, key, [...path, key]);
      assertJsonCompatible((value as UnknownRecord)[key], [...path, key], active);
    }
  }

  active.delete(value);
}

function validateArrayProperties(value: readonly unknown[], path: DecodePath): void {
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") {
      continue;
    }
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
      fail("INVALID_JSON_VALUE", "Arrays may only contain indexed JSON values.", path);
    }
    validateDataProperty(value, key, [...path, Number(key)]);
  }
}

function validateDataProperty(value: object, key: PropertyKey, path: DecodePath): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.enumerable !== true
  ) {
    fail(
      "INVALID_JSON_VALUE",
      "Accessors and non-enumerable properties are not accepted as JSON input.",
      path,
    );
  }
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(clone, key, {
        value: cloneJsonValue((value as UnknownRecord)[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clone;
  }
  return value;
}

function fail(code: SchemaDecodeIssueCode, message: string, path: DecodePath): never {
  throw new SchemaDecodeError([{ code, message, path }]);
}
