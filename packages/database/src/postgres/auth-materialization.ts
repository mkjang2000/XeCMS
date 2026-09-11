import { qualifiedName } from "../identifiers.js";
import { DEFAULT_WORKSPACE_ID } from "../migrate.js";
import { ApplicationError } from "@xecms/application";
import {
  collectionAuthDefinitionsEqual,
  type CollectionAuthDefinition,
  type SchemaIrV1,
} from "@xecms/schema";
import type { PoolClient } from "pg";

export class PostgresAuthMaterialization {
  public constructor(private readonly schema: string) {}

  public async preflightAuthMaterialization(
    client: PoolClient,
    previous: SchemaIrV1,
    next: SchemaIrV1,
  ): Promise<readonly AuthMaterializationTransition[]> {
    // Prevent a document or Membership from appearing after the destructive
    // preflight and before the corresponding Realm configuration is committed.
    await client.query(`LOCK TABLE ${this.q("_xecms_documents")} IN SHARE MODE`);
    await client.query(`LOCK TABLE ${this.q("_xecms_realm_memberships")} IN SHARE MODE`);
    await client.query(
      `LOCK TABLE ${this.q("_xecms_auth_collection_configs")} IN SHARE ROW EXCLUSIVE MODE`,
    );

    const previousCollections = new Map(previous.collections.map((collection) => [String(collection.id), collection]));
    const nextCollections = new Map(next.collections.map((collection) => [String(collection.id), collection]));
    const collectionIds = [...new Set([
      ...previousCollections.keys(),
      ...nextCollections.keys(),
    ])].sort((left, right) => left.localeCompare(right, "en-US"));
    const candidates = collectionIds.flatMap((collectionId) => {
      const previousAuth = previousCollections.get(collectionId)?.auth;
      const nextAuth = nextCollections.get(collectionId)?.auth;
      if (previousAuth === undefined && nextAuth === undefined) return [];
      return [{ collectionId, previousAuth, nextAuth }];
    });

    const claimedRealmKeys = new Map<string, string>();
    for (const collection of next.collections) {
      if (collection.auth === undefined) continue;
      const previousCollectionId = claimedRealmKeys.get(collection.auth.realmKey);
      if (previousCollectionId !== undefined && previousCollectionId !== collection.id) {
        throw new ApplicationError(
          "SCHEMA_AUTH_REALM_PROFILE_CONFLICT",
          409,
          "A Content Realm can have only one profile Collection.",
          { details: { realmKey: collection.auth.realmKey, collectionIds: [previousCollectionId, collection.id] } },
        );
      }
      claimedRealmKeys.set(collection.auth.realmKey, String(collection.id));
    }

    const realmKeys = [...new Set(candidates.flatMap(({ previousAuth, nextAuth }) => [
      ...(previousAuth === undefined ? [] : [previousAuth.realmKey]),
      ...(nextAuth === undefined ? [] : [nextAuth.realmKey]),
    ]))];
    const realms = realmKeys.length === 0
      ? []
      : (await client.query<AuthMaterializationRealmRow>(
        `SELECT realm.id, realm.workspace_id, realm.realm_key, realm.kind, realm.status,
                realm.profile_collection_id, realm.accept_system_identities,
                realm.membership_provisioning, realm.default_role_ids,
                state.current_revision AS policy_revision,
                state.root_resource_id AS policy_root_resource_id
         FROM ${this.q("_xecms_realms")} AS realm
         LEFT JOIN ${this.q("_xecms_auth_policy_state")} AS state ON state.realm_id = realm.id
         WHERE realm.workspace_id = $1 AND realm.realm_key = ANY($2::text[])
         ORDER BY realm.id
         FOR UPDATE OF realm`,
        [DEFAULT_WORKSPACE_ID, realmKeys],
      )).rows;
    const realmsByKey = new Map(realms.map((realm) => [realm.realm_key, realm]));

    const relevantCollectionIds = candidates.map(({ collectionId }) => collectionId);
    const relevantRealmIds = realms.map(({ id }) => id);
    const configs = relevantCollectionIds.length === 0 && relevantRealmIds.length === 0
      ? []
      : (await client.query<AuthMaterializationConfigRow>(
        `SELECT collection_id, realm_id
         FROM ${this.q("_xecms_auth_collection_configs")}
         WHERE collection_id = ANY($1::text[]) OR realm_id = ANY($2::text[])
         ORDER BY collection_id
         FOR UPDATE`,
        [relevantCollectionIds, relevantRealmIds],
      )).rows;
    const configsByCollection = new Map(configs.map((config) => [config.collection_id, config]));
    const configsByRealm = new Map(configs.map((config) => [config.realm_id, config]));

    const membershipRealms = relevantRealmIds.length === 0
      ? new Set<string>()
      : new Set((await client.query<{ realm_id: string }>(
        `SELECT DISTINCT realm_id
         FROM ${this.q("_xecms_realm_memberships")}
         WHERE realm_id = ANY($1::text[])`,
        [relevantRealmIds],
      )).rows.map(({ realm_id }) => realm_id));
    const collectionsWithDocuments = relevantCollectionIds.length === 0
      ? new Set<string>()
      : new Set((await client.query<{ collection_id: string }>(
        `SELECT DISTINCT collection_id
         FROM ${this.q("_xecms_documents")}
         WHERE workspace_id = $1 AND collection_id = ANY($2::text[])`,
        [DEFAULT_WORKSPACE_ID, relevantCollectionIds],
      )).rows.map(({ collection_id }) => collection_id));

    const transitions: AuthMaterializationTransition[] = [];
    for (const candidate of candidates) {
      const previousRealm = candidate.previousAuth === undefined
        ? undefined
        : requireAuthRealm(realmsByKey, candidate.previousAuth.realmKey, candidate.collectionId);
      const nextRealm = candidate.nextAuth === undefined
        ? undefined
        : requireAuthRealm(realmsByKey, candidate.nextAuth.realmKey, candidate.collectionId);
      const changed = !collectionAuthDefinitionsEqual(candidate.previousAuth, candidate.nextAuth);

      if (
        candidate.previousAuth === undefined
        && candidate.nextAuth !== undefined
        && collectionsWithDocuments.has(candidate.collectionId)
      ) {
        throw new ApplicationError(
          "SCHEMA_AUTH_EXISTING_DOCUMENTS",
          409,
          "Auth cannot be enabled on a Collection that already contains Documents.",
          { details: { collectionId: candidate.collectionId } },
        );
      }

      const protectedMembershipChange = candidate.previousAuth !== undefined && changed && (
        candidate.nextAuth === undefined
        || candidate.previousAuth.realmKey !== candidate.nextAuth.realmKey
        || !sameStringValues(
          candidate.previousAuth.identifierFieldIds,
          candidate.nextAuth.identifierFieldIds,
        )
      );
      if (
        protectedMembershipChange
        && previousRealm !== undefined
        && membershipRealms.has(previousRealm.id)
      ) {
        throw new ApplicationError(
          "SCHEMA_AUTH_MEMBERSHIP_CONFLICT",
          409,
          "Auth cannot be disabled or relinked while the Realm has Memberships.",
          { details: { collectionId: candidate.collectionId, realmId: previousRealm.id } },
        );
      }

      if (previousRealm !== undefined) {
        const previousConfig = configsByRealm.get(previousRealm.id);
        if (previousConfig !== undefined && previousConfig.collection_id !== candidate.collectionId) {
          authProfileConflict(previousRealm, candidate.collectionId);
        }
        if (
          previousRealm.profile_collection_id !== null
          && previousRealm.profile_collection_id !== candidate.collectionId
        ) {
          authProfileConflict(previousRealm, candidate.collectionId);
        }
      }

      if (nextRealm !== undefined) {
        const targetConfig = configsByRealm.get(nextRealm.id);
        if (targetConfig !== undefined && targetConfig.collection_id !== candidate.collectionId) {
          authProfileConflict(nextRealm, candidate.collectionId);
        }
        if (
          nextRealm.profile_collection_id !== null
          && nextRealm.profile_collection_id !== candidate.collectionId
        ) {
          authProfileConflict(nextRealm, candidate.collectionId);
        }
        const collectionConfig = configsByCollection.get(candidate.collectionId);
        if (
          collectionConfig !== undefined
          && collectionConfig.realm_id !== nextRealm.id
          && collectionConfig.realm_id !== previousRealm?.id
        ) {
          throw new ApplicationError(
            "SCHEMA_AUTH_CONFIG_CONFLICT",
            409,
            "The Collection has an inconsistent Content Realm configuration.",
            { details: { collectionId: candidate.collectionId, realmId: collectionConfig.realm_id } },
          );
        }
        if (
          Number(nextRealm.policy_revision ?? 0) <= 0
          || nextRealm.policy_root_resource_id === null
        ) {
          throw new ApplicationError(
            "SCHEMA_AUTH_POLICY_UNINITIALIZED",
            409,
            "The Content Realm authorization policy must be initialized before auth is enabled.",
            { details: { collectionId: candidate.collectionId, realmId: nextRealm.id } },
          );
        }
      }

      transitions.push({
        collectionId: candidate.collectionId,
        changed,
        ...(candidate.previousAuth === undefined ? {} : { previousAuth: candidate.previousAuth }),
        ...(candidate.nextAuth === undefined ? {} : { nextAuth: candidate.nextAuth }),
        ...(previousRealm === undefined ? {} : { previousRealmId: previousRealm.id }),
        ...(nextRealm === undefined ? {} : { nextRealmId: nextRealm.id }),
      });
    }
    return transitions;
  }

  public async materializeCollectionAuth(
    client: PoolClient,
    transitions: readonly AuthMaterializationTransition[],
    schemaRevisionId: string,
    actorId: string,
    now: string,
  ): Promise<void> {
    for (const transition of transitions) {
      if (
        transition.previousRealmId !== undefined
        && (
          transition.nextRealmId === undefined
          || transition.nextRealmId !== transition.previousRealmId
        )
      ) {
        await client.query(
          `DELETE FROM ${this.q("_xecms_auth_collection_configs")}
           WHERE collection_id = $1 AND realm_id = $2`,
          [transition.collectionId, transition.previousRealmId],
        );
        await client.query(
          `UPDATE ${this.q("_xecms_realms")} AS realm
           SET profile_collection_id = NULL,
               status = 'disabled',
               revision = revision + 1,
               updated_at = $3,
               updated_by = $4
           WHERE realm.id = $2
             AND (realm.profile_collection_id IS NULL OR realm.profile_collection_id = $1)
             AND (realm.profile_collection_id IS NOT NULL OR realm.status <> 'disabled')`,
          [transition.collectionId, transition.previousRealmId, now, actorId],
        );
      }
    }

    for (const transition of transitions) {
      if (transition.nextAuth === undefined || transition.nextRealmId === undefined) continue;
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_collection_configs")}
           (collection_id, realm_id, identifier_field_ids, status, schema_revision_id,
            created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3::text[], 'active', $4, $5, $6, $5, $6)
         ON CONFLICT (collection_id) DO UPDATE SET
           realm_id = EXCLUDED.realm_id,
           identifier_field_ids = EXCLUDED.identifier_field_ids,
           status = 'active',
           schema_revision_id = EXCLUDED.schema_revision_id,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
        [transition.collectionId, transition.nextRealmId,
          [...transition.nextAuth.identifierFieldIds], schemaRevisionId, now, actorId],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_realms")} AS realm
         SET profile_collection_id = $1,
             accept_system_identities = $3,
             membership_provisioning = $4,
             default_role_ids = $5::text[],
             status = CASE WHEN realm.status = 'provisioning' THEN 'active' ELSE realm.status END,
             revision = revision + 1,
             updated_at = $6,
             updated_by = $7
         WHERE realm.id = $2
           AND (
             realm.profile_collection_id IS DISTINCT FROM $1
             OR realm.accept_system_identities IS DISTINCT FROM $3
             OR realm.membership_provisioning IS DISTINCT FROM $4
             OR realm.default_role_ids IS DISTINCT FROM $5::text[]
             OR realm.status = 'provisioning'
           )`,
        [transition.collectionId, transition.nextRealmId,
          transition.nextAuth.acceptSystemIdentities, transition.nextAuth.provisioning,
          [...transition.nextAuth.defaultRoleIds], now, actorId],
      );
    }
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }
}

export interface AuthMaterializationRealmRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly realm_key: string;
  readonly kind: "system" | "content";
  readonly status: "provisioning" | "active" | "disabled";
  readonly profile_collection_id: string | null;
  readonly accept_system_identities: boolean;
  readonly membership_provisioning: "explicit" | "jit";
  readonly default_role_ids: string[];
  readonly policy_revision: string | number | null;
  readonly policy_root_resource_id: string | null;
}

export interface AuthMaterializationConfigRow {
  readonly collection_id: string;
  readonly realm_id: string;
}

export interface AuthMaterializationTransition {
  readonly collectionId: string;
  readonly changed: boolean;
  readonly previousAuth?: CollectionAuthDefinition;
  readonly nextAuth?: CollectionAuthDefinition;
  readonly previousRealmId?: string;
  readonly nextRealmId?: string;
}

export function requireAuthRealm(
  realmsByKey: ReadonlyMap<string, AuthMaterializationRealmRow>,
  realmKey: string,
  collectionId: string,
): AuthMaterializationRealmRow {
  const realm = realmsByKey.get(realmKey);
  if (realm === undefined || realm.kind !== "content") {
    throw new ApplicationError(
      "SCHEMA_AUTH_REALM_NOT_FOUND",
      409,
      "Schema auth requires a pre-existing Content Realm in this Workspace.",
      { details: { realmKey, collectionId } },
    );
  }
  return realm;
}

export function authProfileConflict(realm: AuthMaterializationRealmRow, collectionId: string): never {
  throw new ApplicationError(
    "SCHEMA_AUTH_REALM_PROFILE_CONFLICT",
    409,
    "A Content Realm can have only one profile Collection.",
    {
      details: {
        realmId: realm.id,
        collectionId,
        currentProfileCollectionId: realm.profile_collection_id,
      },
    },
  );
}

export function sameStringValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
