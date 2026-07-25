import { type AdminAppManifestV2 } from "@xecms/admin-apps";
export declare function AdminAppListPage(): import("react").JSX.Element;
export declare function AdminAppCreatePage(): import("react").JSX.Element;
export declare function AdminAppBuilderPage(): import("react").JSX.Element;
/** A minimal, valid V2 manifest with one empty Composed Page to start editing. */
export declare function buildComposedManifest(input: {
    readonly name: string;
    readonly key: string;
    readonly audience: AdminAppManifestV2["audience"];
}): AdminAppManifestV2;
/**
 * Only treats a source as an editable V2 manifest once it is structurally
 * complete enough for the canvas editor. Mid-typing states (e.g. formatVersion
 * flipped to 2 before presentation/pages exist) fall back to the JSON editor
 * instead of crashing the editor.
 */
export declare function parseManifestV2(source: string): AdminAppManifestV2 | null;
//# sourceMappingURL=admin-app-pages.d.ts.map