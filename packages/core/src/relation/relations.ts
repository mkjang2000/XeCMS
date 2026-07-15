import {
  createDocumentReference,
  decodeDocumentReference,
} from "../document/references.js";
import { DocumentDomainError } from "../document/errors.js";
import { RelationDomainError, type RelationErrorCode } from "./errors.js";
import type {
  CollectionId,
  DocumentId,
  DocumentReference,
  JsonObject,
} from "../document/types.js";
import { asDocumentId } from "../document/types.js";
import type {
  DocumentRelationEdge,
  IncomingDocumentRelation,
  RelationDeletePlan,
  RelationFieldContract,
  RelationNullification,
} from "./types.js";

export interface ExtractDocumentRelationsInput {
  readonly collectionId: CollectionId;
  readonly documentId: DocumentId;
  readonly data: JsonObject;
  readonly fields: readonly RelationFieldContract[];
  readonly maxReferences?: number;
}

export function extractDocumentRelations(
  input: ExtractDocumentRelationsInput,
): readonly DocumentRelationEdge[] {
  const maxReferences = input.maxReferences ?? 1_000;
  if (!Number.isSafeInteger(maxReferences) || maxReferences < 1) {
    throw new TypeError("maxReferences must be a positive safe integer.");
  }
  const edges: DocumentRelationEdge[] = [];
  for (const field of input.fields) {
    if (field.sourceCollectionId !== input.collectionId) {
      relationError(
        "RELATION_SOURCE_COLLECTION_MISMATCH",
        [field.fieldName],
        `Relation '${field.relationId}' belongs to another source collection.`,
      );
    }
    const references = decodeFieldReferences(field, input.data[field.fieldName], maxReferences);
    references.forEach((reference, ordinal) => {
      edges.push(Object.freeze({
        relationId: field.relationId,
        fieldName: field.fieldName,
        sourceCollectionId: input.collectionId,
        sourceDocumentId: input.documentId,
        targetCollectionId: field.targetCollectionId,
        targetDocumentId: reference.documentId,
        ordinal,
        onDelete: field.onDelete,
      }));
    });
  }
  if (edges.length > maxReferences) {
    relationError(
      "RELATION_REFERENCE_LIMIT_EXCEEDED",
      [],
      `Document contains ${edges.length} relations; the limit is ${maxReferences}.`,
    );
  }
  return Object.freeze(edges);
}

export function planRelationTargetDeletion(
  targetDocumentId: DocumentId,
  incoming: readonly IncomingDocumentRelation[],
): RelationDeletePlan {
  const matching = incoming.filter(({ edge }) => edge.targetDocumentId === targetDocumentId);
  const restrictedBy = matching
    .filter(({ edge }) => edge.onDelete === "restrict")
    .map(({ edge }) => edge);
  const nullifications = matching
    .filter(({ edge }) => edge.onDelete === "nullify")
    .map(({ edge, sourceData }) => nullificationFor(edge, sourceData, targetDocumentId));
  const cascadeIds = new Map<string, { collectionId: CollectionId; documentId: DocumentId }>();
  matching
    .filter(({ edge }) => edge.onDelete === "cascade")
    .forEach(({ edge }) => {
      cascadeIds.set(`${edge.sourceCollectionId}\u0000${edge.sourceDocumentId}`, {
        collectionId: edge.sourceCollectionId,
        documentId: edge.sourceDocumentId,
      });
    });
  return Object.freeze({
    allowed: restrictedBy.length === 0,
    restrictedBy: Object.freeze(restrictedBy),
    nullifications: Object.freeze(nullifications),
    cascades: Object.freeze([...cascadeIds.values()]),
  });
}

function decodeFieldReferences(
  field: RelationFieldContract,
  value: unknown,
  maxReferences: number,
): readonly DocumentReference[] {
  if (value === undefined || value === null) {
    if (field.required) {
      relationError("RELATION_REQUIRED", [field.fieldName], `Relation '${field.fieldName}' is required.`);
    }
    return [];
  }
  const rawValues = field.cardinality === "many"
    ? requireArray(value, field.fieldName)
    : requireSingle(value, field.fieldName);
  if (rawValues.length > maxReferences) {
    relationError(
      "RELATION_REFERENCE_LIMIT_EXCEEDED",
      [field.fieldName],
      `Relation '${field.fieldName}' exceeds the ${maxReferences} reference limit.`,
    );
  }
  const seen = new Set<string>();
  return rawValues.map((rawValue, index) => {
    let reference: DocumentReference;
    try {
      reference = decodeRelationInput(rawValue, field.targetCollectionId);
    } catch (error) {
      if (error instanceof DocumentDomainError) {
        const childPath = error.details?.["path"];
        throw new DocumentDomainError(error.code, error.message, {
          ...error.details,
          path: [field.fieldName, ...(field.cardinality === "many" ? [index] : []),
            ...(Array.isArray(childPath) ? childPath : [])],
        });
      }
      throw error;
    }
    if (reference.collectionId !== field.targetCollectionId) {
      relationError(
        "RELATION_TARGET_COLLECTION_MISMATCH",
        [field.fieldName, ...(field.cardinality === "many" ? [index] : []), "collectionId"],
        `Relation '${field.fieldName}' must target collection '${field.targetCollectionId}'.`,
      );
    }
    const identity = `${reference.collectionId}\u0000${reference.documentId}`;
    if (seen.has(identity)) {
      relationError(
        "RELATION_DUPLICATE_TARGET",
        [field.fieldName, ...(field.cardinality === "many" ? [index] : [])],
        `Relation '${field.fieldName}' contains duplicate document '${reference.documentId}'.`,
      );
    }
    seen.add(identity);
    return reference;
  });
}

function requireArray(value: unknown, fieldName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    relationError("RELATION_CARDINALITY_MISMATCH", [fieldName], `Relation '${fieldName}' must be an array.`);
  }
  return value;
}

function requireSingle(value: unknown, fieldName: string): readonly unknown[] {
  if (Array.isArray(value)) {
    relationError("RELATION_CARDINALITY_MISMATCH", [fieldName], `Relation '${fieldName}' accepts one document.`);
  }
  return [value];
}

function nullificationFor(
  edge: DocumentRelationEdge,
  sourceData: JsonObject,
  targetDocumentId: DocumentId,
): RelationNullification {
  const value = sourceData[edge.fieldName];
  if (Array.isArray(value)) {
    const next = value
      .map((entry) => decodeRelationInput(entry, edge.targetCollectionId))
      .filter(({ documentId }) => documentId !== targetDocumentId)
      .map(({ documentId }) => String(documentId));
    return Object.freeze({
      sourceCollectionId: edge.sourceCollectionId,
      sourceDocumentId: edge.sourceDocumentId,
      relationId: edge.relationId,
      fieldName: edge.fieldName,
      nextValue: Object.freeze(next),
    });
  }
  return Object.freeze({
    sourceCollectionId: edge.sourceCollectionId,
    sourceDocumentId: edge.sourceDocumentId,
    relationId: edge.relationId,
    fieldName: edge.fieldName,
    nextValue: null,
  });
}

function decodeRelationInput(
  value: unknown,
  targetCollectionId: CollectionId,
): DocumentReference {
  if (typeof value === "string") {
    return createDocumentReference({
      collectionId: targetCollectionId,
      documentId: asDocumentId(value),
    });
  }
  return decodeDocumentReference(value);
}

function relationError(
  code: RelationErrorCode,
  path: readonly (string | number)[],
  message: string,
): never {
  throw new RelationDomainError(code, message, { path });
}
