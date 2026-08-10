import type { AuthorizationDecision, AuthorizationPolicy } from "@xecms/admin";
export declare function AccessSimulatorPage(): import("react").JSX.Element;
export declare function EffectivePermissionList({ policy, results, technical, }: {
    readonly policy: AuthorizationPolicy;
    readonly results: readonly {
        readonly permission: AuthorizationPolicy["permissions"][number];
        readonly supported: boolean;
        readonly decision: AuthorizationDecision | null;
    }[] | null;
    readonly technical?: boolean;
}): import("react").JSX.Element;
export declare function DecisionExplanation({ policy, decision }: {
    readonly policy: AuthorizationPolicy;
    readonly decision: AuthorizationDecision | null;
}): import("react").JSX.Element;
//# sourceMappingURL=simulator-page.d.ts.map