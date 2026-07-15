import { assertValidSchema } from "./validate.js";
import type {
  BaseFieldDefinition,
  CollectionAuthDefinition,
  CollectionDefinition,
  ComponentDefinition,
  FieldDefinition,
  HierarchyDefinition,
  SchemaIrV1,
  SelectOption,
} from "./types.js";

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * Returns a detached, canonical Schema IR without mutating the caller's value.
 * Optional values equal to their documented default are omitted. Array order is
 * retained because collection, field, option, and block order is user-visible.
 */
export function normalizeSchema(manifest: SchemaIrV1): SchemaIrV1 {
  assertValidSchema(manifest);
  return normalizeSchemaUnchecked(manifest);
}

/** Serializes a validated schema with stable property ordering and indentation. */
export function serializeSchema(manifest: SchemaIrV1): string {
  return JSON.stringify(normalizeSchema(manifest), null, 2);
}

/** @internal Used after a decoder has already performed semantic validation. */
export function normalizeSchemaUnchecked(manifest: SchemaIrV1): SchemaIrV1 {
  const components = (manifest.components ?? []).map(normalizeComponent);
  return {
    format: "xecms.schema",
    formatVersion: 1,
    collections: manifest.collections.map(normalizeCollection),
    ...(components.length === 0 ? {} : { components }),
  };
}

function normalizeCollection(collection: CollectionDefinition): CollectionDefinition {
  return {
    id: collection.id,
    name: collection.name,
    ...(collection.label === undefined ? {} : { label: collection.label }),
    ...(collection.kind === "singleton" ? { kind: "singleton" as const } : {}),
    fields: collection.fields.map(normalizeField),
    ...(collection.hierarchy === undefined
      ? {}
      : { hierarchy: normalizeHierarchy(collection.hierarchy) }),
    ...(collection.auth === undefined
      ? {}
      : { auth: normalizeCollectionAuth(collection.auth) }),
  };
}

function normalizeComponent(component: ComponentDefinition): ComponentDefinition {
  return {
    id: component.id,
    name: component.name,
    ...(component.label === undefined ? {} : { label: component.label }),
    fields: component.fields.map(normalizeField),
  };
}

function normalizeHierarchy(hierarchy: HierarchyDefinition): HierarchyDefinition {
  return {
    enabled: true,
    ...(hierarchy.maxDepth === undefined ? {} : { maxDepth: hierarchy.maxDepth }),
    ...(hierarchy.ordering === undefined || hierarchy.ordering === "manual"
      ? {}
      : { ordering: hierarchy.ordering }),
    ...(hierarchy.orderingFieldId === undefined
      ? {}
      : { orderingFieldId: hierarchy.orderingFieldId }),
    ...(hierarchy.slugPath === true ? { slugPath: true } : {}),
    ...(hierarchy.permissionInheritance === true ? { permissionInheritance: true } : {}),
  };
}

function normalizeCollectionAuth(auth: CollectionAuthDefinition): CollectionAuthDefinition {
  return {
    enabled: true,
    realmKey: auth.realmKey,
    identifierFieldIds: [...auth.identifierFieldIds],
    acceptSystemIdentities: auth.acceptSystemIdentities,
    provisioning: auth.provisioning,
    defaultRoleIds: [...auth.defaultRoleIds],
  };
}

function normalizeField(field: FieldDefinition): FieldDefinition {
  const base = normalizeFieldBase(field);

  switch (field.type) {
    case "text":
    case "textarea":
      return {
        ...base,
        type: field.type,
        ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
        ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
        ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
      };
    case "number":
      return {
        ...base,
        type: "number",
        ...(field.minimum === undefined ? {} : { minimum: normalizeNumber(field.minimum) }),
        ...(field.maximum === undefined ? {} : { maximum: normalizeNumber(field.maximum) }),
        ...(field.integer === true ? { integer: true } : {}),
        ...(field.defaultValue === undefined
          ? {}
          : { defaultValue: normalizeNumber(field.defaultValue) }),
      };
    case "boolean":
      return {
        ...base,
        type: "boolean",
        ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
      };
    case "date":
      return {
        ...base,
        type: "date",
        ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
      };
    case "datetime":
      return {
        ...base,
        type: "datetime",
        ...(field.defaultValue === undefined
          ? {}
          : { defaultValue: new Date(field.defaultValue).toISOString() }),
      };
    case "json":
      return {
        ...base,
        type: "json",
        ...("defaultValue" in field
          ? { defaultValue: normalizeJsonValue(field.defaultValue as JsonValue) }
          : {}),
      };
    case "select":
    case "enum":
      return {
        ...base,
        type: field.type,
        options: field.options.map(normalizeSelectOption),
        ...(field.multiple === true ? { multiple: true } : {}),
        ...(field.defaultValue === undefined
          ? {}
          : {
              defaultValue: Array.isArray(field.defaultValue)
                ? [...field.defaultValue]
                : field.defaultValue,
            }),
      };
    case "relation":
      return {
        ...base,
        type: "relation",
        relationId: field.relationId,
        targetCollectionId: field.targetCollectionId,
        cardinality: field.cardinality,
        ...(field.onDelete === undefined || field.onDelete === "restrict"
          ? {}
          : { onDelete: field.onDelete }),
      };
    case "object":
      return { ...base, type: "object", fields: field.fields.map(normalizeField) };
    case "array":
      return {
        ...base,
        type: "array",
        fields: field.fields.map(normalizeField),
        ...(field.minItems === undefined ? {} : { minItems: field.minItems }),
        ...(field.maxItems === undefined ? {} : { maxItems: field.maxItems }),
      };
    case "component":
      return {
        ...base,
        type: "component",
        componentId: field.componentId,
        ...(field.repeatable === true ? { repeatable: true } : {}),
      };
    case "blocks":
      return {
        ...base,
        type: "blocks",
        allowedComponentIds: [...field.allowedComponentIds],
      };
    case "upload":
      return {
        ...base,
        type: "upload",
        ...(field.multiple === true ? { multiple: true } : {}),
        ...(field.acceptedMimeTypes === undefined
          ? {}
          : { acceptedMimeTypes: [...field.acceptedMimeTypes] }),
      };
    case "rich-text":
      return {
        ...base,
        type: "rich-text",
        ...(field.editor === undefined ? {} : { editor: field.editor }),
      };
  }
}

function normalizeFieldBase(field: BaseFieldDefinition): BaseFieldDefinition {
  return {
    id: field.id,
    name: field.name,
    ...(field.label === undefined ? {} : { label: field.label }),
    ...(field.required === true ? { required: true } : {}),
    ...(field.unique === true ? { unique: true } : {}),
    ...(field.localized === true ? { localized: true } : {}),
    ...(field.readOnly === true ? { readOnly: true } : {}),
  };
}

function normalizeSelectOption(option: SelectOption): SelectOption {
  return { label: option.label, value: option.value };
}

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function normalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    const object = value as { readonly [key: string]: JsonValue };
    for (const key of Object.keys(object).sort()) {
      defineJsonProperty(result, key, normalizeJsonValue(object[key]!));
    }
    return result;
  }
  return typeof value === "number" ? normalizeNumber(value) : value;
}

function defineJsonProperty(target: Record<string, JsonValue>, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
