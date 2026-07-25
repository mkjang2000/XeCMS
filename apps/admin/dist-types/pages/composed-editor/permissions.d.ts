import type { ComposedPageDefinition } from "@xecms/admin-apps";
export interface RequiredPermission {
    /** The content permission the Action needs (e.g. content.delete). */
    readonly permission: string;
    /** The target Collection id, if the Action names one. */
    readonly collectionId?: string;
    /** The Action id that requires it (for display). */
    readonly actionId: string;
}
/** Maps a built-in Action id to the content permission the server enforces. */
export declare function builtInActionPermission(actionId: string): string | null;
/**
 * The distinct content permissions a Composed Page's Actions require, for the
 * Builder's Role Preview. This mirrors the server's gate derivation so an App
 * author can see, before publishing, which permissions a Role needs — the
 * server remains the authority and re-checks every mutation.
 */
export declare function requiredPermissions(page: ComposedPageDefinition): readonly RequiredPermission[];
//# sourceMappingURL=permissions.d.ts.map