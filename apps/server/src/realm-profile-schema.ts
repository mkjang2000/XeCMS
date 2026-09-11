import {
  ApplicationError,
  IdentityRealmApplicationService,
  SchemaApplicationService,
  type ActorContext,
} from "@xecms/application";
import type { CreateRealmProfileFieldRequest, CreateRealmProfileSchemaRequest } from "@xecms/contracts";
import { PostgresIdentityRealmStore } from "@xecms/database";
import { serializeSchema, type CollectionDefinition, type SchemaIrV1 } from "@xecms/schema";
import { type ServerConfig } from "./config.js";
import { assertSchemaMutationAllowed } from "./request-input.js";
import type { SchemaProjectionCoordinator } from "./schema-projection.js";

interface Options {
  readonly config: ServerConfig;
  readonly identityRealms: IdentityRealmApplicationService;
  readonly identityRealmStore: PostgresIdentityRealmStore;
  readonly schema: SchemaApplicationService;
  readonly applySchemaWithProjection: SchemaProjectionCoordinator["applySchemaWithProjection"];
}

export function createRealmProfileSchemaCommands(options: Options) {
  const { config, identityRealms, identityRealmStore, schema, applySchemaWithProjection } = options;

  const createDefaultRealmProfileSchema = async (
    actor: ActorContext,
    input: CreateRealmProfileSchemaRequest & { readonly realmId: string },
  ) => {
    assertSchemaMutationAllowed(config, "editor");
    const realm = (await identityRealms.listRealms(actor)).find(({ id }) => id === input.realmId);
    if (realm === undefined || realm.kind !== "content") {
      throw new ApplicationError("IDENTITY_REALM_NOT_FOUND", 404, "The Content Realm does not exist.");
    }
    if (realm.profileCollectionId !== undefined) return realm;
    if (realm.status !== "provisioning") {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        409,
        "Only a provisioning Content Realm can create a default Profile Schema.",
      );
    }

    const [active, draft] = await Promise.all([schema.getActive(actor), schema.getDraft(actor)]);
    const activeSchema: SchemaIrV1 = active?.schema ?? {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [],
    };
    const activeProfile = activeSchema.collections.find(
      ({ auth: definition }) => definition?.realmKey === realm.key,
    );
    if (activeProfile !== undefined) {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        409,
        "The Realm Auth Collection is already applied but the Realm activation is incomplete.",
      );
    }

    const draftedProfile = draft?.schema.collections.find(
      ({ auth: definition }) => definition?.realmKey === realm.key,
    );
    let workingDraft = draft;
    if (draftedProfile !== undefined && draft !== null) {
      const draftWithoutProfile = {
        ...draft.schema,
        collections: draft.schema.collections.filter(({ id }) => id !== draftedProfile.id),
      };
      if (serializeSchema(draftWithoutProfile) !== serializeSchema(activeSchema)) {
        throw new ApplicationError(
          "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT",
          409,
          "Apply or discard the other pending Schema changes before creating the Realm Profile Schema.",
        );
      }
      const draftedIdentifierId = draftedProfile.auth?.identifierFieldIds[0];
      const draftedIdentifier = draftedProfile.fields.find(({ id }) => id === draftedIdentifierId);
      const expectedFieldCount = input.includeDisplayName ? 2 : 1;
      const matchesRequest = draftedProfile.name === input.collectionName
        && draftedProfile.label === input.collectionLabel
        && draftedProfile.fields.length === expectedFieldCount
        && draftedIdentifier?.name === input.identifierFieldName
        && draftedProfile.auth?.identifierFieldIds.length === 1
        && draftedProfile.fields.some(({ name }) => name === "displayName") === input.includeDisplayName;
      if (!matchesRequest) {
        throw new ApplicationError(
          "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT",
          409,
          "The pending Realm Profile Schema was created with different quick setup values.",
        );
      }
    } else {
      if (draft !== null && serializeSchema(draft.schema) !== serializeSchema(activeSchema)) {
        throw new ApplicationError(
          "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT",
          409,
          "Apply or discard the pending Schema changes before creating the Realm Profile Schema.",
        );
      }
      if (activeSchema.collections.some(({ name }) => name === input.collectionName)) {
        throw new ApplicationError(
          "COLLECTION_NAME_CONFLICT",
          409,
          `Collection '${input.collectionName}' already exists.`,
        );
      }
      const fieldCount = input.includeDisplayName ? 2 : 1;
      const [collectionIds, fieldIds] = await Promise.all([
        schema.issueIds(actor, { kind: "collection", count: 1 }),
        schema.issueIds(actor, { kind: "field", count: fieldCount }),
      ]);
      const collectionId = collectionIds[0];
      const identifierFieldId = fieldIds[0];
      if (collectionId === undefined || identifierFieldId === undefined) {
        throw new ApplicationError("SCHEMA_ID_REQUEST_INVALID", 500, "Stable Schema IDs were not issued.");
      }
      const fields = [{
        id: identifierFieldId,
        name: input.identifierFieldName,
        label: "Login ID",
        type: "text" as const,
        required: true,
        unique: true,
      }];
      const displayNameFieldId = fieldIds[1];
      if (input.includeDisplayName && displayNameFieldId !== undefined) {
        fields.push({
          id: displayNameFieldId,
          name: "displayName",
          label: "Display name",
          type: "text",
          required: false,
          unique: false,
        });
      }
      const profileCollection = {
        id: collectionId,
        name: input.collectionName,
        label: input.collectionLabel,
        fields,
        auth: {
          enabled: true as const,
          realmKey: realm.key,
          identifierFieldIds: [identifierFieldId],
          acceptSystemIdentities: realm.authentication.acceptSystemIdentities,
          provisioning: realm.authentication.provisioning,
          defaultRoleIds: realm.authentication.defaultRoleIds,
        },
      } as unknown as CollectionDefinition;
      workingDraft = await schema.saveDraft(actor, {
        baseRevisionId: active?.revisionId ?? null,
        expectedDraftVersion: draft?.draftVersion ?? null,
        schema: { ...activeSchema, collections: [...activeSchema.collections, profileCollection] },
      });
    }

    if (workingDraft === null) {
      throw new ApplicationError("SCHEMA_DRAFT_NOT_FOUND", 404, "No Realm Profile Schema draft exists.");
    }
    const preview = await schema.preview(actor, { expectedDraftVersion: workingDraft.draftVersion });
    if (preview.requiresDestructiveApproval) {
      throw new ApplicationError(
        "SCHEMA_QUICK_SETUP_DESTRUCTIVE",
        409,
        "Quick setup cannot apply destructive Schema changes.",
      );
    }
    await applySchemaWithProjection(actor, {
      expectedRevisionId: preview.baseRevisionId,
      expectedDraftVersion: preview.draftVersion,
      planId: preview.planId,
      approveDestructive: false,
    });
    const activated = await identityRealmStore.getRealmById(realm.id);
    if (activated === null || activated.status !== "active" || activated.profileCollectionId === undefined) {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        503,
        "The Realm did not activate after applying its Profile Schema.",
      );
    }
    return activated;
  };
  const createDefaultRealmProfileField = async (
    actor: ActorContext,
    input: CreateRealmProfileFieldRequest & { readonly realmId: string },
  ) => {
    assertSchemaMutationAllowed(config, "editor");
    const realm = (await identityRealms.listRealms(actor)).find(({ id }) => id === input.realmId);
    if (realm === undefined || realm.kind !== "content") {
      throw new ApplicationError("IDENTITY_REALM_NOT_FOUND", 404, "The Content Realm does not exist.");
    }
    if (realm.profileCollectionId === undefined) {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        409,
        "Create and apply the Realm Profile Schema before adding Profile fields.",
      );
    }
    if (realm.status !== "active") {
      throw new ApplicationError(
        "IDENTITY_REALM_DISABLED",
        409,
        "Enable the Content Realm before adding Profile fields.",
      );
    }

    const [active, draft] = await Promise.all([schema.getActive(actor), schema.getDraft(actor)]);
    if (active === null) {
      throw new ApplicationError("SCHEMA_REVISION_NOT_FOUND", 404, "No active Schema exists.");
    }
    if (draft !== null && serializeSchema(draft.schema) !== serializeSchema(active.schema)) {
      throw new ApplicationError(
        "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT",
        409,
        "Apply or discard the pending Schema changes before adding a Realm Profile field.",
      );
    }
    const profile = active.schema.collections.find(({ id }) => id === realm.profileCollectionId);
    if (profile === undefined || profile.auth?.realmKey !== realm.key) {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        409,
        "The Realm Profile Collection is not configured as its Auth Collection.",
      );
    }

    const normalizedName = input.name.toLocaleLowerCase("en-US");
    const existingField = profile.fields.find(
      ({ name }) => name.toLocaleLowerCase("en-US") === normalizedName,
    );
    if (existingField !== undefined) {
      const isIdentifier = profile.auth.identifierFieldIds.includes(existingField.id);
      if (!isIdentifier
        && existingField.name === input.name
        && existingField.label === input.label
        && existingField.type === input.type
        && existingField.required !== true) {
        return realm;
      }
      throw new ApplicationError(
        "PROFILE_FIELD_NAME_CONFLICT",
        409,
        `Profile field '${input.name}' already exists with different settings.`,
      );
    }

    const [fieldId] = await schema.issueIds(actor, { kind: "field", count: 1 });
    if (fieldId === undefined) {
      throw new ApplicationError("SCHEMA_ID_REQUEST_INVALID", 500, "A stable Field ID was not issued.");
    }
    const updatedProfile = {
      ...profile,
      fields: [...profile.fields, {
        id: fieldId,
        name: input.name,
        label: input.label,
        type: input.type,
        required: false,
        unique: false,
      }],
    } as unknown as CollectionDefinition;
    const workingDraft = await schema.saveDraft(actor, {
      baseRevisionId: active.revisionId,
      expectedDraftVersion: draft?.draftVersion ?? null,
      schema: {
        ...active.schema,
        collections: active.schema.collections.map((collection) =>
          collection.id === profile.id ? updatedProfile : collection),
      },
    });
    const preview = await schema.preview(actor, { expectedDraftVersion: workingDraft.draftVersion });
    if (preview.requiresDestructiveApproval) {
      throw new ApplicationError(
        "SCHEMA_QUICK_SETUP_DESTRUCTIVE",
        409,
        "A Realm Profile field quick addition must not require destructive approval.",
      );
    }
    await applySchemaWithProjection(actor, {
      expectedRevisionId: preview.baseRevisionId,
      expectedDraftVersion: preview.draftVersion,
      planId: preview.planId,
      approveDestructive: false,
    });
    return (await identityRealmStore.getRealmById(realm.id)) ?? realm;
  };
  return { createDefaultRealmProfileSchema, createDefaultRealmProfileField };
}
