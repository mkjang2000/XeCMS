import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { useAdminApi, type AuthorizationAdminApi } from "@xecms/admin";
import { queryKeys } from "../../queries.js";

export function useAuthorizationWorkspace(): {
  readonly authorization: AuthorizationAdminApi;
  readonly realmId?: string;
  readonly policyKey: readonly string[];
  readonly auditKey: readonly string[];
} {
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

export function accessBasePath(realmId?: string): string {
  return realmId === undefined
    ? "/admin/access"
    : `/admin/realms/${encodeURIComponent(realmId)}/access`;
}

export function useAuthorizationPolicy() {
  const { authorization, policyKey } = useAuthorizationWorkspace();
  return useQuery({
    queryKey: policyKey,
    queryFn: () => authorization.getPolicy(),
  });
}
