import { hasSchemaIdPrefix } from "./ids.js";

declare const schemaIdBrand: unique symbol;

type Brand<TValue, TName extends string> = TValue & { readonly [schemaIdBrand]: TName };

export type CollectionId = Brand<string, "CollectionId">;
export type FieldId = Brand<string, "FieldId">;
export type RelationId = Brand<string, "RelationId">;
export type ComponentId = Brand<string, "ComponentId">;
export type SchemaObjectId = CollectionId | FieldId | RelationId | ComponentId;

export interface SchemaIrV1 {
  readonly format: "xecms.schema";
  readonly formatVersion: 1;
  readonly collections: readonly CollectionDefinition[];
  readonly components?: readonly ComponentDefinition[];
}

export interface SchemaRevisionEnvelope {
  readonly revisionId: string;
  readonly parentRevisionId?: string;
  readonly schema: SchemaIrV1;
  readonly actorId: string;
  readonly createdAt: string;
  readonly hash: string;
}

export interface CollectionDefinition {
  readonly id: CollectionId;
  readonly name: string;
  /** Human-readable name. Changing it never changes API or storage identifiers. */
  readonly label?: string;
  readonly kind?: "collection" | "singleton";
  readonly fields: readonly FieldDefinition[];
  readonly hierarchy?: HierarchyDefinition;
  /**
   * Makes this collection the one profile collection for a Content Realm.
   * Credentials remain private identity data and are never collection fields.
   */
  readonly auth?: CollectionAuthDefinition;
}

export interface ComponentDefinition {
  readonly id: ComponentId;
  readonly name: string;
  readonly label?: string;
  readonly fields: readonly FieldDefinition[];
}

export interface HierarchyDefinition {
  readonly enabled: true;
  readonly maxDepth?: number;
  readonly ordering?: "manual" | "created-at" | "field";
  readonly orderingFieldId?: FieldId;
  readonly slugPath?: boolean;
  readonly permissionInheritance?: boolean;
}

export interface CollectionAuthDefinition {
  /** Auth is disabled by omitting the complete `auth` object. */
  readonly enabled: true;
  /** Instance-unique, lowercase portable slug for the Content Realm. */
  readonly realmKey: string;
  /** Top-level required, unique text fields accepted as login identifiers. */
  readonly identifierFieldIds: readonly FieldId[];
  readonly acceptSystemIdentities: boolean;
  readonly provisioning: "explicit" | "jit";
  /** Realm-local role IDs granted by provisioning. Empty means no implicit grant. */
  readonly defaultRoleIds: readonly string[];
}

export interface BaseFieldDefinition {
  readonly id: FieldId;
  readonly name: string;
  readonly label?: string;
  readonly required?: boolean;
  readonly unique?: boolean;
  readonly localized?: boolean;
  readonly readOnly?: boolean;
}

export interface TextFieldDefinition extends BaseFieldDefinition {
  readonly type: "text" | "textarea";
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly defaultValue?: string;
}

export interface NumberFieldDefinition extends BaseFieldDefinition {
  readonly type: "number";
  readonly minimum?: number;
  readonly maximum?: number;
  readonly integer?: boolean;
  readonly defaultValue?: number;
}

export interface BooleanFieldDefinition extends BaseFieldDefinition {
  readonly type: "boolean";
  readonly defaultValue?: boolean;
}

export interface DateTimeFieldDefinition extends BaseFieldDefinition {
  readonly type: "date" | "datetime";
  readonly defaultValue?: string;
}

export interface JsonFieldDefinition extends BaseFieldDefinition {
  readonly type: "json";
  readonly defaultValue?: unknown;
}

export interface SelectOption {
  readonly label: string;
  readonly value: string;
}

export interface SelectFieldDefinition extends BaseFieldDefinition {
  readonly type: "select" | "enum";
  readonly options: readonly SelectOption[];
  readonly multiple?: boolean;
  readonly defaultValue?: string | readonly string[];
}

export interface RelationFieldDefinition extends BaseFieldDefinition {
  readonly type: "relation";
  readonly relationId: RelationId;
  readonly targetCollectionId: CollectionId;
  readonly cardinality: "one" | "many";
  readonly onDelete?: "restrict" | "nullify" | "cascade";
}

export interface ObjectFieldDefinition extends BaseFieldDefinition {
  readonly type: "object";
  readonly fields: readonly FieldDefinition[];
}

export interface ArrayFieldDefinition extends BaseFieldDefinition {
  readonly type: "array";
  readonly fields: readonly FieldDefinition[];
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ComponentFieldDefinition extends BaseFieldDefinition {
  readonly type: "component";
  readonly componentId: ComponentId;
  readonly repeatable?: boolean;
}

export interface BlocksFieldDefinition extends BaseFieldDefinition {
  readonly type: "blocks";
  readonly allowedComponentIds: readonly ComponentId[];
}

export interface UploadFieldDefinition extends BaseFieldDefinition {
  readonly type: "upload";
  readonly multiple?: boolean;
  readonly acceptedMimeTypes?: readonly string[];
}

export interface RichTextFieldDefinition extends BaseFieldDefinition {
  readonly type: "rich-text";
  readonly editor?: string;
}

/** JSON values accepted by Schema JSON fields and rich-text attributes. */
export type SchemaJsonPrimitive = null | boolean | number | string;
export type SchemaJsonValue =
  | SchemaJsonPrimitive
  | readonly SchemaJsonValue[]
  | SchemaJsonObject;
export interface SchemaJsonObject {
  readonly [key: string]: SchemaJsonValue;
}

/**
 * Rich-text storage contract, version 2: a block tree in the shape BlockNote
 * documents serialize to.
 *
 * The envelope fixes the structural keys (`id`, `type`, `props`, `content`,
 * `children`) while leaving the block vocabulary to the editor, so new block
 * types don't require a server release. Version 1 (ProseMirror node trees) was
 * retired before any deployment stored data in it and is rejected outright.
 */
export type RichTextDocumentV2 = SchemaJsonObject & {
  readonly format: "xecms.rich-text";
  readonly formatVersion: 2;
  readonly content: readonly RichTextBlock[];
};

export type RichTextBlock = SchemaJsonObject & {
  readonly id: string;
  readonly type: string;
  readonly props?: SchemaJsonObject;
  /** Inline content list, or a table-content object; validated as bounded JSON. */
  readonly content?: SchemaJsonValue;
  readonly children?: readonly RichTextBlock[];
};

/** Storage shape used by a blocks field. Blocks are activated after M2-B. */
export type ComponentBlockValue = SchemaJsonObject & {
  readonly componentId: ComponentId;
  readonly data: SchemaJsonObject;
};

export type FieldDefinition =
  | TextFieldDefinition
  | NumberFieldDefinition
  | BooleanFieldDefinition
  | DateTimeFieldDefinition
  | JsonFieldDefinition
  | SelectFieldDefinition
  | RelationFieldDefinition
  | ObjectFieldDefinition
  | ArrayFieldDefinition
  | ComponentFieldDefinition
  | BlocksFieldDefinition
  | UploadFieldDefinition
  | RichTextFieldDefinition;

export type SchemaChangeSeverity = "safe" | "risky" | "destructive";

export interface SchemaChange {
  readonly kind:
    | "object-created"
    | "object-deleted"
    | "object-renamed"
    | "object-label-changed"
    | "field-type-changed"
    | "field-constraint-changed"
    | "field-owner-changed"
    | "relation-changed"
    | "collection-auth-changed";
  readonly objectId: SchemaObjectId;
  readonly objectType: "collection" | "component" | "field";
  readonly severity: SchemaChangeSeverity;
  readonly path: readonly string[];
  readonly before?: unknown;
  readonly after?: unknown;
}

function asSchemaId<T>(
  value: string,
  kind: "collection" | "field" | "relation" | "component",
  label: string,
): T {
  if (!hasSchemaIdPrefix(value, kind)) {
    throw new TypeError(`${label} is not a valid ${kind} schema object ID.`);
  }
  return value as T;
}

export const asCollectionId = (value: string): CollectionId =>
  asSchemaId<CollectionId>(value, "collection", "CollectionId");
export const asFieldId = (value: string): FieldId =>
  asSchemaId<FieldId>(value, "field", "FieldId");
export const asRelationId = (value: string): RelationId =>
  asSchemaId<RelationId>(value, "relation", "RelationId");
export const asComponentId = (value: string): ComponentId =>
  asSchemaId<ComponentId>(value, "component", "ComponentId");
