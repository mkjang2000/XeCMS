import type { AdminRuntimeDataClient } from "@xecms/admin-runtime";
import type { ComposedPageDefinition } from "@xecms/admin-apps";
/** Thrown when Preview attempts a mutation — the editor Preview is read-only. */
export declare class PreviewMutationBlocked extends Error {
    constructor();
}
/**
 * A data client for the editor Preview. Unlike the real Runtime client (which
 * resolves queries from the APPLIED manifest server-side), this resolves each
 * Data Source from the EDITING (unsaved) page client-side, then calls the plain
 * content query API — so the Preview reflects unsaved layout/wiring against real
 * data without an apply. Reads pass through; mutations are blocked (Preview never
 * writes). All content endpoints still enforce masking and permissions server-side.
 */
export declare function createPreviewDataClient(pages: readonly ComposedPageDefinition[], fieldNameById?: ReadonlyMap<string, string>): AdminRuntimeDataClient;
//# sourceMappingURL=preview-client.d.ts.map