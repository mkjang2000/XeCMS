import {
  contentTableName,
  fieldColumnName,
  qualifiedName,
  quoteIdentifier,
} from "../identifiers.js";
import {
  documentQueryFieldSql,
  documentQuerySortAliasNames,
  documentQueryFilterSql,
  documentQueryCursorSql,
} from "./query-sql.js";
import {
  type DocumentIdentityRow,
  type DocumentRevisionRow,
  type PublishedDocumentRow,
  hydrateAggregate,
  projectionToRecord,
  publishedRowToRecord,
} from "./records.js";
import {
  canonicalDocumentQueryScalar,
  encodeDocumentQueryCursor,
  type DocumentQueryStorePage,
  type DocumentPage,
  type DocumentListState,
  type NormalizedDocumentQuery,
  type PublishedDocumentPage,
  type PublishedDocumentRecord,
} from "@xecms/application";
import { assertDocumentInvariants, type DocumentAggregate } from "@xecms/core";
import { type CollectionDefinition } from "@xecms/schema";
import { type Pool } from "pg";

export class PostgresDocumentQueryStore {
  public constructor(private readonly pool: Pool, private readonly schema: string) {}

  public async loadDocument(documentId: string): Promise<DocumentAggregate | null> {
    const identityResult = await this.pool.query<DocumentIdentityRow>(
      `SELECT * FROM ${this.q("_xecms_documents")} WHERE id = $1`,
      [documentId],
    );
    const identity = identityResult.rows[0];
    if (identity === undefined) {
      return null;
    }
    const revisionResult = await this.pool.query<DocumentRevisionRow>(
      `SELECT * FROM ${this.q("_xecms_document_revisions")}
       WHERE document_id = $1 ORDER BY sequence ASC`,
      [documentId],
    );
    const aggregate = hydrateAggregate(identity, revisionResult.rows);
    assertDocumentInvariants(aggregate);
    return aggregate;
  }

  /** Counts active and soft-deleted documents without requiring an active schema definition. */

  public async countDocumentsByCollectionId(collectionId: string): Promise<number> {
    const result = await this.pool.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count
         FROM ${this.q("_xecms_documents")}
        WHERE collection_id = $1`,
      [collectionId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async listDocuments(
    collection: CollectionDefinition,
    input: {
      readonly page: number;
      readonly pageSize: number;
      readonly state: DocumentListState;
    },
  ): Promise<DocumentPage> {
    const table = qualifiedName(this.schema, contentTableName(collection.id));
    const aliases = collection.fields.map((field) =>
      `p.${quoteIdentifier(fieldColumnName(field.id))} AS ${quoteIdentifier(field.name)}`,
    );
    const offset = (input.page - 1) * input.pageSize;
    const statePredicate = input.state === "deleted" ? "d.deletion IS NOT NULL" : "d.deletion IS NULL";
    const [rows, count] = await Promise.all([
      this.pool.query<Record<string, unknown>>(
        `SELECT p.id, p.aggregate_version, p.created_at, p.updated_at,
                d.created_by AS owner_subject_id,
                d.current_draft_revision_id, d.publication, d.lifecycle, d.deletion
                ${aliases.length === 0 ? "" : `, ${aliases.join(", ")}`}
         FROM ${table} p
         JOIN ${this.q("_xecms_documents")} d ON d.id = p.id
         WHERE ${statePredicate}
         ORDER BY p.updated_at DESC, p.id ASC LIMIT $1 OFFSET $2`,
        [input.pageSize, offset],
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*)::text AS total
         FROM ${table} p
         JOIN ${this.q("_xecms_documents")} d ON d.id = p.id
         WHERE ${statePredicate}`,
      ),
    ]);
    return {
      items: rows.rows.map((row) => projectionToRecord(collection, row)),
      page: input.page,
      pageSize: input.pageSize,
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  public async queryDocuments(
    collection: CollectionDefinition,
    input: NormalizedDocumentQuery,
  ): Promise<DocumentQueryStorePage> {
    const table = qualifiedName(this.schema, contentTableName(collection.id));
    const projectedFields = input.fields === undefined
      ? collection.fields
      : input.fields.map((fieldId) =>
        collection.fields.find(({ id }) => String(id) === fieldId)!);
    const aliases = projectedFields.map((field) =>
      `p.${quoteIdentifier(fieldColumnName(field.id))} AS ${quoteIdentifier(field.name)}`,
    );
    const fieldById = new Map(collection.fields.map((field) => [String(field.id), field]));
    const parameters: unknown[] = [];
    const statePredicate = input.state === "deleted" ? "d.deletion IS NOT NULL" : "d.deletion IS NULL";
    const filterPredicate = input.filter === undefined
      ? undefined
      : documentQueryFilterSql(input.filter, fieldById, parameters);
    const sortExpressions = input.sort.map(({ field }) =>
      documentQueryFieldSql(field, fieldById));
    const cursorPredicate = input.cursorValues === undefined
      ? undefined
      : documentQueryCursorSql(
        sortExpressions,
        input.sort,
        input.cursorValues,
        parameters,
      );
    const predicates = [statePredicate, filterPredicate, cursorPredicate]
      .filter((value): value is string => value !== undefined);
    const sortAliasNames = documentQuerySortAliasNames(collection, sortExpressions.length);
    const sortAliases = sortExpressions.map((expression, index) =>
      `${expression} AS ${quoteIdentifier(sortAliasNames[index]!)}`);
    parameters.push(input.limit + 1);
    const limitParameter = `$${parameters.length}`;
    const rows = await this.pool.query<Record<string, unknown>>(
      `SELECT p.id, p.aggregate_version, p.created_at, p.updated_at,
              d.created_by AS owner_subject_id,
              d.current_draft_revision_id, d.publication, d.lifecycle, d.deletion
              ${aliases.length === 0 ? "" : `, ${aliases.join(", ")}`}
              ${sortAliases.length === 0 ? "" : `, ${sortAliases.join(", ")}`}
       FROM ${table} p
       JOIN ${this.q("_xecms_documents")} d ON d.id = p.id
       WHERE ${predicates.join(" AND ")}
       ORDER BY ${sortExpressions.map((expression, index) =>
         `${expression} ${input.sort[index]!.direction.toUpperCase()} NULLS LAST`).join(", ")}
       LIMIT ${limitParameter}`,
      parameters,
    );
    const hasNextPage = rows.rows.length > input.limit;
    const selectedRows = hasNextPage ? rows.rows.slice(0, input.limit) : rows.rows;
    return {
      items: selectedRows.map((row) => ({
        document: projectionToRecord(collection, row),
        cursor: encodeDocumentQueryCursor(
          input.fingerprint,
          input.sort.map((_, index) =>
            canonicalDocumentQueryScalar(row[sortAliasNames[index]!])),
        ),
      })),
      hasNextPage,
    };
  }

  public async listPublishedDocuments(
    collection: CollectionDefinition,
    input: { readonly page: number; readonly pageSize: number },
  ): Promise<PublishedDocumentPage> {
    const offset = (input.page - 1) * input.pageSize;
    const predicate = `d.collection_id = $1
      AND d.deletion IS NULL
      AND d.lifecycle ->> 'kind' = 'active'
      AND d.publication IS NOT NULL`;
    const [rows, count] = await Promise.all([
      this.pool.query<PublishedDocumentRow>(
        `SELECT d.id, d.collection_id, d.created_at, d.created_by AS owner_subject_id,
                r.created_at AS updated_at,
                r.id AS revision_id, r.schema_revision_id, r.data,
                d.publication ->> 'publishedAt' AS published_at,
                d.publication ->> 'publishedBy' AS published_by
         FROM ${this.q("_xecms_documents")} d
         JOIN ${this.q("_xecms_document_revisions")} r
           ON r.id = d.publication ->> 'revisionId' AND r.document_id = d.id
         WHERE ${predicate}
         ORDER BY (d.publication ->> 'publishedAt')::timestamptz DESC, d.id ASC
         LIMIT $2 OFFSET $3`,
        [collection.id, input.pageSize, offset],
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM ${this.q("_xecms_documents")} d WHERE ${predicate}`,
        [collection.id],
      ),
    ]);
    return {
      items: rows.rows.map(publishedRowToRecord),
      page: input.page,
      pageSize: input.pageSize,
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  public async getPublishedDocument(
    collection: CollectionDefinition,
    documentId: string,
  ): Promise<PublishedDocumentRecord | null> {
    const result = await this.pool.query<PublishedDocumentRow>(
      `SELECT d.id, d.collection_id, d.created_at, d.created_by AS owner_subject_id,
              r.created_at AS updated_at,
              r.id AS revision_id, r.schema_revision_id, r.data,
              d.publication ->> 'publishedAt' AS published_at,
              d.publication ->> 'publishedBy' AS published_by
       FROM ${this.q("_xecms_documents")} d
       JOIN ${this.q("_xecms_document_revisions")} r
         ON r.id = d.publication ->> 'revisionId' AND r.document_id = d.id
       WHERE d.id = $1 AND d.collection_id = $2
         AND d.deletion IS NULL
         AND d.lifecycle ->> 'kind' = 'active'
         AND d.publication IS NOT NULL`,
      [documentId, collection.id],
    );
    const row = result.rows[0];
    return row === undefined ? null : publishedRowToRecord(row);
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }
}

