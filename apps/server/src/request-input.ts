import { ApplicationError } from "@xecms/application";
import type {
  ApplySetupTemplateRequest,
  BootstrapRequest,
  LoginRequest,
  UpdateWorkspaceSettingsRequest,
} from "@xecms/contracts";
import { isStarterName } from "@xecms/schema";
import { type ServerConfig } from "./config.js";

export function assertSchemaMutationAllowed(config: ServerConfig, surface: "editor" | "manifest"): void {
  if (config.schemaMode === "locked") {
    throw new ApplicationError("SCHEMA_MUTATION_LOCKED", 423, "Schema mutation is locked by the server environment.");
  }
  if (config.schemaMode === "manifest-only" && surface === "editor") {
    throw new ApplicationError("SCHEMA_MANIFEST_ONLY", 423, "Only Schema Manifest import is allowed by the server environment.");
  }
}

export function workspaceSettingsInput(value: unknown): UpdateWorkspaceSettingsRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApplicationError("WORKSPACE_SETTINGS_REQUEST_INVALID", 400, "Workspace settings body must be an object.");
  }
  const input = value as Record<string, unknown>;
  const allowed = ["expectedRevision", "displayName", "defaultTimezone", "adminLocale", "currentPassword"];
  if (Object.keys(input).some((key) => !allowed.includes(key)) ||
      !Number.isSafeInteger(input["expectedRevision"]) || Number(input["expectedRevision"]) < 1 ||
      ["displayName", "defaultTimezone", "adminLocale", "currentPassword"].some((key) => typeof input[key] !== "string" || (input[key] as string).length === 0)) {
    throw new ApplicationError("WORKSPACE_SETTINGS_REQUEST_INVALID", 400, "Workspace settings body is invalid.");
  }
  return input as unknown as UpdateWorkspaceSettingsRequest;
}

export function byteStream(value: unknown): AsyncIterable<Uint8Array> {
  if (
    value === null ||
    typeof value !== "object" ||
    !(Symbol.asyncIterator in value) ||
    typeof value[Symbol.asyncIterator] !== "function"
  ) {
    throw badRequest("MEDIA_STREAM_INVALID", "The request body must be a binary stream.");
  }
  const source = value as AsyncIterable<unknown>;
  return {
    async *[Symbol.asyncIterator]() {
      for await (const chunk of source) {
        if (chunk instanceof Uint8Array) yield chunk;
        else if (typeof chunk === "string") yield Buffer.from(chunk);
        else throw badRequest("MEDIA_STREAM_INVALID", "The upload contains an invalid chunk.");
      }
    },
  };
}

export function singleHeader(value: string | readonly string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest("REQUEST_HEADER_INVALID", `${name} is required.`);
  }
  return value;
}

export function eventStringOrNull(
  payload: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

export function eventInteger(payload: Readonly<Record<string, unknown>> | null, key: string): number {
  const value = payload?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

export function credentials(input: unknown): BootstrapRequest & LoginRequest {
  const body = objectBody(input);
  const username = requiredString(body["username"], "username");
  const password = requiredString(body["password"], "password");
  return { username, password };
}

export function setupTemplateInput(input: unknown): ApplySetupTemplateRequest {
  const body = objectBody(input);
  const starter = requiredString(body["starter"], "starter");
  if (!isStarterName(starter)) {
    throw badRequest("SETUP_TEMPLATE_INVALID", "starter must be minimal, blog or community.");
  }
  const rawModules = body["enabledModuleIds"];
  if (!Array.isArray(rawModules) || rawModules.some((value) => typeof value !== "string")) {
    throw badRequest("SETUP_TEMPLATE_INVALID", "enabledModuleIds must be an array of strings.");
  }
  const enabledModuleIds = [...new Set(rawModules as string[])];
  const rawLabels = body["collectionLabels"];
  if (rawLabels === null || typeof rawLabels !== "object" || Array.isArray(rawLabels)) {
    throw badRequest("SETUP_TEMPLATE_INVALID", "collectionLabels must be an object of strings.");
  }
  const collectionLabels: Record<string, string> = {};
  for (const [collectionId, label] of Object.entries(rawLabels as Record<string, unknown>)) {
    if (typeof label !== "string") {
      throw badRequest("SETUP_TEMPLATE_INVALID", `collectionLabels.${collectionId} must be a string.`);
    }
    collectionLabels[collectionId] = label;
  }
  return { starter, enabledModuleIds, collectionLabels };
}

export function objectBody(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("REQUEST_BODY_INVALID", "The request body must be a JSON object.");
  }
  return input as Record<string, unknown>;
}

export function expectedDocumentVersion(input: unknown): number {
  const body = objectBody(input);
  const expectedVersion = body["expectedVersion"];
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) {
    throw badRequest("REQUEST_BODY_INVALID", "expectedVersion must be a positive integer.");
  }
  return expectedVersion as number;
}

export function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw badRequest("REQUEST_BODY_INVALID", `${field} must be a non-negative safe integer.`);
  }
  return value;
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest("REQUEST_BODY_INVALID", `${field} must be a non-empty string.`);
  }
  return value;
}

export function nullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return requiredString(value, field);
}

export function badRequest(code: string, message: string): ApplicationError {
  return new ApplicationError(code, 400, message);
}
