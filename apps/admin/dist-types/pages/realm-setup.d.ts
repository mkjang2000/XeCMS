import type { GlobalIdentity, IdentityRealm, RealmMembership, RealmOwnerStatus } from "@xecms/admin";
import type { StepStatus } from "../components/stepper.js";
/**
 * Memberships eligible to become Primary Owner: an active, human, non-disabled
 * identity that is native to this Realm or is a System operator, and is not
 * already the current Owner. Shared by the Owner section and setup checklist so
 * their gating stays consistent.
 */
export declare function ownerCandidateMemberships(input: {
    readonly memberships: readonly RealmMembership[] | undefined;
    readonly identities: readonly GlobalIdentity[] | undefined;
    readonly owner: RealmOwnerStatus | undefined;
    readonly systemRealmId: string;
}): readonly RealmMembership[];
export type RealmSetupStepId = "activate" | "owner" | "administrator" | "access";
export interface RealmSetupStep {
    readonly id: RealmSetupStepId;
    readonly status: StepStatus;
}
export interface RealmSetupInput {
    readonly realm: IdentityRealm;
    readonly owner: RealmOwnerStatus | undefined;
    readonly memberships: readonly RealmMembership[] | undefined;
    /** Count of active memberships eligible to become Owner. */
    readonly ownerCandidateCount: number;
}
/**
 * Derives the setup-checklist state entirely from data already loaded on the
 * detail page (realm/owner/memberships). No new queries. The first not-done
 * step becomes "current"; a step whose precondition is missing is "blocked".
 *
 * The "administrator" step encodes the bootstrap deadlock preventively: making
 * a realm active is not enough to enter its policy screens — the operator must
 * be appointed a Content Administrator first.
 */
export declare function realmSetupSteps(input: RealmSetupInput): readonly RealmSetupStep[];
/** True while any setup step still needs attention (checklist worth showing). */
export declare function isRealmSetupIncomplete(steps: readonly RealmSetupStep[]): boolean;
//# sourceMappingURL=realm-setup.d.ts.map