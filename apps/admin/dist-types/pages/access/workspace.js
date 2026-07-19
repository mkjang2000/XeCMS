import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { useAdminApi } from "@xecms/admin";
import { queryKeys } from "../../queries.js";
export function useAuthorizationWorkspace() {
    const api = useAdminApi();
    const { realmId } = useParams();
    return realmId === undefined
        ? {
            authorization: api.authorization,
            policyKey: queryKeys.authorization,
            auditKey: queryKeys.authorizationAudit,
        }
        : {
            authorization: api.identityRealms.authorizationFor(realmId),
            realmId,
            policyKey: queryKeys.realmAuthorization(realmId),
            auditKey: queryKeys.realmAuthorizationAudit(realmId),
        };
}
export function accessBasePath(realmId) {
    return realmId === undefined
        ? "/admin/access"
        : `/admin/realms/${encodeURIComponent(realmId)}/access`;
}
export function authorizationAccessMode(policy, realmId) {
    if (realmId === undefined)
        return "realm-actor";
    return policy.administration?.accessMode ?? "realm-actor";
}
export function canMutateAuthorization(policy, realmId) {
    return authorizationAccessMode(policy, realmId) !== "cms-owner-readonly";
}
export function useAuthorizationPolicy() {
    const { authorization, policyKey } = useAuthorizationWorkspace();
    return useQuery({
        queryKey: policyKey,
        queryFn: () => authorization.getPolicy(),
        refetchInterval: (query) => {
            const value = query.state.data;
            const validUntil = value?.administration?.fullAccessValidUntil;
            if (validUntil === undefined)
                return false;
            return Math.max(250, Date.parse(validUntil) - Date.now() + 100);
        },
    });
}
//# sourceMappingURL=workspace.js.map