import { describe, expect, it } from "vitest";
import { decideDocumentFormSync } from "./document-presentation.js";
describe("document form synchronization", () => {
    it("initializes when the editor route changes", () => {
        expect(decideDocumentFormSync({
            routeKey: "document:posts:doc_2",
            initializedRouteKey: "document:posts:doc_1",
            isNew: false,
            loadedVersion: 3,
            remoteVersion: 1,
            isDirty: true,
        })).toBe("initialize");
    });
    it("keeps dirty input and reports a conflict when a newer version arrives", () => {
        expect(decideDocumentFormSync({
            routeKey: "document:posts:doc_1",
            initializedRouteKey: "document:posts:doc_1",
            isNew: false,
            loadedVersion: 3,
            remoteVersion: 4,
            isDirty: true,
        })).toBe("conflict");
    });
    it("resets a clean form to a newer remote version", () => {
        expect(decideDocumentFormSync({
            routeKey: "document:posts:doc_1",
            initializedRouteKey: "document:posts:doc_1",
            isNew: false,
            loadedVersion: 3,
            remoteVersion: 4,
            isDirty: false,
        })).toBe("reset");
    });
});
//# sourceMappingURL=document-presentation.test.js.map