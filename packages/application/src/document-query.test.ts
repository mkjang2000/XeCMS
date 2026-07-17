import { describe, expect, it } from "vitest";
import { asCollectionId, asFieldId, type CollectionDefinition } from "@xecms/schema";
import { ApplicationError } from "./errors.js";
import {
  encodeDocumentQueryCursor,
  normalizeDocumentQuery,
  type DocumentQueryFilter,
} from "./document-query.js";

const collection: CollectionDefinition = {
  id: asCollectionId("col_articles"),
  name: "articles",
  fields: [
    { id: asFieldId("fld_title"), name: "title", type: "text" },
    { id: asFieldId("fld_score"), name: "score", type: "number" },
    { id: asFieldId("fld_featured"), name: "featured", type: "boolean" },
    { id: asFieldId("fld_published_at"), name: "publishedAt", type: "datetime" },
    { id: asFieldId("fld_metadata"), name: "metadata", type: "json" },
  ],
};

describe("Document Query Contract", () => {
  it("normalizes defaults and adds an ID tie-break sort", () => {
    const actual = normalizeDocumentQuery(collection, {
      sort: [{
        field: { kind: "data", fieldId: "fld_score" },
        direction: "desc",
      }],
    });

    expect(actual).toMatchObject({
      limit: 25,
      state: "active",
      sort: [
        { field: { kind: "data", fieldId: "fld_score" }, direction: "desc" },
        { field: { kind: "system", field: "id" }, direction: "asc" },
      ],
    });
  });

  it("accepts nested typed filters and a selected field projection", () => {
    const filter: DocumentQueryFilter = {
      type: "group",
      operator: "and",
      filters: [
        {
          type: "condition",
          field: { kind: "data", fieldId: "fld_title" },
          operator: "contains",
          value: "XeCMS",
        },
        {
          type: "group",
          operator: "or",
          filters: [
            {
              type: "condition",
              field: { kind: "data", fieldId: "fld_score" },
              operator: "gte",
              value: 10,
            },
            {
              type: "condition",
              field: { kind: "data", fieldId: "fld_featured" },
              operator: "eq",
              value: true,
            },
          ],
        },
      ],
    };

    const actual = normalizeDocumentQuery(collection, {
      limit: 40,
      fields: ["fld_title", "fld_score"],
      filter,
    });

    expect(actual.limit).toBe(40);
    expect(actual.fields).toEqual(["fld_title", "fld_score"]);
    expect(actual.filter).toEqual(filter);
  });

  it("rejects unknown and JSON-backed filter fields", () => {
    expectApplicationCode(
      () => normalizeDocumentQuery(collection, {
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: "fld_missing" },
          operator: "eq",
          value: "x",
        },
      }),
      "DOCUMENT_QUERY_FIELD_UNKNOWN",
    );
    expectApplicationCode(
      () => normalizeDocumentQuery(collection, {
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: "fld_metadata" },
          operator: "eq",
          value: "x",
        },
      }),
      "DOCUMENT_QUERY_FIELD_UNSUPPORTED",
    );
  });

  it("rejects incompatible operators and values", () => {
    expectApplicationCode(
      () => normalizeDocumentQuery(collection, {
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: "fld_featured" },
          operator: "contains",
          value: "true",
        },
      }),
      "DOCUMENT_QUERY_FIELD_UNSUPPORTED",
    );
    expectApplicationCode(
      () => normalizeDocumentQuery(collection, {
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: "fld_score" },
          operator: "gte",
          value: "10",
        },
      }),
      "DOCUMENT_QUERY_INVALID",
    );
    expectApplicationCode(
      () => normalizeDocumentQuery(collection, {
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: "fld_published_at" },
          operator: "gte",
          value: "not-a-date",
        },
      }),
      "DOCUMENT_QUERY_INVALID",
    );
    expectApplicationCode(
      () => normalizeDocumentQuery(collection, {
        filter: {
          type: "condition",
          field: { kind: "system", field: "version" },
          operator: "eq",
          value: 1.5,
        },
      }),
      "DOCUMENT_QUERY_INVALID",
    );
  });

  it("binds opaque cursors to the collection, state, filter and sort", () => {
    const first = normalizeDocumentQuery(collection, {
      state: "active",
      sort: [{
        field: { kind: "data", fieldId: "fld_score" },
        direction: "desc",
      }],
    });
    const cursor = encodeDocumentQueryCursor(first.fingerprint, [12, "doc_a"]);
    const resumed = normalizeDocumentQuery(collection, {
      state: "active",
      cursor,
      sort: [{
        field: { kind: "data", fieldId: "fld_score" },
        direction: "desc",
      }],
    });

    expect(resumed.cursorValues).toEqual([12, "doc_a"]);
    expectApplicationCode(
      () => normalizeDocumentQuery(collection, {
        state: "deleted",
        cursor,
        sort: [{
          field: { kind: "data", fieldId: "fld_score" },
          direction: "desc",
        }],
      }),
      "DOCUMENT_QUERY_CURSOR_INVALID",
    );
  });
});

function expectApplicationCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`Expected ApplicationError '${code}'.`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApplicationError);
    expect((error as ApplicationError).code).toBe(code);
  }
}
