import { jsx as _jsx } from "react/jsx-runtime";
import { useMemo } from "react";
import { ComposedRuntimeProvider, renderComposedComponent } from "@xecms/admin-runtime";
/**
 * Renders a single Component with the real runtime renderer so the Builder shows
 * actual input/table/detail/form chrome (with empty/placeholder data) instead of
 * a kind+label stub. It wraps the Component in a one-component page and a mock
 * client — no live runtime, schema access, or network is involved.
 */
export function LivePreviewCell({ component, collections }) {
    const page = useMemo(() => ({
        id: "preview", type: "composed-page", screenNo: "PRV-000", title: "미리보기", menuLabel: "미리보기",
        layout: { columns: 48, rowHeight: 8 }, state: [], dataSources: [], components: [component], connections: [],
    }), [component]);
    const fieldNames = useMemo(() => {
        const map = new Map();
        for (const collection of collections) {
            for (const field of collection.fields)
                map.set(field.id, field.name);
        }
        return map;
    }, [collections]);
    const fieldTypes = useMemo(() => {
        const map = new Map();
        for (const collection of collections) {
            for (const field of collection.fields)
                map.set(field.id, field.type);
        }
        return map;
    }, [collections]);
    return (_jsx(ComposedRuntimeProvider, { page: page, client: PREVIEW_CLIENT, fieldNames: fieldNames, fieldTypes: fieldTypes, children: renderComposedComponent(component) }));
}
/** A no-op data client: preview shows empty/placeholder states, never live data. */
const PREVIEW_CLIENT = {
    queryComposed: () => Promise.resolve({ items: [], hasNextPage: false }),
    aggregateComposed: () => Promise.resolve({ groups: [], truncated: false }),
    getComposedDocument: () => Promise.resolve(null),
    get: () => Promise.reject(new Error("preview")),
    delete: () => Promise.resolve(),
    create: () => Promise.reject(new Error("preview")),
    update: () => Promise.reject(new Error("preview")),
};
//# sourceMappingURL=live-preview.js.map