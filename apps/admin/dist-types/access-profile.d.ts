import { type AccessEvaluationCheck } from "@xecms/admin";
export declare const systemResources: {
    readonly workspace: "resource:workspace";
    readonly schema: "resource:schema";
    readonly content: "resource:content";
    readonly authorization: "resource:authorization";
    readonly audit: "resource:audit";
};
export declare function permissionCheck(id: string, action: string, resourceId: string): AccessEvaluationCheck;
export declare function useAccessProfile(scope: string, checks: readonly AccessEvaluationCheck[], enabled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<import("@xecms/admin").AccessEvaluationProfile>, Error>;
//# sourceMappingURL=access-profile.d.ts.map