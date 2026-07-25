import { describe, expect, it } from "vitest";
import { validateAdminAppManifestV2 } from "@xecms/admin-apps";
import { buildComposedManifest, parseManifestV2 } from "./admin-app-pages.js";
describe("parseManifestV2 crash guard", () => {
    it("returns null for a partial manifest still being typed", () => {
        // formatVersion flipped to 2 but no presentation/pages yet.
        expect(parseManifestV2('{"formatVersion":2}')).toBeNull();
        expect(parseManifestV2('{"formatVersion":2,"pages":[]}')).toBeNull();
        expect(parseManifestV2('{"formatVersion":2,"pages":[],"navigation":[]}')).toBeNull();
    });
    it("returns null for invalid JSON and V1 manifests", () => {
        expect(parseManifestV2("{not json")).toBeNull();
        expect(parseManifestV2('{"formatVersion":1,"pages":[]}')).toBeNull();
    });
    it("accepts a structurally complete V2 manifest", () => {
        const source = JSON.stringify(buildComposedManifest({
            name: "Ops", key: "ops", audience: { type: "system" },
        }));
        expect(parseManifestV2(source)).not.toBeNull();
    });
});
describe("buildComposedManifest", () => {
    it("produces a valid, editable V2 manifest with one empty Composed Page", () => {
        const manifest = buildComposedManifest({ name: "운영", key: "ops", audience: { type: "system" } });
        const { valid, issues } = validateAdminAppManifestV2(manifest);
        expect(valid, JSON.stringify(issues)).toBe(true);
        expect(manifest.pages).toHaveLength(1);
        expect(manifest.pages[0].type).toBe("composed-page");
    });
});
//# sourceMappingURL=admin-app-pages.v2.test.js.map