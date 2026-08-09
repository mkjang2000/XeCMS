import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { Button } from "@xecms/ui";
import { ComposedPage } from "@xecms/admin-runtime";
import { createPreviewDataClient } from "./preview-client.js";
import styles from "../composed-screen-editor.module.css";
/**
 * Runs the EDITING (unsaved) manifest against real data in a modal, using a
 * synthesized runtime DTO + a client-side query resolver. Reads are live; every
 * mutation is blocked (Preview never writes). This lets a "전산 사용자" verify a
 * screen's wiring — search → list → detail, cross-schema lookups — before saving.
 */
export function PreviewModal({ manifest, collections, initialPageId, schemaRevisionId, onClose }) {
    const composedPages = useMemo(() => manifest.pages.filter((page) => page.type === "composed-page"), [manifest.pages]);
    const [pageId, setPageId] = useState(composedPages.some((page) => page.id === initialPageId) ? initialPageId : (composedPages[0]?.id ?? ""));
    const activePage = composedPages.find((page) => page.id === pageId) ?? composedPages[0];
    const fieldNameById = useMemo(() => new Map(collections.flatMap((collection) => collection.fields.map((field) => [field.id, field.name]))), [collections]);
    const client = useMemo(() => createPreviewDataClient(composedPages, fieldNameById), [composedPages, fieldNameById]);
    const runtime = useMemo(() => synthesizeRuntime(manifest, collections, schemaRevisionId), [manifest, collections, schemaRevisionId]);
    return (_jsx("div", { className: styles.previewBackdrop, role: "presentation", onClick: onClose, children: _jsxs("section", { className: styles.previewDialog, role: "dialog", "aria-modal": "true", "aria-label": "\uD654\uBA74 \uBBF8\uB9AC\uBCF4\uAE30", onClick: (event) => event.stopPropagation(), children: [_jsxs("header", { className: styles.previewHeader, children: [_jsxs("div", { children: [_jsx("span", { children: "\uBBF8\uB9AC\uBCF4\uAE30 \u00B7 \uC800\uC7A5\uD558\uC9C0 \uC54A\uC740 \uC0C1\uD0DC" }), _jsx("strong", { children: manifest.name })] }), _jsxs("div", { className: styles.previewHeaderActions, children: [composedPages.length > 1 ? (_jsx("select", { className: styles.previewPageSelect, "aria-label": "\uBBF8\uB9AC\uBCFC \uD654\uBA74", value: activePage?.id ?? "", onChange: (event) => setPageId(event.target.value), children: composedPages.map((page) => (_jsx("option", { value: page.id, children: page.title || page.menuLabel || page.id }, page.id))) })) : null, _jsx(Button, { size: "small", variant: "secondary", onPress: onClose, children: "\uB2EB\uAE30" })] })] }), _jsx("p", { className: styles.previewHint, children: "\uC2E4\uC81C \uB370\uC774\uD130\uB85C \uC870\uD68C\u00B7\uC120\uD0DD\uC744 \uC2DC\uD5D8\uD569\uB2C8\uB2E4. \uC800\uC7A5\u00B7\uC0AD\uC81C \uB4F1 \uBCC0\uACBD\uC740 \uBBF8\uB9AC\uBCF4\uAE30\uC5D0\uC11C \uC2E4\uD589\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }), _jsx("div", { className: styles.previewBody, children: activePage === undefined ? (_jsx("p", { className: styles.inspectorEmpty, style: { padding: "2rem" }, children: "\uBBF8\uB9AC\uBCFC \uD654\uBA74\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." })) : (_jsx(ComposedPage, { runtime: runtime, page: activePage, client: client, navigate: (target) => setPageId(target) }, activePage.id)) })] }) }));
}
/**
 * Builds a minimal {@link AdminAppRuntimeDto} from the editing manifest. Access is
 * permissive (Preview is a UX gate only; the content API still enforces masking &
 * permissions on every read, and mutations are blocked by the Preview client).
 */
function synthesizeRuntime(manifest, collections, schemaRevisionId) {
    const now = new Date().toISOString();
    const pageAccess = {};
    const pageUnmasked = {};
    const actions = {};
    for (const page of manifest.pages) {
        pageAccess[page.id] = true;
        pageUnmasked[page.id] = true;
        if (page.type === "composed-page") {
            for (const component of page.components) {
                const actionId = typeof component.props?.actionId === "string" ? component.props.actionId : undefined;
                if (actionId !== undefined)
                    actions[`${page.id}:${actionId}`] = true;
            }
        }
    }
    const readableFields = {};
    const writableFields = {};
    for (const collection of collections) {
        readableFields[collection.id] = null;
        writableFields[collection.id] = null;
    }
    return {
        app: {
            id: manifest.id, workspaceId: "preview", manifestId: manifest.id,
            key: manifest.key, name: manifest.name,
            audience: manifest.audience.type === "content-realm"
                ? { type: "content-realm", realmId: manifest.audience.realmId }
                : { type: "system" },
            status: "active", activeRevisionId: null, routeVersion: 0, createdAt: now,
            createdByIdentityId: "preview", createdBySubjectId: "preview",
            updatedAt: now, updatedByIdentityId: "preview", updatedBySubjectId: "preview",
        },
        revisionId: "preview",
        manifest,
        schema: { revisionId: schemaRevisionId ?? "preview", collections },
        user: {
            identityId: "preview", subjectId: "preview", displayName: "미리보기",
            realmId: manifest.audience.type === "content-realm" ? manifest.audience.realmId : "system",
        },
        access: {
            appAllowed: true, pages: pageAccess, pageUnmasked, actions,
            permissions: {}, readableFields, writableFields, policyRevision: 0,
        },
        dependencyHealth: { healthy: true, checkedAt: now, blockers: [] },
    };
}
//# sourceMappingURL=preview-modal.js.map