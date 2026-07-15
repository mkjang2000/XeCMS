import {
  asCollectionId,
  asDocumentId,
  extractDocumentRelations,
  planRelationTargetDeletion,
  type DocumentRelationEdge,
  type IncomingDocumentRelation,
  type JsonObject,
  type RelationDeletePlan,
  type RelationFieldContract,
} from "@xecms/core";
import type { CollectionDefinition, RelationFieldDefinition } from "@xecms/schema";
import { ApplicationError } from "./errors.js";

export interface RelationTargetIssue {
  readonly documentId: string;
  readonly expectedCollectionId: string;
  readonly actualCollectionId?: string;
  readonly reason: "not-found" | "deleted" | "collection-mismatch";
}

export type RelationReplaceResult =
  | { readonly status: "committed" }
  | {
      readonly status: "invalid-targets";
      readonly issues: readonly RelationTargetIssue[];
    };

export interface RelationStore {
  /**
   * Implementations must lock/validate every target and replace all source
   * edges atomically. A foreign key must point to stable document identity,
   * not a revision row.
   */
  validateAndReplaceDocumentRelations(input: {
    readonly sourceCollectionId: string;
    readonly sourceDocumentId: string;
    readonly expectedDocumentVersion: number;
    readonly edges: readonly DocumentRelationEdge[];
  }): Promise<RelationReplaceResult>;
  listIncomingDocumentRelations(input: {
    readonly targetCollectionId: string;
    readonly targetDocumentId: string;
  }): Promise<readonly IncomingDocumentRelation[]>;
}

export class RelationApplicationService {
  public constructor(
    private readonly store: RelationStore,
    private readonly maxReferencesPerDocument = 1_000,
  ) {
    if (!Number.isSafeInteger(maxReferencesPerDocument) || maxReferencesPerDocument < 1) {
      throw new TypeError("maxReferencesPerDocument must be a positive safe integer.");
    }
  }

  public async synchronizeDocument(input: {
    readonly collectionId: string;
    readonly documentId: string;
    readonly expectedDocumentVersion: number;
    readonly data: JsonObject;
    readonly relations: readonly RelationFieldContract[];
  }): Promise<readonly DocumentRelationEdge[]> {
    if (!Number.isSafeInteger(input.expectedDocumentVersion) || input.expectedDocumentVersion < 0) {
      throw new ApplicationError(
        "DOCUMENT_VERSION_INVALID",
        422,
        "expectedDocumentVersion must be a non-negative safe integer.",
      );
    }
    const edges = extractDocumentRelations({
      collectionId: asCollectionId(input.collectionId),
      documentId: asDocumentId(input.documentId),
      data: input.data,
      fields: input.relations,
      maxReferences: this.maxReferencesPerDocument,
    });
    const result = await this.store.validateAndReplaceDocumentRelations({
      sourceCollectionId: input.collectionId,
      sourceDocumentId: input.documentId,
      expectedDocumentVersion: input.expectedDocumentVersion,
      edges,
    });
    if (result.status === "invalid-targets") {
      throw new ApplicationError(
        "RELATION_TARGET_INVALID",
        422,
        "One or more relation targets do not exist in the configured collection.",
        { details: { issues: result.issues } },
      );
    }
    return edges;
  }

  public async planTargetDeletion(input: {
    readonly targetCollectionId: string;
    readonly targetDocumentId: string;
  }): Promise<RelationDeletePlan> {
    const incoming = await this.store.listIncomingDocumentRelations(input);
    return planRelationTargetDeletion(asDocumentId(input.targetDocumentId), incoming);
  }

  public async requireTargetDeletionAllowed(input: {
    readonly targetCollectionId: string;
    readonly targetDocumentId: string;
  }): Promise<RelationDeletePlan> {
    const plan = await this.planTargetDeletion(input);
    if (!plan.allowed) {
      throw new ApplicationError(
        "RELATION_DELETE_RESTRICTED",
        409,
        `Document '${input.targetDocumentId}' is referenced by ${plan.restrictedBy.length} restricted relation(s).`,
        { details: { restrictedBy: plan.restrictedBy } },
      );
    }
    return plan;
  }
}

export function relationContractsForCollection(
  collection: CollectionDefinition,
): readonly RelationFieldContract[] {
  return collection.fields
    .filter((field): field is RelationFieldDefinition => field.type === "relation")
    .map((field) => ({
      relationId: field.relationId,
      fieldName: field.name,
      sourceCollectionId: asCollectionId(collection.id),
      targetCollectionId: asCollectionId(field.targetCollectionId),
      cardinality: field.cardinality,
      required: field.required === true,
      onDelete: field.onDelete ?? "restrict",
    }));
}
