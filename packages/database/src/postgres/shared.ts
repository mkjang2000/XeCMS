import { DEFAULT_WORKSPACE_ID } from "../migrate.js";
import { ApplicationError } from "@xecms/application";
import { ContentHierarchyDomainError } from "@xecms/core";
import { type PoolClient } from "pg";

export interface PostgresLikeError {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
}

export function mapDatabaseError(error: unknown): unknown {
  if (error instanceof ApplicationError) {
    return error;
  }
  if (error instanceof ContentHierarchyDomainError) {
    const status = error.code === "HIERARCHY_VERSION_CONFLICT"
      ? 409
      : error.code === "HIERARCHY_NODE_NOT_FOUND" || error.code === "HIERARCHY_PARENT_NOT_FOUND"
        ? 404
        : 422;
    return new ApplicationError(error.code, status, error.message, { details: error.details });
  }
  const pg = error as PostgresLikeError;
  if (pg.code === "23505") {
    if (pg.constraint === "_xecms_identities_normalized_username_key") {
      return new ApplicationError("USERNAME_ALREADY_EXISTS", 409, "That username already exists.");
    }
    return new ApplicationError(
      "DOCUMENT_UNIQUE_CONSTRAINT",
      409,
      "A document field violates a unique constraint.",
    );
  }
  if (pg.code === "23502" || pg.code === "23514" || pg.code === "22P02") {
    return new ApplicationError(
      "DATABASE_CONSTRAINT_FAILED",
      422,
      "Stored content does not satisfy the active schema constraints.",
    );
  }
  return error;
}

export function databaseErrorCode(error: unknown): string {
  return error instanceof ApplicationError
    ? error.code
    : ((error as PostgresLikeError).code ?? "MIGRATION_FAILED");
}

export function jsonOrNull(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

export function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function normalizeUsername(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function lockWorkspace(client: PoolClient): Promise<unknown> {
  return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `xecms:workspace:${DEFAULT_WORKSPACE_ID}`,
  ]);
}
