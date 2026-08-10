import { type AuthorizationAdminApi, type AuthorizationPolicy } from "@xecms/admin";
export declare function useAuthorizationWorkspace(): {
    readonly authorization: AuthorizationAdminApi;
    readonly realmId?: string;
    readonly policyKey: readonly string[];
    readonly auditKey: readonly string[];
};
export declare function accessBasePath(realmId?: string): string;
export type AuthorizationWorkspaceAccessMode = "realm-actor" | "cms-owner-readonly" | "realm-full-access";
export declare function authorizationAccessMode(policy: AuthorizationPolicy, realmId?: string): AuthorizationWorkspaceAccessMode;
export declare function canMutateAuthorization(policy: AuthorizationPolicy, realmId?: string): boolean;
export declare function useAuthorizationPolicy(): import("@tanstack/react-query").UseQueryResult<NoInfer<AuthorizationPolicy>, Error>;
//# sourceMappingURL=workspace.d.ts.map