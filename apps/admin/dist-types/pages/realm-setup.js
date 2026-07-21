/**
 * Memberships eligible to become Primary Owner: an active, human, non-disabled
 * identity that is native to this Realm or is a System operator, and is not
 * already the current Owner. Shared by the Owner section and setup checklist so
 * their gating stays consistent.
 */
export function ownerCandidateMemberships(input) {
    const identityById = new Map((input.identities ?? []).map((identity) => [identity.globalIdentityId, identity]));
    return (input.memberships ?? []).filter((membership) => {
        const identity = membership.identity ?? identityById.get(membership.globalIdentityId);
        return membership.status === "active"
            && (input.owner?.status !== "healthy" || membership.membershipId !== input.owner.owner?.membershipId)
            && identity?.kind === "human"
            && (identity?.originRealmId === membership.realmId || identity?.originRealmId === input.systemRealmId)
            && identity.disabledAt === undefined;
    });
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
export function realmSetupSteps(input) {
    const active = input.realm.status === "active";
    const ownerHealthy = input.owner?.status === "healthy";
    const hasAdministrator = input.memberships?.some((m) => m.realmAdministrator === true && m.status === "active") ?? false;
    const activateStatus = active ? "done" : "current";
    let ownerStatus;
    if (ownerHealthy)
        ownerStatus = "done";
    else if (!active)
        ownerStatus = "todo";
    else if (input.ownerCandidateCount === 0)
        ownerStatus = "blocked";
    else
        ownerStatus = "current";
    let administratorStatus;
    if (hasAdministrator)
        administratorStatus = "done";
    else if (!active)
        administratorStatus = "todo";
    else if (ownerStatus === "current" || ownerStatus === "blocked")
        administratorStatus = "todo";
    else
        administratorStatus = "current";
    let accessStatus;
    if (!active || !hasAdministrator)
        accessStatus = "todo";
    else
        accessStatus = "current";
    return [
        { id: "activate", status: activateStatus },
        { id: "owner", status: ownerStatus },
        { id: "administrator", status: administratorStatus },
        { id: "access", status: accessStatus },
    ];
}
/** True while any setup step still needs attention (checklist worth showing). */
export function isRealmSetupIncomplete(steps) {
    return steps.some((step) => step.id !== "access" && step.status !== "done");
}
//# sourceMappingURL=realm-setup.js.map