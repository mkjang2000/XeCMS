import { validateDatabaseSchema } from "./identifiers.js";
import { migrateCore } from "./migrate.js";
import { PostgresAuthStore } from "./postgres/auth-store.js";
import { PostgresDocumentQueryStore } from "./postgres/document-query-store.js";
import { PostgresDocumentStore } from "./postgres/document-store.js";
import { PostgresSchemaStore } from "./postgres/schema-store.js";
import { type AuthStore, type DocumentStore, type SchemaStore } from "@xecms/application";
import { Pool, type PoolClient } from "pg";

export interface PostgresDatabaseOptions {
  readonly connectionString: string;
  readonly schema?: string;
  readonly maxConnections?: number;
}

export class PostgresDatabase implements SchemaStore, DocumentStore, AuthStore {
  public readonly pool: Pool;
  public readonly schema: string;
  private readonly projectionLockPool: Pool;
  private projectionLockQueue: Promise<void> = Promise.resolve();

  private readonly schemaStore: PostgresSchemaStore;
  private readonly authStore: PostgresAuthStore;
  private readonly documentQueryStore: PostgresDocumentQueryStore;
  private readonly documentStore: PostgresDocumentStore;
  public constructor(options: PostgresDatabaseOptions) {
    this.schema = validateDatabaseSchema(options.schema ?? "xecms");
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
    });
    // Session advisory locks need a dedicated connection. Keeping it outside
    // the data pool prevents maxConnections=1 from deadlocking while the
    // protected operation performs its ordinary queries.
    this.projectionLockPool = new Pool({
      connectionString: options.connectionString,
      max: 1,
    });
    this.schemaStore = new PostgresSchemaStore(this.pool, this.schema);
    this.authStore = new PostgresAuthStore(this.pool, this.schema);
    this.documentQueryStore = new PostgresDocumentQueryStore(this.pool, this.schema);
    this.documentStore = new PostgresDocumentStore(this.pool, this.schema);
  }

  public migrate(): Promise<void> {
    return migrateCore(this.pool, this.schema);
  }

  public async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  /** Serializes topology changes with their authorization projection across instances. */

  public async withContentProjectionLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireContentProjectionLock();
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  /** Acquires the session lock for request-lifetime coordination. Release is idempotent. */

  public async acquireContentProjectionLock(): Promise<() => Promise<void>> {
    let releaseQueue!: () => void;
    const previous = this.projectionLockQueue;
    this.projectionLockQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous;

    let client: PoolClient;
    try {
      client = await this.projectionLockPool.connect();
    } catch (error: unknown) {
      releaseQueue();
      throw error;
    }
    const key = `xecms:content-authorization-projection:${this.schema}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    } catch (error: unknown) {
      client.release();
      releaseQueue();
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
      } finally {
        client.release();
        releaseQueue();
      }
    };
  }

  public async close(): Promise<void> {
    await Promise.all([this.pool.end(), this.projectionLockPool.end()]);
  }

  public issueSchemaIds(...args: Parameters<PostgresSchemaStore["issueSchemaIds"]>): ReturnType<PostgresSchemaStore["issueSchemaIds"]> {
    return this.schemaStore.issueSchemaIds(...args);
  }

  public getActiveSchema(...args: Parameters<PostgresSchemaStore["getActiveSchema"]>): ReturnType<PostgresSchemaStore["getActiveSchema"]> {
    return this.schemaStore.getActiveSchema(...args);
  }

  public getSchemaDraft(...args: Parameters<PostgresSchemaStore["getSchemaDraft"]>): ReturnType<PostgresSchemaStore["getSchemaDraft"]> {
    return this.schemaStore.getSchemaDraft(...args);
  }

  public saveSchemaDraft(...args: Parameters<PostgresSchemaStore["saveSchemaDraft"]>): ReturnType<PostgresSchemaStore["saveSchemaDraft"]> {
    return this.schemaStore.saveSchemaDraft(...args);
  }

  public applySchemaDraft(...args: Parameters<PostgresSchemaStore["applySchemaDraft"]>): ReturnType<PostgresSchemaStore["applySchemaDraft"]> {
    return this.schemaStore.applySchemaDraft(...args);
  }

  public bootstrapRequired(...args: Parameters<PostgresAuthStore["bootstrapRequired"]>): ReturnType<PostgresAuthStore["bootstrapRequired"]> {
    return this.authStore.bootstrapRequired(...args);
  }

  public createInitialOwner(...args: Parameters<PostgresAuthStore["createInitialOwner"]>): ReturnType<PostgresAuthStore["createInitialOwner"]> {
    return this.authStore.createInitialOwner(...args);
  }

  public findIdentityByUsername(...args: Parameters<PostgresAuthStore["findIdentityByUsername"]>): ReturnType<PostgresAuthStore["findIdentityByUsername"]> {
    return this.authStore.findIdentityByUsername(...args);
  }

  public findOwnerIdentity(...args: Parameters<PostgresAuthStore["findOwnerIdentity"]>): ReturnType<PostgresAuthStore["findOwnerIdentity"]> {
    return this.authStore.findOwnerIdentity(...args);
  }

  public createSession(...args: Parameters<PostgresAuthStore["createSession"]>): ReturnType<PostgresAuthStore["createSession"]> {
    return this.authStore.createSession(...args);
  }

  public findSession(...args: Parameters<PostgresAuthStore["findSession"]>): ReturnType<PostgresAuthStore["findSession"]> {
    return this.authStore.findSession(...args);
  }

  public findSessionWithCsrf(...args: Parameters<PostgresAuthStore["findSessionWithCsrf"]>): ReturnType<PostgresAuthStore["findSessionWithCsrf"]> {
    return this.authStore.findSessionWithCsrf(...args);
  }

  public deleteSession(...args: Parameters<PostgresAuthStore["deleteSession"]>): ReturnType<PostgresAuthStore["deleteSession"]> {
    return this.authStore.deleteSession(...args);
  }

  public recordAuthEvent(...args: Parameters<PostgresAuthStore["recordAuthEvent"]>): ReturnType<PostgresAuthStore["recordAuthEvent"]> {
    return this.authStore.recordAuthEvent(...args);
  }

  public loadDocument(...args: Parameters<PostgresDocumentQueryStore["loadDocument"]>): ReturnType<PostgresDocumentQueryStore["loadDocument"]> {
    return this.documentQueryStore.loadDocument(...args);
  }

  public countDocumentsByCollectionId(...args: Parameters<PostgresDocumentQueryStore["countDocumentsByCollectionId"]>): ReturnType<PostgresDocumentQueryStore["countDocumentsByCollectionId"]> {
    return this.documentQueryStore.countDocumentsByCollectionId(...args);
  }

  public listDocuments(...args: Parameters<PostgresDocumentQueryStore["listDocuments"]>): ReturnType<PostgresDocumentQueryStore["listDocuments"]> {
    return this.documentQueryStore.listDocuments(...args);
  }

  public queryDocuments(...args: Parameters<PostgresDocumentQueryStore["queryDocuments"]>): ReturnType<PostgresDocumentQueryStore["queryDocuments"]> {
    return this.documentQueryStore.queryDocuments(...args);
  }

  public listPublishedDocuments(...args: Parameters<PostgresDocumentQueryStore["listPublishedDocuments"]>): ReturnType<PostgresDocumentQueryStore["listPublishedDocuments"]> {
    return this.documentQueryStore.listPublishedDocuments(...args);
  }

  public getPublishedDocument(...args: Parameters<PostgresDocumentQueryStore["getPublishedDocument"]>): ReturnType<PostgresDocumentQueryStore["getPublishedDocument"]> {
    return this.documentQueryStore.getPublishedDocument(...args);
  }

  public createDocument(...args: Parameters<PostgresDocumentStore["createDocument"]>): ReturnType<PostgresDocumentStore["createDocument"]> {
    return this.documentStore.createDocument(...args);
  }

  public updateDocument(...args: Parameters<PostgresDocumentStore["updateDocument"]>): ReturnType<PostgresDocumentStore["updateDocument"]> {
    return this.documentStore.updateDocument(...args);
  }

  public executeHardPurge(...args: Parameters<PostgresDocumentStore["executeHardPurge"]>): ReturnType<PostgresDocumentStore["executeHardPurge"]> {
    return this.documentStore.executeHardPurge(...args);
  }

}

export { documentEventAuditPayload } from "./postgres/records.js";
