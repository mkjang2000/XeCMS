import { DocumentDomainError } from "./errors.js";
import type { JsonObject, JsonValue } from "./types.js";

export function cloneJsonObject<TData extends JsonObject>(data: TData): TData {
  assertJsonObject(data);
  return deepFreeze(structuredClone(data)) as TData;
}

export function assertJsonObject(value: unknown): asserts value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throwInvalidJson([], "Document data must be a JSON object.");
  }
  assertJsonValue(value, [], new WeakSet<object>());
}

function assertJsonValue(
  value: unknown,
  path: readonly (string | number)[],
  ancestors: WeakSet<object>,
): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return;
    }
    throwInvalidJson(path, "Numbers must be finite.");
  }
  if (Array.isArray(value)) {
    assertNotCircular(value, path, ancestors);
    value.forEach((item, index) => assertJsonValue(item, [...path, index], ancestors));
    ancestors.delete(value);
    return;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    assertNotCircular(value, path, ancestors);
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) {
        throwInvalidJson([...path, key], "undefined is not a JSON value.");
      }
      assertJsonValue(child, [...path, key], ancestors);
    }
    ancestors.delete(value);
    return;
  }
  throwInvalidJson(path, `Unsupported JSON value of type '${typeof value}'.`);
}

function assertNotCircular(
  value: object,
  path: readonly (string | number)[],
  ancestors: WeakSet<object>,
): void {
  if (ancestors.has(value)) {
    throwInvalidJson(path, "Circular references are not valid JSON.");
  }
  ancestors.add(value);
}

function throwInvalidJson(path: readonly (string | number)[], message: string): never {
  throw new DocumentDomainError("DOCUMENT_DATA_NOT_JSON", message, { path });
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (!Object.isFrozen(value)) {
      Object.freeze(value);
    }
    Object.values(value).forEach((child) => deepFreeze(child));
  }
  return value;
}
