import { describe, expect, it } from "vitest";

import {
  asCollectionId,
  asFieldId,
  decodeSchema,
  diffSchemas,
  normalizeSchema,
  parseSchema,
  SchemaDecodeError,
  SchemaValidationError,
  serializeSchema,
  validateSchema,
  type CollectionAuthDefinition,
  type SchemaIrV1,
} from "./index.js";

function authDefinition(
  overrides: Partial<CollectionAuthDefinition> = {},
): CollectionAuthDefinition {
  return {
    enabled: true,
    realmKey: "community",
    identifierFieldIds: [asFieldId("fld_member_email")],
    acceptSystemIdentities: true,
    provisioning: "explicit",
    defaultRoleIds: [],
    ...overrides,
  };
}

function authSchema(
  overrides: Partial<SchemaIrV1["collections"][number]> = {},
): SchemaIrV1 {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    collections: [
      {
        id: asCollectionId("col_community_members"),
        name: "members",
        fields: [
          {
            id: asFieldId("fld_member_email"),
            name: "email",
            type: "text",
            required: true,
            unique: true,
          },
          {
            id: asFieldId("fld_member_name"),
            name: "displayName",
            type: "text",
            required: true,
          },
        ],
        auth: authDefinition(),
        ...overrides,
      },
    ],
  };
}

function authIssues(schema: SchemaIrV1) {
  return validateSchema(schema).issues.filter(({ code }) =>
    code === "INVALID_AUTH" || code === "DUPLICATE_REALM_KEY"
  );
}

describe("auth-enabled collection Schema contract", () => {
  it("decodes, canonicalizes, serializes, and detaches a valid auth definition", () => {
    const raw = JSON.parse(JSON.stringify(authSchema())) as unknown;
    const decoded = decodeSchema(raw);
    const normalized = normalizeSchema(decoded);
    const serialized = serializeSchema(normalized);

    expect(normalized.collections[0]!.auth).toEqual({
      enabled: true,
      realmKey: "community",
      identifierFieldIds: ["fld_member_email"],
      acceptSystemIdentities: true,
      provisioning: "explicit",
      defaultRoleIds: [],
    });
    expect(normalized.collections[0]!.auth).not.toBe(decoded.collections[0]!.auth);
    expect(normalized.collections[0]!.auth!.identifierFieldIds).not.toBe(
      decoded.collections[0]!.auth!.identifierFieldIds,
    );
    expect(parseSchema(serialized)).toEqual(normalized);
    expect(serializeSchema(parseSchema(serialized))).toBe(serialized);
  });

  it("strictly decodes every required auth property and rejects unknown values", () => {
    const missing = JSON.parse(JSON.stringify(authSchema())) as {
      collections: { auth: Record<string, unknown> }[];
    };
    delete missing.collections[0]!.auth["realmKey"];
    expectDecodeIssue(missing, "MISSING_PROPERTY", ["collections", 0, "auth", "realmKey"]);

    const disabled = JSON.parse(JSON.stringify(authSchema())) as {
      collections: { auth: Record<string, unknown> }[];
    };
    disabled.collections[0]!.auth["enabled"] = false;
    expectDecodeIssue(disabled, "INVALID_LITERAL", ["collections", 0, "auth", "enabled"]);

    const provisioning = JSON.parse(JSON.stringify(authSchema())) as {
      collections: { auth: Record<string, unknown> }[];
    };
    provisioning.collections[0]!.auth["provisioning"] = "automatic";
    expectDecodeIssue(provisioning, "INVALID_LITERAL", [
      "collections",
      0,
      "auth",
      "provisioning",
    ]);

    const unknown = JSON.parse(JSON.stringify(authSchema())) as {
      collections: { auth: Record<string, unknown> }[];
    };
    unknown.collections[0]!.auth["passwordFieldId"] = "fld_password";
    expectDecodeIssue(unknown, "UNKNOWN_PROPERTY", [
      "collections",
      0,
      "auth",
      "passwordFieldId",
    ]);
  });

  it.each([
    "Community",
    "community_members",
    "community--members",
    "community-",
    "",
    "a".repeat(65),
  ])("rejects non-portable Realm key %j", (realmKey) => {
    const schema = authSchema({ auth: authDefinition({ realmKey }) });
    expect(authIssues(schema)).toContainEqual(expect.objectContaining({
      code: "INVALID_AUTH",
      path: ["collections", 0, "auth", "realmKey"],
    }));
  });

  it("allows each Realm key on exactly one profile collection", () => {
    const first = authSchema().collections[0]!;
    const schema: SchemaIrV1 = {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [
        first,
        {
          id: asCollectionId("col_community_people"),
          name: "people",
          fields: [{
            id: asFieldId("fld_person_email"),
            name: "email",
            type: "text",
            required: true,
            unique: true,
          }],
          auth: authDefinition({ identifierFieldIds: [asFieldId("fld_person_email")] }),
        },
      ],
    };

    expect(authIssues(schema)).toContainEqual(expect.objectContaining({
      code: "DUPLICATE_REALM_KEY",
      path: ["collections", 1, "auth", "realmKey"],
      objectId: "col_community_people",
    }));
  });

  it("rejects auth on singleton collections", () => {
    const schema = authSchema({ kind: "singleton" });
    expect(authIssues(schema)).toContainEqual(expect.objectContaining({
      code: "INVALID_AUTH",
      path: ["collections", 0, "auth"],
    }));
  });

  it("requires a non-empty, duplicate-free identifier list", () => {
    const empty = authSchema({
      auth: authDefinition({ identifierFieldIds: [] }),
    });
    expect(authIssues(empty)).toContainEqual(expect.objectContaining({
      path: ["collections", 0, "auth", "identifierFieldIds"],
    }));

    const duplicate = authSchema({
      auth: authDefinition({
        identifierFieldIds: [
          asFieldId("fld_member_email"),
          asFieldId("fld_member_email"),
        ],
      }),
    });
    expect(authIssues(duplicate)).toContainEqual(expect.objectContaining({
      path: ["collections", 0, "auth", "identifierFieldIds", 1],
      message: expect.stringContaining("Duplicate"),
    }));
  });

  it("requires identifiers to be top-level required unique text fields", () => {
    const schema = authSchema({
      fields: [
        {
          id: asFieldId("fld_member_email"),
          name: "email",
          type: "textarea",
        },
        {
          id: asFieldId("fld_member_profile"),
          name: "profile",
          type: "object",
          fields: [{
            id: asFieldId("fld_nested_login"),
            name: "login",
            type: "text",
            required: true,
            unique: true,
          }],
        },
      ],
      auth: authDefinition({
        identifierFieldIds: [
          asFieldId("fld_member_email"),
          asFieldId("fld_nested_login"),
        ],
      }),
    });
    const issues = authIssues(schema);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("text field") }),
      expect.objectContaining({ message: expect.stringContaining("required") }),
      expect.objectContaining({ message: expect.stringContaining("unique") }),
      expect.objectContaining({ message: expect.stringContaining("top-level") }),
    ]));
  });

  it("accepts only unique non-empty default Role IDs", () => {
    const schema = authSchema({
      auth: authDefinition({
        defaultRoleIds: ["role_member", "role_member", ""],
      }),
    });

    expect(authIssues(schema)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["collections", 0, "auth", "defaultRoleIds", 1],
        message: expect.stringContaining("Duplicate"),
      }),
      expect.objectContaining({
        path: ["collections", 0, "auth", "defaultRoleIds", 2],
        message: expect.stringContaining("non-empty"),
      }),
    ]));
  });

  it("keeps the existing stable-ID diff behavior on an auth-enabled schema", () => {
    const before = authSchema();
    const collection = before.collections[0]!;
    const after: SchemaIrV1 = {
      ...before,
      collections: [{
        ...collection,
        fields: collection.fields.map((field) =>
          field.id === "fld_member_name" ? { ...field, name: "name" } : field
        ),
      }],
    };

    expect(diffSchemas(before, parseSchema(serializeSchema(before)))).toEqual([]);
    expect(diffSchemas(before, after)).toContainEqual(expect.objectContaining({
      kind: "object-renamed",
      objectId: "fld_member_name",
      severity: "safe",
    }));
  });

  it("reports enabling auth on an existing collection as risky", () => {
    const after = authSchema();
    const { auth: _auth, ...beforeCollection } = after.collections[0]!;
    const before: SchemaIrV1 = { ...after, collections: [beforeCollection] };

    expect(diffSchemas(before, after)).toContainEqual({
      kind: "collection-auth-changed",
      objectId: "col_community_members",
      objectType: "collection",
      severity: "risky",
      path: ["collections", "members", "auth"],
      before: null,
      after: after.collections[0]!.auth,
    });
  });

  it("reports disabling auth as destructive", () => {
    const before = authSchema();
    const { auth: _auth, ...afterCollection } = before.collections[0]!;
    const after: SchemaIrV1 = { ...before, collections: [afterCollection] };

    expect(diffSchemas(before, after)).toContainEqual(expect.objectContaining({
      kind: "collection-auth-changed",
      objectId: "col_community_members",
      severity: "destructive",
      before: before.collections[0]!.auth,
      after: null,
    }));
  });

  it("treats Realm key and identifier changes as destructive", () => {
    const before = authSchema({
      fields: [
        ...authSchema().collections[0]!.fields,
        {
          id: asFieldId("fld_member_username"),
          name: "username",
          type: "text",
          required: true,
          unique: true,
        },
      ],
    });
    const realmChanged = authSchema({
      fields: before.collections[0]!.fields,
      auth: authDefinition({ realmKey: "community-v2" }),
    });
    const identifiersChanged = authSchema({
      fields: before.collections[0]!.fields,
      auth: authDefinition({ identifierFieldIds: [asFieldId("fld_member_username")] }),
    });

    expect(authChange(diffSchemas(before, realmChanged))?.severity).toBe("destructive");
    expect(authChange(diffSchemas(before, identifiersChanged))?.severity).toBe("destructive");
  });

  it.each([
    ["System Identity acceptance", authDefinition({ acceptSystemIdentities: false })],
    ["provisioning mode", authDefinition({ provisioning: "jit" })],
    ["default Roles", authDefinition({ defaultRoleIds: ["role_member"] })],
  ])("reports a policy-only %s change as risky", (_label, auth) => {
    const before = authSchema();
    const after = authSchema({ auth });

    expect(authChange(diffSchemas(before, after))).toEqual(expect.objectContaining({
      kind: "collection-auth-changed",
      severity: "risky",
    }));
  });
});

function authChange(changes: ReturnType<typeof diffSchemas>) {
  return changes.find(({ kind }) => kind === "collection-auth-changed");
}

function expectDecodeIssue(
  input: unknown,
  code: string,
  path: readonly (string | number)[],
): void {
  try {
    decodeSchema(input);
    throw new Error("Expected decoding to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SchemaDecodeError);
    expect((error as SchemaDecodeError).issues[0]).toEqual(
      expect.objectContaining({ code, path }),
    );
  }
}

describe("direct auth validation", () => {
  it("fails closed when callers bypass the decoder with invalid literals", () => {
    const invalidAuth = {
      ...authDefinition(),
      enabled: false,
      acceptSystemIdentities: "yes",
      provisioning: "automatic",
    } as unknown as CollectionAuthDefinition;
    const result = validateSchema(authSchema({ auth: invalidAuth }));

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["collections", 0, "auth", "enabled"] }),
      expect.objectContaining({ path: ["collections", 0, "auth", "acceptSystemIdentities"] }),
      expect.objectContaining({ path: ["collections", 0, "auth", "provisioning"] }),
    ]));
  });

  it("reports semantic auth failures as Schema validation errors through decodeSchema", () => {
    const input = JSON.parse(JSON.stringify(authSchema({
      auth: authDefinition({ identifierFieldIds: [] }),
    }))) as unknown;

    expect(() => decodeSchema(input)).toThrowError(SchemaValidationError);
  });
});
