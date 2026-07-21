import { describe, expect, it } from "vitest";
import type { IdentityRealm, RealmMembership, RealmOwnerStatus } from "@xecms/admin";
import { isRealmSetupIncomplete, ownerCandidateMemberships, realmSetupSteps, type RealmSetupStepId } from "./realm-setup.js";
import type { StepStatus } from "../components/stepper.js";

function realm(status: IdentityRealm["status"]): IdentityRealm {
  return {
    realmId: "rlm_1", realmKey: "svc", name: "서비스", kind: "content", status,
    authentication: { acceptSystemIdentities: true, provisioning: "explicit", registration: "closed", defaultRoleIds: [] },
    revision: 1,
    ...(status === "active" ? { profileCollectionId: "col_p" } : {}),
  };
}

function owner(status: RealmOwnerStatus["status"]): RealmOwnerStatus {
  return { realmId: "rlm_1", status, policyRevision: 1 };
}

function membership(overrides: Partial<RealmMembership>): RealmMembership {
  return {
    membershipId: "mem_1", globalIdentityId: "gid_1", realmId: "rlm_1", subjectId: "subj_1",
    status: "active", provisionedBy: "explicit", revision: 1, createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function statusOf(steps: readonly { id: RealmSetupStepId; status: StepStatus }[], id: RealmSetupStepId): StepStatus {
  return steps.find((s) => s.id === id)!.status;
}

describe("realmSetupSteps", () => {
  it("provisioning realm: activate is current, the rest wait", () => {
    const steps = realmSetupSteps({ realm: realm("provisioning"), owner: owner("ownerless"), memberships: [], ownerCandidateCount: 0 });
    expect(statusOf(steps, "activate")).toBe("current");
    expect(statusOf(steps, "owner")).toBe("todo");
    expect(statusOf(steps, "administrator")).toBe("todo");
    expect(statusOf(steps, "access")).toBe("todo");
  });

  it("active but ownerless with no candidate: owner is blocked", () => {
    const steps = realmSetupSteps({ realm: realm("active"), owner: owner("ownerless"), memberships: [], ownerCandidateCount: 0 });
    expect(statusOf(steps, "activate")).toBe("done");
    expect(statusOf(steps, "owner")).toBe("blocked");
    expect(statusOf(steps, "administrator")).toBe("todo");
  });

  it("active with an owner candidate: owner is current", () => {
    const steps = realmSetupSteps({ realm: realm("active"), owner: owner("ownerless"), memberships: [], ownerCandidateCount: 1 });
    expect(statusOf(steps, "owner")).toBe("current");
  });

  it("owner assigned, no administrator yet: administrator is current (deadlock prevention)", () => {
    const steps = realmSetupSteps({ realm: realm("active"), owner: owner("healthy"), memberships: [membership({})], ownerCandidateCount: 0 });
    expect(statusOf(steps, "owner")).toBe("done");
    expect(statusOf(steps, "administrator")).toBe("current");
    expect(statusOf(steps, "access")).toBe("todo");
  });

  it("administrator appointed: administrator done, access becomes current", () => {
    const steps = realmSetupSteps({
      realm: realm("active"), owner: owner("healthy"),
      memberships: [membership({ realmAdministrator: true })], ownerCandidateCount: 0,
    });
    expect(statusOf(steps, "administrator")).toBe("done");
    expect(statusOf(steps, "access")).toBe("current");
  });

  it("a suspended administrator does not count as appointed", () => {
    const steps = realmSetupSteps({
      realm: realm("active"), owner: owner("healthy"),
      memberships: [membership({ realmAdministrator: true, status: "suspended" })], ownerCandidateCount: 0,
    });
    expect(statusOf(steps, "administrator")).toBe("current");
  });

  it("isRealmSetupIncomplete ignores the optional access step", () => {
    const done = realmSetupSteps({
      realm: realm("active"), owner: owner("healthy"),
      memberships: [membership({ realmAdministrator: true })], ownerCandidateCount: 0,
    });
    expect(isRealmSetupIncomplete(done)).toBe(false);

    const pending = realmSetupSteps({ realm: realm("provisioning"), owner: owner("ownerless"), memberships: [], ownerCandidateCount: 0 });
    expect(isRealmSetupIncomplete(pending)).toBe(true);
  });
});

describe("ownerCandidateMemberships", () => {
  it("includes Realm-native users and System operators, but excludes users native to another Realm", () => {
    const memberships = [
      membership({ membershipId: "mem_native", globalIdentityId: "gid_native" }),
      membership({ membershipId: "mem_system", globalIdentityId: "gid_system" }),
      membership({ membershipId: "mem_foreign", globalIdentityId: "gid_foreign" }),
    ];
    const candidates = ownerCandidateMemberships({
      memberships,
      identities: [
        { globalIdentityId: "gid_native", kind: "human", primaryIdentifier: "native@example.com", originRealmId: "rlm_1", credentialVersion: 1 },
        { globalIdentityId: "gid_system", kind: "human", primaryIdentifier: "system@example.com", originRealmId: "rlm_system", credentialVersion: 1 },
        { globalIdentityId: "gid_foreign", kind: "human", primaryIdentifier: "foreign@example.com", originRealmId: "rlm_other", credentialVersion: 1 },
      ],
      owner: owner("ownerless"),
      systemRealmId: "rlm_system",
    });

    expect(candidates.map(({ membershipId }) => membershipId)).toEqual(["mem_native", "mem_system"]);
  });
});
