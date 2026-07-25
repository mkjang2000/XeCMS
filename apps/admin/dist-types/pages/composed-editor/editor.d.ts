import { type AdminAppManifestV2, type ComposedPageDefinition, type ConnectionDefinition } from "@xecms/admin-apps";
import { portsFor } from "./ports.js";
export interface ComposedPageEditorProps {
    readonly manifest: AdminAppManifestV2;
    readonly page: ComposedPageDefinition;
    readonly onChange: (manifest: AdminAppManifestV2) => void;
}
export declare function ComposedPageEditor({ manifest, page, onChange }: ComposedPageEditorProps): import("react").JSX.Element;
export type { ConnectionDefinition };
export { portsFor };
//# sourceMappingURL=editor.d.ts.map