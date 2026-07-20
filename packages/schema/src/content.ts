import { ContentValidationError, type ContentIssue } from "./errors.js";
import type {
  CollectionDefinition,
  ComponentBlockValue,
  ComponentDefinition,
  FieldDefinition,
  FieldId,
  RichTextBlock,
  RichTextDocumentV2,
  SchemaIrV1,
  SchemaJsonObject,
  SchemaJsonValue,
} from "./types.js";
import { assertValidSchema } from "./validate.js";

const MAX_CONTENT_NESTING = 64;
const RICH_TEXT_NAME_PATTERN = /^[a-z][A-Za-z0-9.-]{0,127}$/;
const RICH_TEXT_BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface DecodeCollectionDataOptions {
  /** Error path prefix. Application services normally retain the default. */
  readonly path?: readonly (string | number)[];
  /** Defaults are applied by default on create and may be disabled for patches. */
  readonly applyDefaults?: boolean;
}

export interface ContentValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ContentIssue[];
  readonly data?: SchemaJsonObject;
}

/**
 * Strictly decodes document data using the complete Schema IR field contract.
 * Unknown properties and non-JSON runtime values are rejected rather than
 * being silently discarded.
 */
export function decodeCollectionData(
  schema: SchemaIrV1,
  collectionIdOrName: string,
  input: unknown,
  options: DecodeCollectionDataOptions = {},
): SchemaJsonObject {
  const result = validateCollectionData(schema, collectionIdOrName, input, options);
  if (!result.valid || result.data === undefined) {
    throw new ContentValidationError(result.issues);
  }
  return result.data;
}

/** Collects all content issues that can be discovered in one traversal. */
export function validateCollectionData(
  schema: SchemaIrV1,
  collectionIdOrName: string,
  input: unknown,
  options: DecodeCollectionDataOptions = {},
): ContentValidationResult {
  assertValidSchema(schema);
  const issues: ContentIssue[] = [];
  const collection = schema.collections.find(
    ({ id, name }) => id === collectionIdOrName || name === collectionIdOrName,
  );
  const path = options.path ?? ["data"];
  if (collection === undefined) {
    issues.push({
      code: "UNKNOWN_COLLECTION",
      message: `Collection '${collectionIdOrName}' does not exist in this schema.`,
      path,
    });
    return { valid: false, issues };
  }

  const context: DecodeContext = {
    schema,
    components: new Map((schema.components ?? []).map((component) => [component.id, component])),
    issues,
    applyDefaults: options.applyDefaults ?? true,
  };
  const data = decodeContainer(context, collection.fields, input, path, 0);
  return issues.length === 0 && data !== undefined
    ? { valid: true, issues, data }
    : { valid: false, issues };
}

interface DecodeContext {
  readonly schema: SchemaIrV1;
  readonly components: ReadonlyMap<string, ComponentDefinition>;
  readonly issues: ContentIssue[];
  readonly applyDefaults: boolean;
}

function decodeContainer(
  context: DecodeContext,
  fields: readonly FieldDefinition[],
  input: unknown,
  path: readonly (string | number)[],
  depth: number,
): SchemaJsonObject | undefined {
  if (!withinDepth(context, path, depth)) return undefined;
  if (!isPlainRecord(input)) {
    invalidType(context, path, "an object");
    return undefined;
  }

  const knownNames = new Set(fields.map(({ name }) => name));
  for (const key of Object.keys(input).sort(compareText)) {
    if (!knownNames.has(key)) {
      context.issues.push({
        code: "UNKNOWN_FIELD",
        message: `Unknown field '${key}'.`,
        path: [...path, key],
      });
    }
  }

  const output: Record<string, SchemaJsonValue> = {};
  for (const field of fields) {
    let rawValue = input[field.name];
    if (
      rawValue === undefined &&
      context.applyDefaults &&
      "defaultValue" in field &&
      field.defaultValue !== undefined
    ) {
      rawValue = field.defaultValue;
    }
    if (rawValue === undefined || rawValue === null) {
      if (field.required === true) {
        context.issues.push({
          code: "FIELD_REQUIRED",
          message: `Field '${field.name}' is required.`,
          path: [...path, field.name],
          fieldId: field.id,
        });
      }
      continue;
    }

    const decoded = decodeField(context, field, rawValue, [...path, field.name], depth + 1);
    if (decoded !== undefined) defineValue(output, field.name, decoded);
  }
  return output;
}

function decodeField(
  context: DecodeContext,
  field: FieldDefinition,
  value: unknown,
  path: readonly (string | number)[],
  depth: number,
): SchemaJsonValue | undefined {
  if (!withinDepth(context, path, depth)) return undefined;
  switch (field.type) {
    case "text":
    case "textarea":
      if (typeof value !== "string") return invalidFieldType(context, field.id, path, "a string");
      if (field.minLength !== undefined && value.length < field.minLength) {
        constraint(context, field.id, path, `Must contain at least ${field.minLength} characters.`);
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        constraint(context, field.id, path, `Must contain at most ${field.maxLength} characters.`);
      }
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return invalidFieldType(context, field.id, path, "a finite number");
      }
      if (field.integer === true && !Number.isInteger(value)) {
        constraint(context, field.id, path, "Must be an integer.");
      }
      if (field.minimum !== undefined && value < field.minimum) {
        constraint(context, field.id, path, `Must be at least ${field.minimum}.`);
      }
      if (field.maximum !== undefined && value > field.maximum) {
        constraint(context, field.id, path, `Must be at most ${field.maximum}.`);
      }
      return Object.is(value, -0) ? 0 : value;
    case "boolean":
      return typeof value === "boolean"
        ? value
        : invalidFieldType(context, field.id, path, "a boolean");
    case "date":
      return typeof value === "string" && isValidDate(value)
        ? value
        : invalidFieldType(context, field.id, path, "a YYYY-MM-DD date");
    case "datetime":
      return typeof value === "string" && isValidDateTime(value)
        ? new Date(value).toISOString()
        : invalidFieldType(context, field.id, path, "an ISO 8601 datetime with a timezone");
    case "json":
      return decodeJson(context, value, path, field.id, depth + 1);
    case "select":
    case "enum":
      return decodeSelect(context, field, value, path);
    case "object":
      return decodeContainer(context, field.fields, value, path, depth + 1);
    case "array":
      return decodeObjectArray(context, field, value, path, depth + 1);
    case "component":
      return decodeComponentField(context, field, value, path, depth + 1);
    case "rich-text":
      return decodeRichText(context, value, path, field.id, depth + 1);
    case "relation":
      return decodeStableReferences(context, field.id, field.cardinality === "many", value, path, "document ID");
    case "upload":
      return decodeStableReferences(context, field.id, field.multiple === true, value, path, "media ID");
    case "blocks":
      return decodeBlocks(context, field, value, path, depth + 1);
  }
}

function decodeSelect(
  context: DecodeContext,
  field: Extract<FieldDefinition, { readonly type: "select" | "enum" }>,
  value: unknown,
  path: readonly (string | number)[],
): SchemaJsonValue | undefined {
  const options = new Set(field.options.map(({ value: optionValue }) => optionValue));
  if (field.multiple === true) {
    if (!Array.isArray(value)) return invalidFieldType(context, field.id, path, "an array of option values");
    const output: string[] = [];
    const seen = new Set<string>();
    value.forEach((entry, index) => {
      if (typeof entry !== "string" || !options.has(entry)) {
        constraint(context, field.id, [...path, index], "Must be one of the configured option values.");
      } else if (seen.has(entry)) {
        constraint(context, field.id, [...path, index], "Duplicate option values are not allowed.");
      } else {
        seen.add(entry);
        output.push(entry);
      }
    });
    return output;
  }
  if (typeof value !== "string" || !options.has(value)) {
    return invalidFieldType(context, field.id, path, "a configured option value");
  }
  return value;
}

function decodeObjectArray(
  context: DecodeContext,
  field: Extract<FieldDefinition, { readonly type: "array" }>,
  value: unknown,
  path: readonly (string | number)[],
  depth: number,
): readonly SchemaJsonValue[] | undefined {
  if (!Array.isArray(value)) return invalidFieldType(context, field.id, path, "an array");
  if (!isDenseArray(value)) return invalidFieldType(context, field.id, path, "a dense JSON array");
  if (field.minItems !== undefined && value.length < field.minItems) {
    constraint(context, field.id, path, `Must contain at least ${field.minItems} items.`);
  }
  if (field.maxItems !== undefined && value.length > field.maxItems) {
    constraint(context, field.id, path, `Must contain at most ${field.maxItems} items.`);
  }
  const output: SchemaJsonValue[] = [];
  value.forEach((entry, index) => {
    const decoded = decodeContainer(context, field.fields, entry, [...path, index], depth + 1);
    if (decoded !== undefined) output.push(decoded);
  });
  return output;
}

function decodeComponentField(
  context: DecodeContext,
  field: Extract<FieldDefinition, { readonly type: "component" }>,
  value: unknown,
  path: readonly (string | number)[],
  depth: number,
): SchemaJsonValue | undefined {
  const component = context.components.get(field.componentId);
  if (component === undefined) {
    context.issues.push({
      code: "UNKNOWN_COMPONENT",
      message: `Component '${field.componentId}' does not exist.`,
      path,
      fieldId: field.id,
    });
    return undefined;
  }
  if (field.repeatable !== true) {
    return decodeContainer(context, component.fields, value, path, depth + 1);
  }
  if (!Array.isArray(value) || !isDenseArray(value)) {
    return invalidFieldType(context, field.id, path, "an array of component values");
  }
  const output: SchemaJsonValue[] = [];
  value.forEach((entry, index) => {
    const decoded = decodeContainer(context, component.fields, entry, [...path, index], depth + 1);
    if (decoded !== undefined) output.push(decoded);
  });
  return output;
}

function decodeStableReferences(
  context: DecodeContext,
  fieldId: FieldId,
  multiple: boolean,
  value: unknown,
  path: readonly (string | number)[],
  label: string,
): SchemaJsonValue | undefined {
  if (!multiple) {
    return typeof value === "string" && value.length > 0
      ? value
      : invalidFieldType(context, fieldId, path, `a stable ${label}`);
  }
  if (!Array.isArray(value) || !isDenseArray(value)) {
    return invalidFieldType(context, fieldId, path, `an array of stable ${label}s`);
  }
  const output: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      invalidFieldType(context, fieldId, [...path, index], `a stable ${label}`);
    } else if (seen.has(entry)) {
      constraint(context, fieldId, [...path, index], `Duplicate ${label}s are not allowed.`);
    } else {
      seen.add(entry);
      output.push(entry);
    }
  });
  return output;
}

function decodeBlocks(
  context: DecodeContext,
  field: Extract<FieldDefinition, { readonly type: "blocks" }>,
  value: unknown,
  path: readonly (string | number)[],
  depth: number,
): readonly ComponentBlockValue[] | undefined {
  if (!Array.isArray(value) || !isDenseArray(value)) {
    return invalidFieldType(context, field.id, path, "an array of component blocks");
  }
  const allowed = new Set<string>(field.allowedComponentIds);
  const output: ComponentBlockValue[] = [];
  value.forEach((entry, index) => {
    const blockPath = [...path, index];
    if (!isPlainRecord(entry)) {
      invalidFieldType(context, field.id, blockPath, "a component block object");
      return;
    }
    for (const key of Object.keys(entry).sort(compareText)) {
      if (key !== "componentId" && key !== "data") {
        context.issues.push({
          code: "UNKNOWN_FIELD",
          message: `Unknown block property '${key}'.`,
          path: [...blockPath, key],
          fieldId: field.id,
        });
      }
    }
    const componentId = entry["componentId"];
    if (typeof componentId !== "string" || !allowed.has(componentId)) {
      constraint(context, field.id, [...blockPath, "componentId"], "Must reference an allowed component.");
      return;
    }
    const component = context.components.get(componentId);
    if (component === undefined) {
      context.issues.push({
        code: "UNKNOWN_COMPONENT",
        message: `Component '${componentId}' does not exist.`,
        path: [...blockPath, "componentId"],
        fieldId: field.id,
      });
      return;
    }
    const data = decodeContainer(context, component.fields, entry["data"], [...blockPath, "data"], depth + 1);
    if (data !== undefined) {
      output.push({ componentId: component.id, data });
    }
  });
  return output;
}

function decodeRichText(
  context: DecodeContext,
  value: unknown,
  path: readonly (string | number)[],
  fieldId: FieldId,
  depth: number,
): RichTextDocumentV2 | undefined {
  if (!isPlainRecord(value)) return invalidRichText(context, fieldId, path, "Expected a rich-text document object.");
  knownRichTextKeys(context, value, ["format", "formatVersion", "content"], path, fieldId);
  if (value["format"] !== "xecms.rich-text" || value["formatVersion"] !== 2) {
    invalidRichText(context, fieldId, path, "Rich text must use format 'xecms.rich-text' version 2.");
    return undefined;
  }
  const content = value["content"];
  if (!Array.isArray(content) || !isDenseArray(content)) {
    return invalidRichText(context, fieldId, [...path, "content"], "Rich-text content must be an array.");
  }
  const seenIds = new Set<string>();
  const blocks: RichTextBlock[] = [];
  content.forEach((block, index) => {
    const decoded = decodeRichTextBlock(context, block, [...path, "content", index], fieldId, depth + 1, seenIds);
    if (decoded !== undefined) blocks.push(decoded);
  });
  return { format: "xecms.rich-text", formatVersion: 2, content: blocks };
}

function decodeRichTextBlock(
  context: DecodeContext,
  value: unknown,
  path: readonly (string | number)[],
  fieldId: FieldId,
  depth: number,
  seenIds: Set<string>,
): RichTextBlock | undefined {
  if (!withinDepth(context, path, depth, fieldId)) return undefined;
  if (!isPlainRecord(value)) return invalidRichText(context, fieldId, path, "Rich-text blocks must be objects.");
  knownRichTextKeys(context, value, ["id", "type", "props", "content", "children"], path, fieldId);

  const id = value["id"];
  if (typeof id !== "string" || !RICH_TEXT_BLOCK_ID_PATTERN.test(id)) {
    return invalidRichText(context, fieldId, [...path, "id"], "Rich-text block id is invalid.");
  }
  if (seenIds.has(id)) {
    return invalidRichText(context, fieldId, [...path, "id"], `Rich-text block id '${id}' is duplicated.`);
  }
  seenIds.add(id);

  const type = value["type"];
  if (typeof type !== "string" || !RICH_TEXT_NAME_PATTERN.test(type)) {
    return invalidRichText(context, fieldId, [...path, "type"], "Rich-text block type is invalid.");
  }

  const props = value["props"] === undefined
    ? undefined
    : decodeJsonObject(context, value["props"], [...path, "props"], fieldId, depth + 1);

  // Inline lists and table-content objects both pass through here; the editor
  // owns their inner vocabulary, the server only bounds depth and JSON shape.
  const rawContent = value["content"];
  let content: SchemaJsonValue | undefined;
  if (rawContent !== undefined) {
    if (rawContent === null || typeof rawContent !== "object") {
      invalidRichText(context, fieldId, [...path, "content"], "Block content must be an array or an object.");
    } else {
      content = decodeJson(context, rawContent, [...path, "content"], fieldId, depth + 1);
    }
  }

  const rawChildren = value["children"];
  let children: readonly RichTextBlock[] | undefined;
  if (rawChildren !== undefined) {
    if (!Array.isArray(rawChildren) || !isDenseArray(rawChildren)) {
      invalidRichText(context, fieldId, [...path, "children"], "Block children must be an array.");
    } else {
      const nested: RichTextBlock[] = [];
      rawChildren.forEach((child, index) => {
        const decoded = decodeRichTextBlock(context, child, [...path, "children", index], fieldId, depth + 1, seenIds);
        if (decoded !== undefined) nested.push(decoded);
      });
      children = nested;
    }
  }

  return {
    id,
    type,
    ...(props === undefined ? {} : { props }),
    ...(content === undefined ? {} : { content }),
    ...(children === undefined ? {} : { children }),
  };
}

function knownRichTextKeys(
  context: DecodeContext,
  value: Readonly<Record<string, unknown>>,
  known: readonly string[],
  path: readonly (string | number)[],
  fieldId: FieldId,
): void {
  const allowed = new Set(known);
  for (const key of Object.keys(value).sort(compareText)) {
    if (!allowed.has(key)) {
      invalidRichText(context, fieldId, [...path, key], `Unknown rich-text property '${key}'.`);
    }
  }
}

function decodeJsonObject(
  context: DecodeContext,
  value: unknown,
  path: readonly (string | number)[],
  fieldId: FieldId,
  depth: number,
): SchemaJsonObject | undefined {
  const decoded = decodeJson(context, value, path, fieldId, depth);
  if (decoded === undefined) return undefined;
  if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object") {
    invalidRichText(context, fieldId, path, "Block props must be a JSON object.");
    return undefined;
  }
  return decoded as SchemaJsonObject;
}

function decodeJson(
  context: DecodeContext,
  value: unknown,
  path: readonly (string | number)[],
  fieldId: FieldId,
  depth: number,
): SchemaJsonValue | undefined {
  if (!withinDepth(context, path, depth, fieldId)) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
    return invalidFieldType(context, fieldId, path, "a JSON value");
  }
  if (Array.isArray(value)) {
    if (!isDenseArray(value)) return invalidFieldType(context, fieldId, path, "a dense JSON array");
    const output: SchemaJsonValue[] = [];
    value.forEach((entry, index) => {
      const decoded = decodeJson(context, entry, [...path, index], fieldId, depth + 1);
      if (decoded !== undefined) output.push(decoded);
    });
    return output;
  }
  if (!isPlainRecord(value)) return invalidFieldType(context, fieldId, path, "a JSON value");
  const output: Record<string, SchemaJsonValue> = {};
  for (const key of Object.keys(value).sort(compareText)) {
    const decoded = decodeJson(context, value[key], [...path, key], fieldId, depth + 1);
    if (decoded !== undefined) defineValue(output, key, decoded);
  }
  return output;
}

function withinDepth(
  context: DecodeContext,
  path: readonly (string | number)[],
  depth: number,
  fieldId?: FieldId,
): boolean {
  if (depth <= MAX_CONTENT_NESTING) return true;
  context.issues.push({
    code: "FIELD_CONSTRAINT_FAILED",
    message: `Content nesting cannot exceed ${MAX_CONTENT_NESTING} levels.`,
    path,
    ...(fieldId === undefined ? {} : { fieldId }),
  });
  return false;
}

function invalidType(
  context: DecodeContext,
  path: readonly (string | number)[],
  expected: string,
): void {
  context.issues.push({
    code: "INVALID_CONTENT_TYPE",
    message: `Expected ${expected}.`,
    path,
  });
}

function invalidFieldType(
  context: DecodeContext,
  fieldId: FieldId,
  path: readonly (string | number)[],
  expected: string,
): undefined {
  context.issues.push({
    code: "INVALID_CONTENT_TYPE",
    message: `Expected ${expected}.`,
    path,
    fieldId,
  });
  return undefined;
}

function constraint(
  context: DecodeContext,
  fieldId: FieldId,
  path: readonly (string | number)[],
  message: string,
): void {
  context.issues.push({ code: "FIELD_CONSTRAINT_FAILED", message, path, fieldId });
}

function invalidRichText(
  context: DecodeContext,
  fieldId: FieldId,
  path: readonly (string | number)[],
  message: string,
): undefined {
  context.issues.push({ code: "INVALID_RICH_TEXT", message, path, fieldId });
  return undefined;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true;
  });
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return Reflect.ownKeys(value).every((key) =>
    key === "length" || (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)),
  );
}

function defineValue(target: Record<string, SchemaJsonValue>, key: string, value: SchemaJsonValue): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isValidDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDay;
}

function isValidDateTime(value: string): boolean {
  const match = DATETIME_PATTERN.exec(value);
  if (match === null) return false;
  return (
    isValidDate(`${match[1]}-${match[2]}-${match[3]}`) &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) <= 59 &&
    (match[7] === undefined || Number(match[7]) <= 23) &&
    (match[8] === undefined || Number(match[8]) <= 59) &&
    Number.isFinite(Date.parse(value))
  );
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US");
}

