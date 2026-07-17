import {
  createXeCmsClient,
  XeCmsApiError,
  type DocumentRecordDto,
  type DocumentRevisionDetailDto,
  type DocumentRevisionSummaryDto,
  type MediaRecordDto,
  type AuthorizationClient,
  type SchemaDraftEnvelopeDto,
  type SchemaRevisionEnvelopeDto,
  type XeCmsClient,
} from "@xecms/client";
import {
  asCollectionId,
  asComponentId,
  asFieldId,
  asRelationId,
  type CollectionDefinition,
  type FieldDefinition,
  type SchemaChange,
  type SchemaIrV1,
} from "@xecms/schema";
import {
  AdminApiError,
  type AdminApi,
  type AuthorizationAdminApi,
  type CollectionDetail,
  type CollectionDraftInput,
  type CollectionField,
  type CollectionSummary,
  type DocumentRecord,
  type DocumentRevisionDetail,
  type DocumentRevisionOrigin,
  type DocumentRevisionSummary,
  type MigrationChange,
  type MoveDocumentPreview,
} from "@xecms/admin";

const EMPTY_SCHEMA: SchemaIrV1 = {
  format: "xecms.schema",
  formatVersion: 1,
  collections: [],
};

interface WorkingSchema {
  readonly schema: SchemaIrV1;
  readonly baseRevisionId: string | null;
  readonly version: string;
  readonly isDraft: boolean;
}

function mapError(error: unknown): AdminApiError {
  if (error instanceof AdminApiError) return error;
  if (error instanceof XeCmsApiError) {
    return new AdminApiError({
      status: error.status,
      code: error.code,
      message: error.message,
      fieldErrors: error.fieldErrors,
      details: error.problem.details,
    });
  }
  if (error instanceof Error) {
    return new AdminApiError({ status: 0, code: "NETWORK_ERROR", message: error.message });
  }
  return new AdminApiError({ status: 0, code: "UNKNOWN_ERROR", message: "알 수 없는 오류가 발생했습니다." });
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapError(error);
  }
}

function conflict(message: string): AdminApiError {
  return new AdminApiError({ status: 409, code: "SCHEMA_DRAFT_CONFLICT", message });
}

function versionOfDraft(draft: SchemaDraftEnvelopeDto): string {
  return draft.draftVersion;
}

function versionOfRevision(revision: SchemaRevisionEnvelopeDto | null): string {
  return `applied:${revision?.revisionId ?? "empty"}`;
}

async function loadWorkingSchema(client: XeCmsClient): Promise<WorkingSchema> {
  const draft = await client.schema.getDraft();
  if (draft !== null) {
    return {
      schema: draft.schema,
      baseRevisionId: draft.baseRevisionId,
      version: versionOfDraft(draft),
      isDraft: true,
    };
  }
  const current = await client.schema.getCurrent();
  return {
    schema: current?.schema ?? EMPTY_SCHEMA,
    baseRevisionId: current?.revisionId ?? null,
    version: versionOfRevision(current),
    isDraft: false,
  };
}

function asAdminField(field: FieldDefinition): CollectionField {
  const mapped = {
    ...field,
    required: field.required ?? false,
    ...(field.type === "component" && field.repeatable ? { multiple: true } : {}),
    ...("fields" in field ? { fields: field.fields.map(asAdminField) } : {}),
  };
  return mapped as CollectionField;
}

function toDetail(
  collection: CollectionDefinition,
  options: {
    readonly status: "draft" | "applied";
    readonly hasPendingChanges: boolean;
    readonly revisionId: string | null;
    readonly version: string;
  },
): CollectionDetail {
  return {
    id: collection.id,
    name: collection.name,
    ...(collection.label === undefined ? {} : { label: collection.label }),
    status: options.status,
    hasPendingChanges: options.hasPendingChanges,
    revisionId: options.revisionId,
    kind: collection.kind ?? "collection",
    ...(collection.hierarchy === undefined ? {} : { hierarchy: collection.hierarchy }),
    ...(collection.auth === undefined ? {} : { auth: collection.auth }),
    fields: collection.fields.map(asAdminField),
    draftVersion: options.version,
  };
}

function toSummary(input: {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly fields: readonly unknown[];
  readonly status: "draft" | "applied";
  readonly hasPendingChanges: boolean;
  readonly revisionId: string | null;
}): CollectionSummary {
  return {
    id: input.id,
    name: input.name,
    ...(input.label === undefined ? {} : { label: input.label }),
    status: input.status,
    hasPendingChanges: input.hasPendingChanges,
    revisionId: input.revisionId,
    fieldCount: input.fields.length,
  };
}

function schemaField(
  field: CollectionDraftInput["fields"][number],
  id: string,
  relationId?: string,
): FieldDefinition {
  const base = {
    id: asFieldId(id),
    name: field.name,
    ...(field.label === undefined ? {} : { label: field.label }),
    ...(field.required ? { required: true as const } : {}),
    ...(field.unique ? { unique: true as const } : {}),
    ...(field.localized ? { localized: true as const } : {}),
    ...(field.readOnly ? { readOnly: true as const } : {}),
  };
  switch (field.type) {
    case "text":
    case "textarea": return {
      ...base,
      type: field.type,
      ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
      ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
      ...(typeof field.defaultValue === "string" ? { defaultValue: field.defaultValue } : {}),
    };
    case "number": return {
      ...base,
      type: "number",
      ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
      ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
      ...(field.integer ? { integer: true } : {}),
      ...(typeof field.defaultValue === "number" ? { defaultValue: field.defaultValue } : {}),
    };
    case "boolean": return { ...base, type: "boolean", ...(typeof field.defaultValue === "boolean" ? { defaultValue: field.defaultValue } : {}) };
    case "date": return { ...base, type: "date", ...(typeof field.defaultValue === "string" ? { defaultValue: field.defaultValue } : {}) };
    case "datetime": return { ...base, type: "datetime", ...(typeof field.defaultValue === "string" ? { defaultValue: field.defaultValue } : {}) };
    case "json": return { ...base, type: "json", ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }) };
    case "select":
    case "enum": return {
      ...base,
      type: field.type,
      options: field.options ?? [],
      ...(field.multiple ? { multiple: true } : {}),
      ...(typeof field.defaultValue === "string" || Array.isArray(field.defaultValue)
        ? { defaultValue: field.defaultValue as string | readonly string[] }
        : {}),
    };
    case "relation": {
      if (!field.targetCollectionId) throw new Error("Relation targetCollectionId is required.");
      const stableRelationId = field.relationId ?? relationId;
      if (!stableRelationId) throw new Error("The server did not issue a relation ID.");
      return {
        ...base,
        type: "relation",
        relationId: asRelationId(stableRelationId),
        targetCollectionId: asCollectionId(field.targetCollectionId),
        cardinality: field.cardinality ?? "one",
        onDelete: field.onDelete ?? "restrict",
      };
    }
    case "object": return {
      ...base,
      type: "object",
      fields: (field.fields ?? []).map((nested) => {
        if (!nested.id) throw new Error("Nested fields must have stable IDs; use the canonical manifest importer.");
        return schemaField(nested, nested.id);
      }),
    };
    case "array": return {
      ...base,
      type: "array",
      fields: (field.fields ?? []).map((nested) => {
        if (!nested.id) throw new Error("Nested fields must have stable IDs; use the canonical manifest importer.");
        return schemaField(nested, nested.id);
      }),
      ...(field.minItems === undefined ? {} : { minItems: field.minItems }),
      ...(field.maxItems === undefined ? {} : { maxItems: field.maxItems }),
    };
    case "component": {
      if (!field.componentId) throw new Error("Component ID is required.");
      return {
        ...base,
        type: "component",
        componentId: asComponentId(field.componentId),
        ...(field.multiple ? { repeatable: true } : {}),
      };
    }
    case "blocks": return {
      ...base,
      type: "blocks",
      allowedComponentIds: (field.allowedComponentIds ?? []).map(asComponentId),
    };
    case "upload": return {
      ...base,
      type: "upload",
      ...(field.multiple ? { multiple: true } : {}),
      ...(field.acceptedMimeTypes?.length ? { acceptedMimeTypes: field.acceptedMimeTypes } : {}),
    };
    case "rich-text": return {
      ...base,
      type: "rich-text",
      ...(field.editor ? { editor: field.editor } : {}),
    };
  }
}

async function materializeCollection(
  client: XeCmsClient,
  draft: CollectionDraftInput,
  collectionId?: string,
): Promise<CollectionDefinition> {
  const missingFields = draft.fields.filter(({ id }) => id === undefined).length;
  const missingRelations = draft.fields.filter(({ type, relationId }) => type === "relation" && !relationId).length;
  const [issuedCollection, issuedFields, issuedRelations] = await Promise.all([
    collectionId === undefined ? client.schema.issueIds({ kind: "collection", count: 1 }) : Promise.resolve({ ids: [] }),
    missingFields > 0 ? client.schema.issueIds({ kind: "field", count: missingFields }) : Promise.resolve({ ids: [] }),
    missingRelations > 0 ? client.schema.issueIds({ kind: "relation", count: missingRelations }) : Promise.resolve({ ids: [] }),
  ]);
  let fieldIndex = 0;
  let relationIndex = 0;
  const fields = draft.fields.map((field) => {
    const id = field.id ?? issuedFields.ids[fieldIndex++];
    if (id === undefined) throw new Error("The server did not issue enough field IDs.");
    const relationId = field.type === "relation" && !field.relationId
      ? issuedRelations.ids[relationIndex++]
      : undefined;
    return schemaField(field, id, relationId);
  });
  const id = collectionId ?? issuedCollection.ids[0];
  if (id === undefined) throw new Error("The server did not issue a collection ID.");
  return {
    id: asCollectionId(id),
    name: draft.name,
    ...(draft.label === undefined ? {} : { label: draft.label }),
    ...(draft.kind === undefined || draft.kind === "collection" ? {} : { kind: draft.kind }),
    ...(draft.hierarchy === undefined ? {} : {
      hierarchy: ({
        ...draft.hierarchy,
        ...(draft.hierarchy.orderingFieldId === undefined
          ? {}
          : { orderingFieldId: asFieldId(draft.hierarchy.orderingFieldId) }),
      }) as CollectionDefinition["hierarchy"],
    }),
    ...(draft.auth === undefined ? {} : {
      auth: {
        ...draft.auth,
        identifierFieldIds: draft.auth.identifierFieldIds.map(asFieldId),
      },
    }),
    fields,
  };
}

function replaceCollection(schema: SchemaIrV1, collection: CollectionDefinition): SchemaIrV1 {
  const index = schema.collections.findIndex(({ id }) => id === collection.id);
  const collections = index < 0
    ? [...schema.collections, collection]
    : schema.collections.map((item) => item.id === collection.id ? collection : item);
  return { ...schema, collections };
}

function describeChange(change: SchemaChange): string {
  const objectName = change.path.at(-1) ?? String(change.objectId);
  switch (change.kind) {
    case "object-created": return `'${objectName}'을(를) 생성합니다.`;
    case "object-deleted": return `'${objectName}'을(를) 삭제합니다.`;
    case "object-renamed": return `'${String(change.before)}'을(를) '${String(change.after)}'(으)로 변경합니다.`;
    case "object-label-changed": return `'${objectName}'의 표시 이름을 변경합니다.`;
    case "field-type-changed": return `'${objectName}' 필드 유형을 변경합니다.`;
    case "field-constraint-changed": return `'${objectName}' 필드 제약 조건을 변경합니다.`;
    case "field-owner-changed": return `'${objectName}' 필드의 소유 스키마를 변경합니다.`;
    case "relation-changed": return `'${objectName}' 관계 설정을 변경합니다.`;
    case "collection-auth-changed": return `'${change.path.at(-2) ?? objectName}' Collection의 콘텐츠 Realm 인증 설정을 변경합니다.`;
  }
}

function mapChange(change: SchemaChange, index: number): MigrationChange {
  return {
    id: `${String(change.objectId)}:${change.kind}:${index}`,
    kind: change.kind,
    path: change.path,
    description: describeChange(change),
    severity: change.severity,
  };
}

function mapDocument(document: DocumentRecordDto): DocumentRecord {
  return document;
}

function mapMedia(client: XeCmsClient, media: MediaRecordDto) {
  return { ...media, contentUrl: client.media.contentUrl(media.id) };
}

function mapRevisionOrigin(origin: DocumentRevisionSummaryDto["origin"]): DocumentRevisionOrigin {
  if (origin.kind === "restore") {
    return { kind: "restore", restoredFromRevisionId: origin.restoredFromRevisionId };
  }
  return origin.kind === "create" ? { kind: "create" } : { kind: "edit" };
}

function mapRevision(revision: DocumentRevisionSummaryDto): DocumentRevisionSummary {
  return { ...revision, origin: mapRevisionOrigin(revision.origin) };
}

function mapRevisionDetail(revision: DocumentRevisionDetailDto): DocumentRevisionDetail {
  return { ...mapRevision(revision), data: revision.data };
}

function createAuthorizationAdminApi(client: AuthorizationClient): AuthorizationAdminApi {
  return {
    getPolicy: () => call(() => client.getPolicy()),
    createSubject: (input) => call(() => client.createSubject(input)),
    addGroupMembership: (input) => call(() => client.addGroupMembership(input)),
    removeGroupMembership: (memberSubjectId, groupSubjectId, expectedPolicyRevision) => call(() =>
      client.removeGroupMembership(memberSubjectId, groupSubjectId, { expectedPolicyRevision })),
    createLevel: (input) => call(() => client.createLevel(input)),
    updateLevel: (levelId, input) => call(() => client.updateLevel(levelId, input)),
    deleteLevel: (levelId, expectedPolicyRevision) => call(() =>
      client.deleteLevel(levelId, { expectedPolicyRevision })),
    createRole: (input) => call(() => client.createRole(input)),
    updateRole: (roleId, input) => call(() => client.updateRole(roleId, input)),
    deleteRole: (roleId, expectedPolicyRevision) => call(() =>
      client.deleteRole(roleId, { expectedPolicyRevision })),
    createBinding: (input) => call(() => client.createBinding(input)),
    updateBinding: (bindingId, input) => call(() => client.updateBinding(bindingId, input)),
    deleteBinding: (bindingId, expectedPolicyRevision) => call(() =>
      client.deleteBinding(bindingId, { expectedPolicyRevision })),
    simulate: (input) => call(() => client.simulate(input)),
    listAudit: () => call(async () => ({ items: (await client.listAudit()).items })),
  };
}

export function createAdminApi(client: XeCmsClient = createXeCmsClient()): AdminApi {
  return {
    access: {
      evaluateBatch: (input) => call(() => client.access.evaluateBatch(input)),
    },
    auth: {
      getBootstrapStatus: () => call(() => client.auth.getBootstrapStatus()),
      bootstrap: (credentials) => call(async () => {
        const session = await client.auth.bootstrap(credentials);
        return { user: session.user };
      }),
      getSession: () => call(async () => {
        const session = await client.auth.getSession();
        return { user: session.user, ...(session.passwordChangeRequired === undefined ? {} : { passwordChangeRequired: session.passwordChangeRequired }) };
      }),
      login: (credentials) => call(async () => {
        const session = await client.auth.login(credentials);
        return { user: session.user, passwordChangeRequired: session.passwordChangeRequired };
      }),
      logout: () => call(() => client.auth.logout()),
      changePassword: (input) => call(() => client.auth.changePassword(input)),
    },
    settings:{diagnostics:()=>call(()=>client.settings.diagnostics()),getWorkspace:()=>call(()=>client.settings.getWorkspace()),updateWorkspace:(input)=>call(()=>client.settings.updateWorkspace(input))},
    sites:{list:()=>call(async()=>({items:(await client.sites.list()).items})),get:(id)=>call(()=>client.sites.get(id)),create:(input)=>call(()=>client.sites.create(input)),update:(id,input)=>call(()=>client.sites.update(id,input)),archive:(id,input)=>call(()=>client.sites.archive(id,input)),reactivate:(id,input)=>call(()=>client.sites.reactivate(id,input)),setDefault:(id,input)=>call(()=>client.sites.setDefault(id,input)),bindCollection:(id,c,input)=>call(()=>client.sites.bindCollection(id,c,input)),unbindCollection:(id,c,input)=>call(()=>client.sites.unbindCollection(id,c,input))},
    operations:{
      listAudit:(query)=>call(()=>client.operations.listAudit(query)),
      getAudit:(id)=>call(()=>client.operations.getAudit(id)),
      exportAudit:(query)=>call(()=>client.operations.exportAudit(query)),
      getRetentionPolicy:()=>call(()=>client.operations.getRetentionPolicy()),
      updateRetentionPolicy:(input)=>call(()=>client.operations.updateRetentionPolicy(input)),
      previewRetention:(expectedPolicyRevision)=>call(()=>client.operations.previewRetention({expectedPolicyRevision})),
      getRetentionPlan:(id)=>call(()=>client.operations.getRetentionPlan(id)),
      applyRetention:(id,input)=>call(()=>client.operations.applyRetention(id,input)),
      checkMediaConsistency:()=>call(async()=>{const result=await client.operations.checkMediaConsistency();return{missing:result.missing.map(item=>mapMedia(client,item)),orphanStorageKeys:result.orphanStorageKeys,incomplete:result.incomplete,healthyCount:result.healthyCount}}),
    },
    plugins:{catalog:()=>call(async()=>({items:(await client.plugins.catalog()).items})),list:()=>call(async()=>({items:(await client.plugins.list()).items})),get:(id)=>call(()=>client.plugins.get(id)),updateConfig:(id,input)=>call(()=>client.plugins.updateConfig(id,input)),preview:(input)=>call(()=>client.plugins.preview(input)),getPlan:(id)=>call(()=>client.plugins.getPlan(id)),apply:(id,input)=>call(()=>client.plugins.apply(id,input)),getExport:(id)=>call(()=>client.plugins.getExport(id)),extensions:()=>call(async()=>(await client.plugins.adminExtensions()).cards)},
    jobs: {
      list: (options) => call(() => client.jobs.list(options)),
      get: (deliveryId) => call(() => client.jobs.get(deliveryId)),
      retry: (deliveryId) => call(() => client.jobs.retry(deliveryId)),
      run: () => call(() => client.jobs.run()),
    },
    collections: {
      list: () => call(async () => {
        const result = await client.collections.list();
        return { items: result.items.map(toSummary) };
      }),
      get: (collectionId) => call(async () => {
        const [working, list] = await Promise.all([
          loadWorkingSchema(client),
          client.collections.list(),
        ]);
        const collection = working.schema.collections.find(({ id }) => id === collectionId);
        if (collection === undefined) {
          throw new AdminApiError({ status: 404, code: "COLLECTION_NOT_FOUND", message: "컬렉션을 찾을 수 없습니다." });
        }
        const summary = list.items.find(({ id }) => id === collectionId);
        return toDetail(collection, {
          status: summary?.status ?? (working.isDraft ? "draft" : "applied"),
          hasPendingChanges: summary?.hasPendingChanges ?? working.isDraft,
          revisionId: summary?.revisionId ?? working.baseRevisionId,
          version: working.version,
        });
      }),
      getApplied: (collectionId) => call(async () => {
        const [current, list] = await Promise.all([
          client.schema.getCurrent(),
          client.collections.list(),
        ]);
        if (current === null) {
          throw new AdminApiError({ status: 404, code: "COLLECTION_NOT_APPLIED", message: "아직 적용되지 않은 컬렉션입니다." });
        }
        const collection = current.schema.collections.find(({ id }) => id === collectionId);
        if (collection === undefined) {
          throw new AdminApiError({ status: 404, code: "COLLECTION_NOT_APPLIED", message: "아직 적용되지 않은 컬렉션입니다." });
        }
        const summary = list.items.find(({ id }) => id === collectionId);
        return toDetail(collection, {
          status: "applied",
          hasPendingChanges: summary?.hasPendingChanges ?? false,
          revisionId: current.revisionId,
          version: versionOfRevision(current),
        });
      }),
      create: (draft) => call(async () => {
        const working = await loadWorkingSchema(client);
        if (working.schema.collections.some(({ name }) => name === draft.name)) {
          throw new AdminApiError({
            status: 409,
            code: "COLLECTION_NAME_CONFLICT",
            message: "같은 이름의 컬렉션이 이미 있습니다.",
            fieldErrors: { name: "같은 이름의 컬렉션이 이미 있습니다." },
          });
        }
        const collection = await materializeCollection(client, draft);
        const saved = await client.schema.saveDraft({
          baseRevisionId: working.baseRevisionId,
          expectedDraftVersion: working.isDraft ? working.version : null,
          schema: replaceCollection(working.schema, collection),
        });
        return toDetail(collection, {
          status: "draft",
          hasPendingChanges: true,
          revisionId: saved.baseRevisionId,
          version: versionOfDraft(saved),
        });
      }),
      updateDraft: (collectionId, input) => call(async () => {
        const working = await loadWorkingSchema(client);
        if (working.version !== input.expectedDraftVersion) {
          throw conflict("Schema draft가 다른 사용자에 의해 변경되었습니다.");
        }
        const existing = working.schema.collections.find(({ id }) => id === collectionId);
        if (existing === undefined) {
          throw new AdminApiError({ status: 404, code: "COLLECTION_NOT_FOUND", message: "컬렉션을 찾을 수 없습니다." });
        }
        const nameConflict = working.schema.collections.some(
          ({ id, name }) => id !== collectionId && name === input.draft.name,
        );
        if (nameConflict) {
          throw new AdminApiError({
            status: 409,
            code: "COLLECTION_NAME_CONFLICT",
            message: "같은 이름의 컬렉션이 이미 있습니다.",
            fieldErrors: { name: "같은 이름의 컬렉션이 이미 있습니다." },
          });
        }
        const collection = await materializeCollection(client, input.draft, collectionId);
        const summaries = await client.collections.list();
        const previousSummary = summaries.items.find(({ id }) => id === collectionId);
        const saved = await client.schema.saveDraft({
          baseRevisionId: working.baseRevisionId,
          expectedDraftVersion: working.isDraft ? working.version : null,
          schema: replaceCollection(working.schema, collection),
        });
        return toDetail(collection, {
          status: previousSummary?.status ?? "draft",
          hasPendingChanges: true,
          revisionId: saved.baseRevisionId,
          version: versionOfDraft(saved),
        });
      }),
      preview: (collectionId, input) => call(async () => {
        const working = await loadWorkingSchema(client);
        if (!working.isDraft || working.version !== input.expectedDraftVersion) {
          throw conflict("검토하려던 Schema draft가 변경되었습니다.");
        }
        const preview = await client.schema.preview({ expectedDraftVersion: working.version });
        return {
          planId: preview.planId,
          collectionId,
          draftVersion: preview.draftVersion,
          baseRevisionId: preview.baseRevisionId,
          changes: preview.changes.map(mapChange),
          operations: preview.operations.map((operation) => ({
            id: operation.id,
            description: operation.summary,
            ...(operation.sql === undefined ? {} : { sql: operation.sql }),
          })),
          destructive: preview.requiresDestructiveApproval,
        };
      }),
      apply: (collectionId, input) => call(async () => {
        const working = await loadWorkingSchema(client);
        if (!working.isDraft || working.version !== input.expectedDraftVersion) {
          throw conflict("검토 이후 Schema draft가 변경되어 적용을 중단했습니다.");
        }
        const applied = await client.schema.apply({
          planId: input.planId,
          expectedRevisionId: working.baseRevisionId,
          expectedDraftVersion: input.expectedDraftVersion,
          approveDestructive: input.approveDestructive,
        });
        const collection = applied.schema.collections.find(({ id }) => id === collectionId);
        if (collection === undefined) {
          throw new AdminApiError({ status: 404, code: "COLLECTION_NOT_FOUND", message: "적용된 컬렉션을 찾을 수 없습니다." });
        }
        return toDetail(collection, {
          status: "applied",
          hasPendingChanges: false,
          revisionId: applied.revisionId,
          version: versionOfRevision(applied),
        });
      }),
    },
    documents: {
      list: (collectionId, options) => call(async () => {
        const result = await client.documents.list(collectionId, options);
        return {
          items: result.items.map(mapDocument),
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
        };
      }),
      query: (collectionId, input) => call(async () => {
        const result = await client.documents.query(collectionId, input);
        return {
          items: result.items.map(mapDocument),
          hasNextPage: result.hasNextPage,
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        };
      }),
      get: (collectionId, documentId) => call(async () => mapDocument(
        await client.documents.get(collectionId, documentId),
      )),
      create: (collectionId, input) => call(async () => {
        const active = await client.schema.getCurrent();
        const collection = active?.schema.collections.find(
          ({ id, name }) => String(id) === collectionId || name === collectionId,
        );
        const requiresPlacement = collection?.hierarchy?.enabled === true;
        if (!requiresPlacement && input.parentId === undefined && input.position === undefined) {
          return mapDocument(await client.documents.create(collectionId, { data: input.data }));
        }
        const tree = await client.documents.tree(collectionId);
        const parentId = input.parentId ?? null;
        const position = input.position ?? tree.items.filter((node) => node.parentId === parentId).length;
        return mapDocument(await client.documents.create(collectionId, {
          data: input.data,
          hierarchy: {
            parentId,
            position,
            expectedVersion: tree.version,
          },
        }));
      }),
      update: (collectionId, documentId, input) => call(async () => mapDocument(
        await client.documents.update(collectionId, documentId, input),
      )),
      delete: (collectionId, documentId, input) => call(() => client.documents.delete(collectionId, documentId, input)),
      publish: (collectionId, documentId, input) => call(async () => mapDocument(
        await client.documents.publish(collectionId, documentId, input),
      )),
      unpublish: (collectionId, documentId, input) => call(async () => mapDocument(
        await client.documents.unpublish(collectionId, documentId, input),
      )),
      restoreDeleted: (collectionId, documentId, input) => call(async () => mapDocument(
        await client.documents.restore(collectionId, documentId, input),
      )),
      purge: (collectionId, documentId, input) => call(() => client.documents.purge(collectionId, documentId, input)),
      tree: (collectionId, parentId) => call(async () => {
        const result = await client.documents.tree(collectionId, parentId);
        const flexible = result as typeof result & { readonly version?: number };
        return {
          items: result.items.map((node) => ({ ...node, document: mapDocument(node.document) })),
          version: flexible.version ?? 0,
        };
      }),
      previewMove: (collectionId, documentId, input) => call(() =>
        client.documents.previewMove(collectionId, documentId, input)),
      move: (collectionId, documentId, input) => call(async () => {
        const result = await client.documents.move(collectionId, documentId, input);
        const flexible = result as typeof result & {
          readonly version?: number;
          readonly policyRevision?: number;
          readonly permissionImpact?: MoveDocumentPreview["permissionImpact"];
        };
        return {
          ...result,
          node: { ...result.node, document: mapDocument(result.node.document) },
          version: flexible.version ?? input.expectedVersion + 1,
          policyRevision: flexible.policyRevision ?? input.expectedPolicyRevision,
          permissionImpact: flexible.permissionImpact ?? null,
        };
      }),
    },
    schemaArtifacts: {
      exportManifest: () => call(async () => {
        const result = await client.schema.exportManifest();
        const flexible = result as typeof result & { readonly contents?: string };
        return {
          schema: result.schema,
          serialized: flexible.serialized ?? flexible.contents ?? JSON.stringify(result.schema, null, 2),
          hash: result.hash,
        };
      }),
      importManifest: (input) => call(async () => {
        const working = await loadWorkingSchema(client);
        await client.schema.importManifest({
          baseRevisionId: working.baseRevisionId,
          expectedDraftVersion: working.isDraft ? working.version : null,
          schema: input.schema as SchemaIrV1,
        });
      }),
      generateTypes: () => call(async () => {
        const result = await client.schema.generateTypes();
        const flexible = result as typeof result & { readonly contents?: string };
        return {
          fileName: result.fileName,
          source: flexible.source ?? flexible.contents ?? "",
          hash: result.hash,
        };
      }),
    },
    media: {
      list: () => call(async () => ({
        items: (await client.media.list()).items.map((item) => mapMedia(client, item)),
      })),
      upload: (file) => call(async () => mapMedia(client, await client.media.upload({ file, fileName: file.name }))),
      delete: (mediaId) => call(() => client.media.delete(mediaId)),
      checkConsistency: () => call(async () => {
        const result = await client.media.checkConsistency();
        return {
          missing: result.missing.map((item) => mapMedia(client, item)),
          orphanStorageKeys: result.orphanStorageKeys,
          incomplete: result.incomplete,
          healthyCount: result.healthyCount,
        };
      }),
    },
    revisions: {
      list: (collectionId, documentId) => call(async () => {
        const result = await client.revisions.list(collectionId, documentId);
        return {
          items: result.items.map(mapRevision),
          documentVersion: result.documentVersion,
        };
      }),
      get: (collectionId, documentId, revisionId) => call(async () => mapRevisionDetail(
        await client.revisions.get(collectionId, documentId, revisionId),
      )),
      restore: (collectionId, documentId, revisionId, input) => call(async () => mapDocument(
        await client.revisions.restore(collectionId, documentId, revisionId, input),
      )),
    },
    identities: {
      list: (options) => call(async () => {
        const result = await client.identities.list(options);
        return {
          items: result.items,
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        };
      }),
      get: (identityId) => call(() => client.identities.get(identityId)),
      create: (input) => call(() => client.identities.create(input)),
      update: (identityId, input) => call(() => client.identities.update(identityId, input)),
      disable: (identityId, expectedRevision) => call(() =>
        client.identities.disable(identityId, { expectedRevision })),
      reactivate: (identityId, expectedRevision) => call(() =>
        client.identities.reactivate(identityId, { expectedRevision })),
      resetCredentials: (identityId, input) => call(() =>
        client.identities.resetCredentials(identityId, input)),
      createInvitation: (identityId, input) => call(() => client.identities.createInvitation(identityId, input)),
      createResetToken: (identityId, input) => call(() => client.identities.createResetToken(identityId, input)),
      createSystemMembership: (identityId, expectedRevision) => call(() =>
        client.identities.createSystemMembership(identityId, { expectedRevision })),
      listSessions: (identityId, options) => call(async () => {
        const result = await client.identities.listSessions(identityId, options);
        return {
          items: result.items,
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
        };
      }),
      revokeSession: (sessionId) => call(() => client.identities.revokeSession(sessionId)),
      revokeAllSessions: (identityId) => call(async () =>
        (await client.identities.revokeAllSessions(identityId)).revokedCount),
      transferOwner: (input) => call(() => client.identities.transferOwner(input)),
      createService: (input) => call(() => client.identities.createService(input)),
      listApiKeys: (identityId) => call(async () => ({
        items: (await client.identities.listApiKeys(identityId)).items,
      })),
      createApiKey: (identityId, input) => call(() => client.identities.createApiKey(identityId, input)),
      revokeApiKey: (apiKeyId) => call(() => client.identities.revokeApiKey(apiKeyId)),
    },
    identityRealms: {
      listGlobalIdentities: () => call(async () => ({
        items: (await client.identityRealms.listGlobalIdentities()).items,
      })),
      list: () => call(async () => ({
        items: (await client.identityRealms.list()).items,
      })),
      get: (realmId) => call(() => client.identityRealms.get(realmId)),
      create: (input) => call(() => client.identityRealms.create(input)),
      update: (realmId, input) => call(() => client.identityRealms.update(realmId, input)),
      listMemberships: (realmId) => call(async () => ({
        items: (await client.identityRealms.listMemberships(realmId)).items,
      })),
      provisionMembership: (realmId, input) => call(() =>
        client.identityRealms.provisionMembership(realmId, input)),
      suspendMembership: (realmId, membershipId, expectedRevision) => call(() =>
        client.identityRealms.suspendMembership(realmId, membershipId, { expectedRevision })),
      reactivateMembership: (realmId, membershipId, expectedRevision) => call(() =>
        client.identityRealms.reactivateMembership(realmId, membershipId, { expectedRevision })),
      listFullAccess: (realmId) => call(async () => ({
        items: (await client.identityRealms.listFullAccess(realmId)).items,
      })),
      grantFullAccess: (realmId, input) => call(() =>
        client.identityRealms.grantFullAccess(realmId, input)),
      revokeFullAccess: (realmId, bindingId, password) => call(() =>
        client.identityRealms.revokeFullAccess(realmId, bindingId, { password })),
      authorizationFor: (realmId) => createAuthorizationAdminApi(
        client.identityRealms.authorizationFor(realmId),
      ),
    },
    authorization: createAuthorizationAdminApi(client.authorization),
  };
}
