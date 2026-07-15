import { SchemaValidationError, type SchemaIssue } from "./errors.js";
import { hasSchemaIdPrefix, type SchemaObjectKind } from "./ids.js";
import type {
  CollectionDefinition,
  ComponentDefinition,
  FieldDefinition,
  SchemaIrV1,
} from "./types.js";

const NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;
const REALM_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/;
const RESERVED_SCHEMA_NAMES = new Set(["constructor", "prototype"]);
const RESERVED_FIELD_NAMES = new Set([
  "id",
  "createdat",
  "updatedat",
  "deletedat",
  "createdby",
  "updatedby",
  "revisionid",
]);

interface ValidationContext {
  readonly issues: SchemaIssue[];
  readonly seenIds: Map<string, readonly (string | number)[]>;
  readonly collectionIds: ReadonlySet<string>;
  readonly componentIds: ReadonlySet<string>;
}

export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly issues: readonly SchemaIssue[];
}

export function validateSchema(manifest: SchemaIrV1): SchemaValidationResult {
  const issues: SchemaIssue[] = [];
  const context: ValidationContext = {
    issues,
    seenIds: new Map(),
    collectionIds: new Set(manifest.collections.map(({ id }) => id)),
    componentIds: new Set((manifest.components ?? []).map(({ id }) => id)),
  };

  if (manifest.format !== "xecms.schema" || manifest.formatVersion !== 1) {
    addIssue(context, {
      code: "INVALID_MANIFEST",
      message: "format must be 'xecms.schema' and formatVersion must be 1.",
      path: [],
    });
  }

  validateNamedObjects(context, manifest.collections, ["collections"], "collection");
  validateNamedObjects(context, manifest.components ?? [], ["components"], "component");
  validateAuthRealmKeys(context, manifest.collections);

  manifest.collections.forEach((collection, index) => {
    const path = ["collections", index] as const;
    validateCollection(context, collection, path);
  });

  (manifest.components ?? []).forEach((component, index) => {
    const path = ["components", index] as const;
    validateComponent(context, component, path);
  });

  return { valid: issues.length === 0, issues };
}

export function assertValidSchema(manifest: SchemaIrV1): void {
  const result = validateSchema(manifest);
  if (!result.valid) {
    throw new SchemaValidationError(result.issues);
  }
}

function validateCollection(
  context: ValidationContext,
  collection: CollectionDefinition,
  path: readonly (string | number)[],
): void {
  registerId(context, collection.id, [...path, "id"], "collection");
  validateName(context, collection.name, [...path, "name"], collection.id);
  validateFields(context, collection.fields, [...path, "fields"], true);

  if (collection.auth !== undefined) {
    validateCollectionAuth(context, collection, path);
  }

  if (collection.kind === "singleton" && collection.hierarchy !== undefined) {
    addIssue(context, {
      code: "INVALID_HIERARCHY",
      message: "Singleton collections cannot enable hierarchy.",
      path: [...path, "hierarchy"],
      objectId: collection.id,
    });
  }

  if (collection.hierarchy !== undefined) {
    const { maxDepth, ordering, orderingFieldId } = collection.hierarchy;
    if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1)) {
      addIssue(context, {
        code: "INVALID_HIERARCHY",
        message: "hierarchy.maxDepth must be an integer greater than zero.",
        path: [...path, "hierarchy", "maxDepth"],
        objectId: collection.id,
      });
    }

    if (ordering === "field") {
      if (orderingFieldId === undefined || !hasField(collection.fields, orderingFieldId)) {
        addIssue(context, {
          code: "INVALID_HIERARCHY",
          message: "Field ordering requires a valid orderingFieldId from this collection.",
          path: [...path, "hierarchy", "orderingFieldId"],
          objectId: collection.id,
        });
      }
      if (orderingFieldId !== undefined) {
        validateReferenceId(
          context,
          orderingFieldId,
          "field",
          [...path, "hierarchy", "orderingFieldId"],
          collection.id,
        );
      }
    } else if (orderingFieldId !== undefined) {
      addIssue(context, {
        code: "INVALID_HIERARCHY",
        message: "orderingFieldId can only be used when ordering is 'field'.",
        path: [...path, "hierarchy", "orderingFieldId"],
        objectId: collection.id,
      });
    }
  }
}

function validateAuthRealmKeys(
  context: ValidationContext,
  collections: readonly CollectionDefinition[],
): void {
  const seen = new Map<string, number>();
  collections.forEach((collection, index) => {
    const realmKey = collection.auth?.realmKey;
    if (typeof realmKey !== "string") return;
    const previousIndex = seen.get(realmKey);
    if (previousIndex === undefined) {
      seen.set(realmKey, index);
      return;
    }
    addIssue(context, {
      code: "DUPLICATE_REALM_KEY",
      message: `Content Realm key '${realmKey}' is already used by collection '${collections[previousIndex]!.name}'.`,
      path: ["collections", index, "auth", "realmKey"],
      objectId: collection.id,
    });
  });
}

function validateCollectionAuth(
  context: ValidationContext,
  collection: CollectionDefinition,
  path: readonly (string | number)[],
): void {
  const auth = collection.auth!;
  const authPath = [...path, "auth"] as const;

  if (collection.kind === "singleton") {
    addIssue(context, {
      code: "INVALID_AUTH",
      message: "Singleton collections cannot be Content Realm profile collections.",
      path: authPath,
      objectId: collection.id,
    });
  }
  if (auth.enabled !== true) {
    addIssue(context, {
      code: "INVALID_AUTH",
      message: "auth.enabled must be the literal true; omit auth to disable it.",
      path: [...authPath, "enabled"],
      objectId: collection.id,
    });
  }
  if (
    typeof auth.realmKey !== "string"
    || auth.realmKey.length > 64
    || !REALM_KEY_PATTERN.test(auth.realmKey)
  ) {
    addIssue(context, {
      code: "INVALID_AUTH",
      message: "auth.realmKey must be a lowercase slug of at most 64 characters.",
      path: [...authPath, "realmKey"],
      objectId: collection.id,
    });
  }
  if (typeof auth.acceptSystemIdentities !== "boolean") {
    addIssue(context, {
      code: "INVALID_AUTH",
      message: "auth.acceptSystemIdentities must be a boolean.",
      path: [...authPath, "acceptSystemIdentities"],
      objectId: collection.id,
    });
  }
  if (auth.provisioning !== "explicit" && auth.provisioning !== "jit") {
    addIssue(context, {
      code: "INVALID_AUTH",
      message: "auth.provisioning must be either 'explicit' or 'jit'.",
      path: [...authPath, "provisioning"],
      objectId: collection.id,
    });
  }

  if (auth.identifierFieldIds.length === 0) {
    addIssue(context, {
      code: "INVALID_AUTH",
      message: "auth.identifierFieldIds must contain at least one field ID.",
      path: [...authPath, "identifierFieldIds"],
      objectId: collection.id,
    });
  }
  const identifierIds = new Set<string>();
  auth.identifierFieldIds.forEach((fieldId, index) => {
    const identifierPath = [...authPath, "identifierFieldIds", index] as const;
    if (identifierIds.has(fieldId)) {
      addIssue(context, {
        code: "INVALID_AUTH",
        message: `Duplicate auth identifier field '${fieldId}'.`,
        path: identifierPath,
        objectId: collection.id,
      });
      return;
    }
    identifierIds.add(fieldId);
    validateReferenceId(context, fieldId, "field", identifierPath, collection.id);

    const field = collection.fields.find((candidate) => candidate.id === fieldId);
    if (field === undefined) {
      addIssue(context, {
        code: "INVALID_AUTH",
        message: `Auth identifier '${fieldId}' must reference a top-level field in this collection.`,
        path: identifierPath,
        objectId: collection.id,
      });
      return;
    }
    if (field.type !== "text") {
      addIssue(context, {
        code: "INVALID_AUTH",
        message: `Auth identifier '${fieldId}' must be a text field.`,
        path: identifierPath,
        objectId: field.id,
      });
    }
    if (field.required !== true) {
      addIssue(context, {
        code: "INVALID_AUTH",
        message: `Auth identifier '${fieldId}' must be required.`,
        path: identifierPath,
        objectId: field.id,
      });
    }
    if (field.unique !== true) {
      addIssue(context, {
        code: "INVALID_AUTH",
        message: `Auth identifier '${fieldId}' must be unique.`,
        path: identifierPath,
        objectId: field.id,
      });
    }
  });

  const roleIds = new Set<string>();
  auth.defaultRoleIds.forEach((roleId, index) => {
    const rolePath = [...authPath, "defaultRoleIds", index] as const;
    if (typeof roleId !== "string" || roleId.trim().length === 0) {
      addIssue(context, {
        code: "INVALID_AUTH",
        message: "Default Role IDs must be non-empty strings.",
        path: rolePath,
        objectId: collection.id,
      });
      return;
    }
    if (roleIds.has(roleId)) {
      addIssue(context, {
        code: "INVALID_AUTH",
        message: `Duplicate default Role ID '${roleId}'.`,
        path: rolePath,
        objectId: collection.id,
      });
      return;
    }
    roleIds.add(roleId);
  });
}

function validateComponent(
  context: ValidationContext,
  component: ComponentDefinition,
  path: readonly (string | number)[],
): void {
  registerId(context, component.id, [...path, "id"], "component");
  validateName(context, component.name, [...path, "name"], component.id);
  validateFields(context, component.fields, [...path, "fields"], false);
}

function validateNamedObjects(
  context: ValidationContext,
  objects: readonly (CollectionDefinition | ComponentDefinition)[],
  path: readonly (string | number)[],
  objectType: string,
): void {
  const names = new Map<string, number>();
  objects.forEach((object, index) => {
    const normalized = object.name.toLocaleLowerCase("en-US");
    const previousIndex = names.get(normalized);
    if (previousIndex !== undefined) {
      addIssue(context, {
        code: "DUPLICATE_NAME",
        message: `Duplicate ${objectType} name '${object.name}'.`,
        path: [...path, index, "name"],
        objectId: object.id,
      });
    } else {
      names.set(normalized, index);
    }
  });
}

function validateFields(
  context: ValidationContext,
  fields: readonly FieldDefinition[],
  path: readonly (string | number)[],
  allowReferenceFields: boolean,
): void {
  const names = new Map<string, number>();

  fields.forEach((field, index) => {
    const fieldPath = [...path, index] as const;
    registerId(context, field.id, [...fieldPath, "id"], "field");
    validateName(context, field.name, [...fieldPath, "name"], field.id);
    if (
      RESERVED_FIELD_NAMES.has(field.name.toLocaleLowerCase("en-US")) ||
      field.name.startsWith("_")
    ) {
      addIssue(context, {
        code: "INVALID_NAME",
        message: `Field name '${field.name}' is reserved by XeCMS.`,
        path: [...fieldPath, "name"],
        objectId: field.id,
      });
    }

    const normalized = field.name.toLocaleLowerCase("en-US");
    if (names.has(normalized)) {
      addIssue(context, {
        code: "DUPLICATE_NAME",
        message: `Duplicate field name '${field.name}' in the same container.`,
        path: [...fieldPath, "name"],
        objectId: field.id,
      });
    } else {
      names.set(normalized, index);
    }

    validateField(context, field, fieldPath, allowReferenceFields);
  });
}

function validateField(
  context: ValidationContext,
  field: FieldDefinition,
  path: readonly (string | number)[],
  allowReferenceFields: boolean,
): void {
  if (field.localized === true) {
    addIssue(context, {
      code: "UNSUPPORTED_LOCALIZED",
      message: "Localized fields are reserved for a later milestone and are not supported by Schema IR v1.",
      path: [...path, "localized"],
      objectId: field.id,
    });
  }

  switch (field.type) {
    case "text":
    case "textarea": {
      validateRange(context, {
        minimum: field.minLength,
        maximum: field.maxLength,
        minimumKey: "minLength",
        maximumKey: "maxLength",
        nonNegative: true,
        integer: true,
        path,
        objectId: field.id,
      });
      if (
        field.defaultValue !== undefined &&
        ((field.minLength !== undefined && field.defaultValue.length < field.minLength) ||
          (field.maxLength !== undefined && field.defaultValue.length > field.maxLength))
      ) {
        invalidDefault(context, field.id, path, "Text default value is outside the length range.");
      }
      break;
    }
    case "number":
      validateRange(context, {
        minimum: field.minimum,
        maximum: field.maximum,
        minimumKey: "minimum",
        maximumKey: "maximum",
        nonNegative: false,
        integer: false,
        path,
        objectId: field.id,
      });
      if (field.defaultValue !== undefined) {
        if (!Number.isFinite(field.defaultValue)) {
          invalidDefault(context, field.id, path, "Number default value must be finite.");
        } else if (field.integer === true && !Number.isInteger(field.defaultValue)) {
          invalidDefault(context, field.id, path, "An integer field must have an integer default value.");
        } else if (
          (field.minimum !== undefined && field.defaultValue < field.minimum) ||
          (field.maximum !== undefined && field.defaultValue > field.maximum)
        ) {
          invalidDefault(context, field.id, path, "Number default value is outside the configured range.");
        }
      }
      break;
    case "select":
    case "enum": {
      const values = new Set<string>();
      if (field.options.length === 0) {
        addIssue(context, {
          code: "INVALID_DEFAULT_VALUE",
          message: "Select and enum fields require at least one option.",
          path: [...path, "options"],
          objectId: field.id,
        });
      }
      field.options.forEach((option, optionIndex) => {
        if (option.value.length === 0) {
          addIssue(context, {
            code: "INVALID_DEFAULT_VALUE",
            message: "Select option values cannot be empty.",
            path: [...path, "options", optionIndex, "value"],
            objectId: field.id,
          });
        }
        if (values.has(option.value)) {
          addIssue(context, {
            code: "DUPLICATE_SELECT_VALUE",
            message: `Duplicate select option value '${option.value}'.`,
            path: [...path, "options", optionIndex, "value"],
            objectId: field.id,
          });
        }
        values.add(option.value);
      });
      validateSelectDefault(context, field, values, path);
      break;
    }
    case "relation":
      if (!allowReferenceFields) {
        unsupportedNestedReference(context, field, path);
      }
      registerId(context, field.relationId, [...path, "relationId"], "relation");
      validateReferenceId(
        context,
        field.targetCollectionId,
        "collection",
        [...path, "targetCollectionId"],
        field.id,
      );
      if (!context.collectionIds.has(field.targetCollectionId)) {
        addIssue(context, {
          code: "UNKNOWN_RELATION_TARGET",
          message: `Unknown relation target '${field.targetCollectionId}'.`,
          path: [...path, "targetCollectionId"],
          objectId: field.id,
        });
      }
      if (field.required === true && field.onDelete === "nullify") {
        addIssue(context, {
          code: "INVALID_DEFAULT_VALUE",
          message: "A required relation cannot use the 'nullify' delete action.",
          path: [...path, "onDelete"],
          objectId: field.id,
        });
      }
      break;
    case "object":
      validateFields(context, field.fields, [...path, "fields"], false);
      break;
    case "array":
      validateRange(context, {
        minimum: field.minItems,
        maximum: field.maxItems,
        minimumKey: "minItems",
        maximumKey: "maxItems",
        nonNegative: true,
        integer: true,
        path,
        objectId: field.id,
      });
      validateFields(context, field.fields, [...path, "fields"], false);
      break;
    case "component":
      validateComponentTarget(context, field.componentId, [...path, "componentId"], field.id);
      break;
    case "blocks":
      if (field.allowedComponentIds.length === 0) {
        addIssue(context, {
          code: "UNKNOWN_COMPONENT_TARGET",
          message: "A blocks field requires at least one allowed component.",
          path: [...path, "allowedComponentIds"],
          objectId: field.id,
        });
      }
      {
        const seen = new Set<string>();
        field.allowedComponentIds.forEach((componentId, index) => {
          if (seen.has(componentId)) {
            addIssue(context, {
              code: "DUPLICATE_COMPONENT_TARGET",
              message: `Duplicate allowed component '${componentId}'.`,
              path: [...path, "allowedComponentIds", index],
              objectId: field.id,
            });
          }
          seen.add(componentId);
          validateComponentTarget(
            context,
            componentId,
            [...path, "allowedComponentIds", index],
            field.id,
          );
        });
      }
      break;
    case "date":
      if (field.defaultValue !== undefined && !isValidDate(field.defaultValue)) {
        invalidDefault(context, field.id, path, "Date default value must use a valid YYYY-MM-DD date.");
      }
      break;
    case "datetime":
      if (field.defaultValue !== undefined && !isValidDateTime(field.defaultValue)) {
        invalidDefault(
          context,
          field.id,
          path,
          "Datetime default value must be a valid ISO 8601 timestamp with a timezone.",
        );
      }
      break;
    case "json":
      if (
        "defaultValue" in field &&
        !isJsonValue(field.defaultValue, new Set<object>())
      ) {
        invalidDefault(context, field.id, path, "JSON default value must contain only JSON values.");
      }
      break;
    case "boolean":
      break;
    case "upload":
      if (!allowReferenceFields) {
        unsupportedNestedReference(context, field, path);
      }
      if (field.acceptedMimeTypes !== undefined) {
        if (field.acceptedMimeTypes.length === 0) {
          addIssue(context, {
            code: "INVALID_MIME_PATTERN",
            message: "acceptedMimeTypes must contain at least one MIME type or type/* pattern.",
            path: [...path, "acceptedMimeTypes"],
            objectId: field.id,
          });
        }
        const seen = new Set<string>();
        field.acceptedMimeTypes.forEach((pattern, index) => {
          if (!MIME_PATTERN.test(pattern) || pattern.length > 127) {
            addIssue(context, {
              code: "INVALID_MIME_PATTERN",
              message: `Invalid upload MIME pattern '${pattern}'.`,
              path: [...path, "acceptedMimeTypes", index],
              objectId: field.id,
            });
          } else if (seen.has(pattern)) {
            addIssue(context, {
              code: "INVALID_MIME_PATTERN",
              message: `Duplicate upload MIME pattern '${pattern}'.`,
              path: [...path, "acceptedMimeTypes", index],
              objectId: field.id,
            });
          }
          seen.add(pattern);
        });
      }
      break;
    case "rich-text":
      if (
        field.editor !== undefined &&
        (field.editor.length === 0 ||
          field.editor.length > 128 ||
          !/^[a-z][A-Za-z0-9.-]*$/.test(field.editor))
      ) {
        addIssue(context, {
          code: "INVALID_RICH_TEXT_EDITOR",
          message: "Rich-text editor IDs must be non-empty portable identifiers.",
          path: [...path, "editor"],
          objectId: field.id,
        });
      }
      break;
  }
}

function unsupportedNestedReference(
  context: ValidationContext,
  field: Extract<FieldDefinition, { readonly type: "relation" | "upload" }>,
  path: readonly (string | number)[],
): void {
  addIssue(context, {
    code: "UNSUPPORTED_NESTED_REFERENCE",
    message: `M2 only supports '${field.type}' fields directly on a collection. Nested reference fields are not supported.`,
    path: [...path, "type"],
    objectId: field.id,
  });
}

function validateReferenceId(
  context: ValidationContext,
  id: string,
  expectedKind: SchemaObjectKind,
  path: readonly (string | number)[],
  objectId: string,
): void {
  if (!hasSchemaIdPrefix(id, expectedKind)) {
    addIssue(context, {
      code: "INVALID_OBJECT_ID",
      message: `Schema reference is not a valid ${expectedKind} ID.`,
      path,
      objectId,
    });
  }
}

function validateSelectDefault(
  context: ValidationContext,
  field: Extract<FieldDefinition, { readonly type: "select" | "enum" }>,
  optionValues: ReadonlySet<string>,
  path: readonly (string | number)[],
): void {
  const value = field.defaultValue;
  if (value === undefined) {
    return;
  }

  if (field.multiple === true) {
    if (!Array.isArray(value)) {
      invalidDefault(context, field.id, path, "A multiple select default must be an array.");
      return;
    }
    const seen = new Set<string>();
    for (const entry of value) {
      if (!optionValues.has(entry) || seen.has(entry)) {
        invalidDefault(
          context,
          field.id,
          path,
          "Every multiple select default must be a unique configured option value.",
        );
        return;
      }
      seen.add(entry);
    }
    return;
  }

  if (typeof value !== "string" || !optionValues.has(value)) {
    invalidDefault(
      context,
      field.id,
      path,
      "A select default must be one configured option value.",
    );
  }
}

function invalidDefault(
  context: ValidationContext,
  objectId: string,
  path: readonly (string | number)[],
  message: string,
): void {
  addIssue(context, {
    code: "INVALID_DEFAULT_VALUE",
    message,
    path: [...path, "defaultValue"],
    objectId,
  });
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isValidDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isValidDateTime(value: string): boolean {
  const match = DATETIME_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  const offsetHours = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinutes = match[8] === undefined ? 0 : Number(match[8]);
  return (
    isValidDate(date) &&
    hours <= 23 &&
    minutes <= 59 &&
    seconds <= 59 &&
    offsetHours <= 23 &&
    offsetMinutes <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isJsonValue(value: unknown, active: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (
    (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) ||
    active.has(value)
  ) {
    return false;
  }
  active.add(value);
  const entries: readonly unknown[] = Array.isArray(value)
    ? value
    : Object.values(value as Readonly<Record<string, unknown>>);
  const valid = entries.every((entry) => isJsonValue(entry, active));
  active.delete(value);
  return valid;
}

function validateComponentTarget(
  context: ValidationContext,
  componentId: string,
  path: readonly (string | number)[],
  objectId: string,
): void {
  if (!context.componentIds.has(componentId)) {
    addIssue(context, {
      code: "UNKNOWN_COMPONENT_TARGET",
      message: `Unknown component target '${componentId}'.`,
      path,
      objectId,
    });
  }
  validateReferenceId(context, componentId, "component", path, objectId);
}

interface RangeValidationOptions {
  readonly minimum: number | undefined;
  readonly maximum: number | undefined;
  readonly minimumKey: string;
  readonly maximumKey: string;
  readonly nonNegative: boolean;
  readonly integer: boolean;
  readonly path: readonly (string | number)[];
  readonly objectId: string;
}

function validateRange(
  context: ValidationContext,
  options: RangeValidationOptions,
): void {
  const { minimum, maximum, minimumKey, maximumKey, nonNegative, integer, path, objectId } =
    options;
  if (
    minimum !== undefined &&
    (!Number.isFinite(minimum) ||
      (nonNegative && minimum < 0) ||
      (integer && !Number.isInteger(minimum)))
  ) {
    addIssue(context, {
      code: "INVALID_RANGE",
      message: `Minimum must be a finite${nonNegative ? ", non-negative" : ""}${integer ? " integer" : " number"}.`,
      path: [...path, minimumKey],
      objectId,
    });
  }
  if (
    maximum !== undefined &&
    (!Number.isFinite(maximum) ||
      (nonNegative && maximum < 0) ||
      (integer && !Number.isInteger(maximum)))
  ) {
    addIssue(context, {
      code: "INVALID_RANGE",
      message: `Maximum must be a finite${nonNegative ? ", non-negative" : ""}${integer ? " integer" : " number"}.`,
      path: [...path, maximumKey],
      objectId,
    });
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    addIssue(context, {
      code: "INVALID_RANGE",
      message: "Minimum cannot be greater than maximum.",
      path,
      objectId,
    });
  }
}

function registerId(
  context: ValidationContext,
  id: string,
  path: readonly (string | number)[],
  expectedKind: SchemaObjectKind,
): void {
  const previousPath = context.seenIds.get(id);
  if (previousPath !== undefined) {
    addIssue(context, {
      code: "DUPLICATE_OBJECT_ID",
      message: `Schema object ID '${id}' is already used at ${formatPath(previousPath)}.`,
      path,
      objectId: id,
    });
  } else {
    context.seenIds.set(id, path);
  }

  if (!hasSchemaIdPrefix(id, expectedKind)) {
    addIssue(context, {
      code: "INVALID_OBJECT_ID",
      message: `Schema object ID is not a valid ${expectedKind} ID.`,
      path,
      objectId: id,
    });
  }
}

function validateName(
  context: ValidationContext,
  name: string,
  path: readonly (string | number)[],
  objectId: string,
): void {
  if (!NAME_PATTERN.test(name) || RESERVED_SCHEMA_NAMES.has(name.toLocaleLowerCase("en-US"))) {
    addIssue(context, {
      code: "INVALID_NAME",
      message: `Invalid schema name '${name}'.`,
      path,
      objectId,
    });
  }
}

function hasField(fields: readonly FieldDefinition[], fieldId: string): boolean {
  return fields.some((field) => field.id === fieldId);
}

function addIssue(context: ValidationContext, issue: SchemaIssue): void {
  context.issues.push(issue);
}

function formatPath(path: readonly (string | number)[]): string {
  return path.map(String).join(".");
}
