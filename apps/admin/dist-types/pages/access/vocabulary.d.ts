import type { AuthorizationPolicy, AuthorizationRoleBinding } from "@xecms/admin";
export declare const permissionCategoryNames: Readonly<Record<string, string>>;
export declare const permissionObjectNames: Readonly<Record<string, string>>;
export declare const permissionVerbNames: Readonly<Record<string, string>>;
export declare function permissionCategoryName(category: string): string;
export declare function permissionTaskName(key: string): string;
export declare function subjectTypeName(type: AuthorizationPolicy["subjects"][number]["type"]): string;
export declare function propagationLabel(propagation: AuthorizationRoleBinding["propagation"]): string;
export declare function hierarchyContextDescription(guard: AuthorizationPolicy["permissions"][number]["hierarchyGuard"]): string;
export declare function decisionReasonName(code: string): string;
//# sourceMappingURL=vocabulary.d.ts.map