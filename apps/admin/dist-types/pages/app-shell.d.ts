import { type AccessEvaluationProfile } from "@xecms/admin";
import { type IconName } from "../components/icon.js";
import { type DisplayMode } from "../display-mode.js";
export declare const navigationAccessChecks: readonly [import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck, import("@xecms/admin").AccessEvaluationCheck];
export declare const navigationItems: readonly {
    readonly to: string;
    readonly icon: IconName;
    readonly label: string;
    readonly group: "content" | "people" | "system";
    readonly minimum: DisplayMode;
    readonly access: readonly string[];
    readonly requireAll?: boolean;
}[];
export declare function visibleNavigationItems(mode: DisplayMode, profile: AccessEvaluationProfile | undefined): {
    readonly to: string;
    readonly icon: IconName;
    readonly label: string;
    readonly group: "content" | "people" | "system";
    readonly minimum: DisplayMode;
    readonly access: readonly string[];
    readonly requireAll?: boolean;
}[];
export declare function AdminIndexRedirect(): import("react").JSX.Element;
export declare function AppShell(): import("react").JSX.Element;
//# sourceMappingURL=app-shell.d.ts.map