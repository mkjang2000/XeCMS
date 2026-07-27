const BLOCK_LABELS = {
    search: "검색폼",
    "date-search": "날짜·기간 검색",
    "select-search": "선택 필터",
    "number-search": "숫자 범위 검색",
    "multi-search": "다중 조건 검색",
    list: "목록표",
    cards: "카드 목록",
    detail: "상세",
    field: "단일 필드",
    "input-form": "입력폼",
    "item-actions": "항목 작업",
};
export function blockKindLabel(kind) {
    return BLOCK_LABELS[kind];
}
/** Allocates the next free block id (`blk1`, `blk2`, …) on a page. */
export function nextBlockId(page) {
    const used = new Set(page.components.map((component) => blockIdOf(component.id)).filter((id) => id !== null));
    let index = 1;
    while (used.has(`blk${index}`))
        index += 1;
    return `blk${index}`;
}
/** The block id that owns an atom id, by the `blk<n>_...` prefix convention. */
export function blockIdOf(atomId) {
    const match = /^(blk\d+)_/.exec(atomId);
    return match === null ? null : match[1];
}
function protection(field) {
    return field.maskPolicyId === undefined
        ? { mode: "normal" }
        : { mode: "mask-when-required", maskPolicyId: field.maskPolicyId };
}
/**
 * Produces the atoms for a new block. Each atom id is `<blockId>_...`, so the
 * block can later be re-identified, moved, reconfigured, or removed as a unit.
 */
export function buildBlock(blockId, input) {
    const built = buildAtoms(blockId, input);
    // Stamp the block kind on the first component so describeBlocks recovers it
    // exactly (component-kind inference cannot tell e.g. search vs multi-search).
    const components = built.components.map((component, index) => index === 0 ? { ...component, props: { ...component.props, _blockKind: input.kind } } : component);
    return { ...built, components };
}
function buildAtoms(blockId, input) {
    const at = input.at ?? { x: 0, y: 0 };
    switch (input.kind) {
        case "search": return searchBlock(blockId, input, at);
        case "date-search": return rangeSearchBlock(blockId, "date", input, at);
        case "number-search": return rangeSearchBlock(blockId, "number", input, at);
        case "select-search": return selectSearchBlock(blockId, input, at);
        case "multi-search": return multiSearchBlock(blockId, input, at);
        case "list": return outputBlock(blockId, "list", input, at);
        case "cards": return outputBlock(blockId, "cards", input, at);
        case "detail": return outputBlock(blockId, "detail", input, at);
        case "field": return fieldBlock(blockId, input, at);
        case "input-form": return inputFormBlock(blockId, input, at);
        case "item-actions": return itemActionsBlock(blockId, input, at);
    }
}
function place(at, dx, dy, width, height) {
    return { x: Math.min(47, at.x + dx), y: at.y + dy, width, height };
}
function searchBlock(blockId, input, at) {
    const searchFieldId = input.searchFieldId ?? input.fields[0]?.fieldId;
    const components = [
        { id: `${blockId}_input`, kind: "core.input.text", placement: place(at, 0, 0, 16, 5), props: { label: "검색" } },
        { id: `${blockId}_button`, kind: "core.button", placement: place(at, 16, 0, 5, 5), props: { label: "조회", tone: "primary" } },
    ];
    const state = [{ id: `${blockId}_state_search`, valueType: "string", initialValue: "" }];
    const dataSources = [{
            id: `${blockId}_query`,
            type: "document-query",
            collectionId: input.collectionId,
            trigger: "manual",
            fields: input.fields.map((field) => field.fieldId),
            parameters: [{ id: "param_search", valueType: "string" }],
            ...(searchFieldId === undefined ? {} : {
                filter: {
                    type: "condition",
                    field: { kind: "data", fieldId: searchFieldId },
                    operator: "contains",
                    value: { type: "parameter", parameterId: "param_search" },
                },
            }),
            limit: 20,
        }];
    const connections = [
        conn(`${blockId}_c_in`, comp(`${blockId}_input`, "value"), state_(`${blockId}_state_search`, "write")),
        conn(`${blockId}_c_pm`, state_(`${blockId}_state_search`, "value"), ds(`${blockId}_query`, "parameter:param_search")),
        conn(`${blockId}_c_ex`, comp(`${blockId}_button`, "clicked"), ds(`${blockId}_query`, "execute")),
    ];
    return { components, state, dataSources, connections };
}
/** A start/end range search (date or number): two inputs → gte/lte AND filter. */
function rangeSearchBlock(blockId, kind, input, at) {
    const fieldId = input.searchFieldId ?? input.fields[0]?.fieldId;
    const inputKind = kind === "date" ? "core.input.date" : "core.input.number";
    const valueType = kind === "date" ? "date" : "number";
    const components = [
        { id: `${blockId}_from`, kind: inputKind, placement: place(at, 0, 0, 10, 5), props: { label: "시작" } },
        { id: `${blockId}_to`, kind: inputKind, placement: place(at, 10, 0, 10, 5), props: { label: "끝" } },
        { id: `${blockId}_button`, kind: "core.button", placement: place(at, 20, 0, 5, 5), props: { label: "조회", tone: "primary" } },
    ];
    const state = [
        { id: `${blockId}_state_from`, valueType, initialValue: kind === "date" ? "" : null },
        { id: `${blockId}_state_to`, valueType, initialValue: kind === "date" ? "" : null },
    ];
    const dataSources = [{
            id: `${blockId}_query`, type: "document-query", collectionId: input.collectionId, trigger: "manual",
            fields: input.fields.map((field) => field.fieldId),
            parameters: [{ id: "param_from", valueType }, { id: "param_to", valueType }],
            ...(fieldId === undefined ? {} : {
                filter: {
                    type: "group", operator: "and",
                    filters: [
                        { type: "condition", field: { kind: "data", fieldId }, operator: "gte", value: { type: "parameter", parameterId: "param_from" } },
                        { type: "condition", field: { kind: "data", fieldId }, operator: "lte", value: { type: "parameter", parameterId: "param_to" } },
                    ],
                },
            }),
            limit: 20,
        }];
    const connections = [
        conn(`${blockId}_c_from`, comp(`${blockId}_from`, "value"), state_(`${blockId}_state_from`, "write")),
        conn(`${blockId}_c_to`, comp(`${blockId}_to`, "value"), state_(`${blockId}_state_to`, "write")),
        conn(`${blockId}_c_pf`, state_(`${blockId}_state_from`, "value"), ds(`${blockId}_query`, "parameter:param_from")),
        conn(`${blockId}_c_pt`, state_(`${blockId}_state_to`, "value"), ds(`${blockId}_query`, "parameter:param_to")),
        conn(`${blockId}_c_ex`, comp(`${blockId}_button`, "clicked"), ds(`${blockId}_query`, "execute")),
    ];
    return { components, state, dataSources, connections };
}
/** A dropdown filter: one select → eq filter. Options come from the field later. */
function selectSearchBlock(blockId, input, at) {
    const fieldId = input.searchFieldId ?? input.fields[0]?.fieldId;
    const components = [
        { id: `${blockId}_select`, kind: "core.input.select", placement: place(at, 0, 0, 14, 5), props: { label: "선택", options: [] } },
        { id: `${blockId}_button`, kind: "core.button", placement: place(at, 14, 0, 5, 5), props: { label: "조회", tone: "primary" } },
    ];
    const state = [{ id: `${blockId}_state_select`, valueType: "string", initialValue: "" }];
    const dataSources = [{
            id: `${blockId}_query`, type: "document-query", collectionId: input.collectionId, trigger: "manual",
            fields: input.fields.map((field) => field.fieldId),
            parameters: [{ id: "param_select", valueType: "string" }],
            ...(fieldId === undefined ? {} : {
                filter: { type: "condition", field: { kind: "data", fieldId }, operator: "eq", value: { type: "parameter", parameterId: "param_select" } },
            }),
            limit: 20,
        }];
    const connections = [
        conn(`${blockId}_c_sel`, comp(`${blockId}_select`, "value"), state_(`${blockId}_state_select`, "write")),
        conn(`${blockId}_c_pm`, state_(`${blockId}_state_select`, "value"), ds(`${blockId}_query`, "parameter:param_select")),
        conn(`${blockId}_c_ex`, comp(`${blockId}_button`, "clicked"), ds(`${blockId}_query`, "execute")),
    ];
    return { components, state, dataSources, connections };
}
/** Multiple text conditions ANDed together — one input per configured field. */
function multiSearchBlock(blockId, input, at) {
    const fields = input.fields.slice(0, 4);
    const components = fields.map((field, index) => ({
        id: `${blockId}_in${index}`, kind: "core.input.text", placement: place(at, index * 12, 0, 11, 5),
        props: { label: field.label ?? field.fieldId },
    }));
    components.push({ id: `${blockId}_button`, kind: "core.button", placement: place(at, fields.length * 12, 0, 5, 5), props: { label: "조회", tone: "primary" } });
    const state = fields.map((_, index) => ({ id: `${blockId}_st${index}`, valueType: "string", initialValue: "" }));
    const dataSources = [{
            id: `${blockId}_query`, type: "document-query", collectionId: input.collectionId, trigger: "manual",
            fields: input.fields.map((field) => field.fieldId),
            parameters: fields.map((_, index) => ({ id: `param_${index}`, valueType: "string" })),
            ...(fields.length === 0 ? {} : {
                filter: {
                    type: "group", operator: "and",
                    filters: fields.map((field, index) => ({
                        type: "condition", field: { kind: "data", fieldId: field.fieldId }, operator: "contains",
                        value: { type: "parameter", parameterId: `param_${index}` },
                    })),
                },
            }),
            limit: 20,
        }];
    const connections = [
        ...fields.flatMap((_, index) => [
            conn(`${blockId}_ci${index}`, comp(`${blockId}_in${index}`, "value"), state_(`${blockId}_st${index}`, "write")),
            conn(`${blockId}_cp${index}`, state_(`${blockId}_st${index}`, "value"), ds(`${blockId}_query`, `parameter:param_${index}`)),
        ]),
        conn(`${blockId}_c_ex`, comp(`${blockId}_button`, "clicked"), ds(`${blockId}_query`, "execute")),
    ];
    return { components, state, dataSources, connections };
}
function outputBlock(blockId, kind, input, at) {
    if (kind === "list" || kind === "cards") {
        const anchor = {
            id: `${blockId}_${kind === "list" ? "table" : "cards"}`,
            kind: kind === "list" ? "core.output.table" : "core.output.cards",
            placement: place(at, 0, 0, 30, 24),
            props: { collectionId: input.collectionId, columns: input.fields.map((field, index) => ({ id: `col_${index}`, fieldId: field.fieldId, label: field.label ?? field.fieldId, protection: protection(field) })) },
        };
        return { components: [anchor], state: [], dataSources: [], connections: [] };
    }
    const detail = {
        id: `${blockId}_detail`, kind: "core.output.detail", placement: place(at, 0, 0, 18, 24),
        props: { collectionId: input.collectionId, fields: input.fields.map((field) => ({ fieldId: field.fieldId, protection: protection(field) })) },
    };
    return { components: [detail], state: [], dataSources: [], connections: [] };
}
/** A single-field value tile (label + value of the bound document). */
function fieldBlock(blockId, input, at) {
    const field = input.fields[0];
    const component = {
        id: `${blockId}_field`, kind: "core.output.field", placement: place(at, 0, 0, 12, 6),
        props: { collectionId: input.collectionId, ...(field === undefined ? {} : { fieldId: field.fieldId, label: field.label ?? field.fieldId }) },
    };
    return { components: [component], state: [], dataSources: [], connections: [] };
}
/** Edit/Delete buttons acting on a selected document (target set by a link). */
function itemActionsBlock(blockId, input, at) {
    const stateId = `${blockId}_state_target`;
    const edit = {
        id: `${blockId}_edit`, kind: "core.button", placement: place(at, 0, 0, 6, 5), props: { label: "수정" },
        events: [{ id: `${blockId}_evt_edit`, event: "onClick", effects: [
                    { id: `${blockId}_fx_update`, kind: "action.execute", args: { actionId: "core.action.update", collectionId: input.collectionId, formComponentId: `${blockId}_form`, documentStateId: stateId } },
                ] }],
    };
    const del = {
        id: `${blockId}_delete`, kind: "core.button", placement: place(at, 6, 0, 6, 5), props: { label: "삭제", tone: "danger" },
        events: [{ id: `${blockId}_evt_del`, event: "onClick", effects: [
                    { id: `${blockId}_fx_delete`, kind: "action.execute", args: { actionId: "core.action.delete", collectionId: input.collectionId, documentStateId: stateId, confirm: "선택한 항목을 삭제할까요?" } },
                ] }],
    };
    const state = [{ id: stateId, valueType: "document-id", initialValue: null }];
    return { components: [edit, del], state, dataSources: [], connections: [] };
}
function inputFormBlock(blockId, input, at) {
    const form = {
        id: `${blockId}_form`, kind: "core.form", placement: place(at, 0, 0, 18, 20),
        props: { collectionId: input.collectionId, label: "입력", fields: input.fields.map((field) => ({ fieldId: field.fieldId, inputKind: "text" })) },
    };
    const save = {
        id: `${blockId}_save`, kind: "core.button", placement: place(at, 0, 20, 6, 5), props: { label: "저장", tone: "primary" },
        events: [{
                id: `${blockId}_evt_save`, event: "onClick",
                effects: [{ id: `${blockId}_fx_create`, kind: "action.execute", args: { actionId: "core.action.create", collectionId: input.collectionId, formComponentId: `${blockId}_form` } }],
            }],
    };
    return { components: [form, save], state: [], dataSources: [], connections: [] };
}
// --- Connection helpers (kept local so callers never touch raw port strings) ---
function comp(nodeId, portId) { return { nodeType: "component", nodeId, portId }; }
function state_(nodeId, portId) { return { nodeType: "state", nodeId, portId }; }
function ds(nodeId, portId) { return { nodeType: "data-source", nodeId, portId }; }
function conn(id, from, to) {
    return { id, from, to };
}
/**
 * Groups a page's components into blocks by their `blk<n>_` prefix and infers the
 * kind from the components present. Atoms without the prefix (hand-placed legacy
 * components) are ignored here — the canvas still renders them, they just aren't
 * treated as blocks.
 */
export function describeBlocks(page) {
    const byBlock = new Map();
    for (const component of page.components) {
        const blockId = blockIdOf(component.id);
        if (blockId === null)
            continue;
        const list = byBlock.get(blockId) ?? [];
        list.push(component);
        byBlock.set(blockId, list);
    }
    const blocks = [];
    for (const [id, components] of byBlock) {
        const kind = inferKind(components);
        if (kind === null)
            continue;
        const anchor = anchorFor(kind, components) ?? components[0];
        blocks.push({
            id, kind,
            collectionId: collectionOf(page, id, components),
            componentIds: components.map((component) => component.id),
            anchorComponentId: anchor.id,
        });
    }
    return blocks;
}
const ALL_KINDS = [
    "search", "date-search", "select-search", "number-search", "multi-search",
    "list", "cards", "detail", "field", "input-form", "item-actions",
];
function inferKind(components) {
    // The stamped `_blockKind` (set by buildBlock) is authoritative.
    for (const component of components) {
        const stamped = component.props["_blockKind"];
        if (typeof stamped === "string" && ALL_KINDS.includes(stamped)) {
            return stamped;
        }
    }
    // Fallback for hand-built/legacy blocks: infer from components present.
    const kinds = new Set(components.map((component) => component.kind));
    if (kinds.has("core.output.table"))
        return "list";
    if (kinds.has("core.output.cards"))
        return "cards";
    if (kinds.has("core.output.detail"))
        return "detail";
    if (kinds.has("core.output.field"))
        return "field";
    if (kinds.has("core.form"))
        return "input-form";
    if (kinds.has("core.input.select"))
        return "select-search";
    if (kinds.has("core.input.date") || kinds.has("core.input.number"))
        return "number-search";
    if (kinds.has("core.input.text") || kinds.has("core.input.adaptive"))
        return "search";
    if (kinds.has("core.button"))
        return "item-actions";
    return null;
}
function anchorFor(kind, components) {
    // The stamped component is the anchor; else fall back to a kind-appropriate one.
    const stamped = components.find((component) => typeof component.props["_blockKind"] === "string");
    if (stamped !== undefined)
        return stamped;
    const wanted = kind === "list" ? "core.output.table"
        : kind === "cards" ? "core.output.cards"
            : kind === "detail" ? "core.output.detail"
                : kind === "field" ? "core.output.field"
                    : kind === "input-form" ? "core.form"
                        : kind === "select-search" ? "core.input.select"
                            : kind === "item-actions" ? "core.button" : "core.input.text";
    return components.find((component) => component.kind === wanted);
}
function collectionOf(page, blockId, components) {
    // A block's collection is its data source's, or a component prop's collectionId.
    const source = page.dataSources.find((entry) => blockIdOf(entry.id) === blockId);
    if (source !== undefined)
        return source.collectionId;
    for (const component of components) {
        const value = component.props["collectionId"];
        if (typeof value === "string")
            return value;
    }
    return undefined;
}
/** The fields a block currently shows/collects, read back from its atoms. */
export function blockFields(page, block) {
    const readColumns = (value) => Array.isArray(value)
        ? value.flatMap((entry) => {
            const record = entry;
            const fieldId = record["fieldId"];
            if (typeof fieldId !== "string")
                return [];
            const label = typeof record["label"] === "string" ? record["label"] : undefined;
            const protectionRec = record["protection"];
            const maskPolicyId = typeof protectionRec?.["maskPolicyId"] === "string" ? protectionRec["maskPolicyId"] : undefined;
            return [{ fieldId, ...(label === undefined ? {} : { label }), ...(maskPolicyId === undefined ? {} : { maskPolicyId }) }];
        })
        : [];
    const anchor = page.components.find((component) => component.id === block.anchorComponentId);
    if (block.kind === "list" || block.kind === "cards")
        return readColumns(anchor?.props["columns"]);
    if (block.kind === "detail" || block.kind === "input-form" || block.kind === "field")
        return readColumns(anchor?.props["fields"] ?? (anchor?.props["fieldId"] === undefined ? [] : [{ fieldId: anchor?.props["fieldId"] }]));
    // Search blocks: the displayed/queried fields live on the data source.
    const source = page.dataSources.find((entry) => blockIdOf(entry.id) === block.id);
    return (source?.fields ?? []).map((fieldId) => ({ fieldId }));
}
/** The (first) filter field a search block filters on, if any. */
export function blockSearchField(page, block) {
    const source = page.dataSources.find((entry) => blockIdOf(entry.id) === block.id);
    const filter = source?.filter;
    if (filter === undefined)
        return undefined;
    if (filter.type === "condition" && filter.field.kind === "data")
        return filter.field.fieldId;
    // Range/multi blocks use a group; report the first condition's field.
    if (filter.type === "group") {
        const first = filter.filters.find((f) => f.type === "condition" && f.field.kind === "data");
        if (first !== undefined && first.type === "condition" && first.field.kind === "data")
            return first.field.fieldId;
    }
    return undefined;
}
/** Whether a block is a search (produces query results to feed outputs). */
export function isSearchBlock(kind) {
    return kind === "search" || kind === "date-search" || kind === "select-search" || kind === "number-search" || kind === "multi-search";
}
/** Whether a block is a row/list output (feeds detail/field/actions via selection). */
export function isListBlock(kind) {
    return kind === "list" || kind === "cards";
}
// --- Self-query (cross-schema): a list/cards block that runs its OWN query,
//     filtered by a field value it receives from another form (도서관 예시). ---
/** Whether a list/cards block owns a self-query data source. */
export function hasSelfQuery(page, block) {
    return page.dataSources.some((entry) => entry.id === `${block.id}_query`);
}
/** The field id a self-query filters on (`param_link`), if configured. */
export function selfQueryFilterField(page, block) {
    const source = page.dataSources.find((entry) => entry.id === `${block.id}_query`);
    const filter = source?.filter;
    if (filter !== undefined && filter.type === "condition" && filter.field.kind === "data")
        return filter.field.fieldId;
    return undefined;
}
/**
 * Turns on (or reconfigures) a list/cards block's own query: it queries its own
 * Collection filtered by `filterFieldId = <param_link>`, and its rows feed the
 * block's table/cards. The `param_link` value is supplied by a cross-schema link
 * (`linkBlocksByField`). Idempotent — replaces any existing self-query.
 */
export function enableSelfQuery(page, block, filterFieldId) {
    if (!isListBlock(block.kind) || block.collectionId === undefined)
        return page;
    const cleared = disableSelfQuery(page, block);
    const queryId = `${block.id}_query`;
    const anchor = cleared.components.find((component) => component.id === block.anchorComponentId);
    const fields = blockFields(cleared, block).map((field) => field.fieldId);
    const dataSource = {
        // on-change so selecting a source row re-runs it automatically via param_link.
        id: queryId, type: "document-query", collectionId: block.collectionId, trigger: "on-change",
        fields, parameters: [{ id: "param_link", valueType: "string" }],
        filter: { type: "condition", field: { kind: "data", fieldId: filterFieldId }, operator: "eq", value: { type: "parameter", parameterId: "param_link" } },
        limit: 20,
    };
    const connection = anchor === undefined ? [] : [conn(`${block.id}_selfrows`, ds(queryId, "rows"), comp(anchor.id, "data"))];
    return {
        ...cleared,
        dataSources: [...cleared.dataSources, dataSource],
        connections: [...cleared.connections, ...connection],
    };
}
/** Removes a block's self-query data source and its rows connection. */
export function disableSelfQuery(page, block) {
    const queryId = `${block.id}_query`;
    return {
        ...page,
        dataSources: page.dataSources.filter((entry) => entry.id !== queryId),
        connections: page.connections.filter((connection) => connection.from.nodeId !== queryId && connection.to.nodeId !== queryId && connection.id !== `${block.id}_selfrows`),
    };
}
// --- Page-level block operations ---
/** Adds a block's atoms to a page below the existing content (no overlap). */
export function addBlockToPage(page, input) {
    const blockId = nextBlockId(page);
    const at = input.at ?? { x: 0, y: nextFreeRow(page) };
    const built = buildBlock(blockId, { ...input, at });
    return {
        blockId,
        page: {
            ...page,
            components: [...page.components, ...built.components],
            state: [...page.state, ...built.state],
            dataSources: [...page.dataSources, ...built.dataSources],
            connections: [...page.connections, ...built.connections],
        },
    };
}
/** Components that predate the form-block system (no `blk<n>_` prefix). */
export function legacyComponents(page) {
    return page.components.filter((component) => blockIdOf(component.id) === null);
}
/**
 * Removes every prefix-less legacy component (old palette / converted Generated
 * Page) and any state/data source/connection they touch. Form blocks (`blk<n>_`)
 * are untouched. Used to clean up pages built before the form-block editor.
 */
export function removeLegacyComponents(page) {
    const legacyIds = new Set(legacyComponents(page).map((component) => component.id));
    if (legacyIds.size === 0)
        return page;
    // A state/data source is "legacy" if it has no block prefix (blocks own theirs).
    const legacyNode = (nodeId) => blockIdOf(nodeId) === null;
    return {
        ...page,
        components: page.components.filter((component) => !legacyIds.has(component.id)),
        // Drop prefix-less state/data sources too (they belonged to the legacy graph).
        state: page.state.filter((entry) => !legacyNode(entry.id)),
        dataSources: page.dataSources.filter((entry) => !legacyNode(entry.id)),
        connections: page.connections.filter((connection) => !legacyNode(connection.from.nodeId) && !legacyNode(connection.to.nodeId)),
    };
}
/**
 * Duplicates a block: re-derives its config from the current atoms and adds a
 * fresh block (new id, placed below). Links to/from the original are not copied —
 * a copy starts unconnected, which is the least surprising behavior.
 */
export function duplicateBlock(page, block) {
    const anchor = page.components.find((component) => component.id === block.anchorComponentId);
    const at = anchor === undefined ? undefined : { x: anchor.placement.x, y: nextFreeRow(page) };
    return addBlockToPage(page, {
        kind: block.kind,
        collectionId: block.collectionId ?? "",
        fields: blockFields(page, block),
        ...(blockSearchField(page, block) === undefined ? {} : { searchFieldId: blockSearchField(page, block) }),
        ...(at === undefined ? {} : { at }),
    });
}
/** Removes a block and every atom (component/state/data source/connection) it owns. */
export function removeBlockFromPage(page, blockId) {
    const ownsAtom = (atomId) => blockIdOf(atomId) === blockId;
    const ownsNode = (nodeId) => ownsAtom(nodeId);
    return {
        ...page,
        components: page.components.filter((component) => !ownsAtom(component.id)),
        state: page.state.filter((entry) => !ownsAtom(entry.id)),
        dataSources: page.dataSources.filter((entry) => !ownsAtom(entry.id)),
        connections: page.connections.filter((connection) => !ownsNode(connection.from.nodeId) && !ownsNode(connection.to.nodeId)),
    };
}
/**
 * Rebuilds a block's atoms in place from new config (collection/fields/search
 * field), preserving the block id and the anchor component's placement. Other
 * blocks and their connections to this block survive because ids are stable.
 */
export function reconfigureBlock(page, block, config) {
    const anchor = page.components.find((component) => component.id === block.anchorComponentId);
    const at = anchor === undefined ? { x: 0, y: 0 } : { x: anchor.placement.x, y: anchor.placement.y };
    // Preserve any custom labels/text the user set, keyed by atom id, so a schema
    // or field change doesn't reset them.
    const priorText = new Map();
    for (const component of page.components) {
        if (blockIdOf(component.id) !== block.id)
            continue;
        priorText.set(component.id, { label: component.props["label"], text: component.props["text"] });
    }
    const stripped = removeBlockFromPage(page, block.id);
    const built = buildBlock(block.id, { kind: block.kind, collectionId: config.collectionId, fields: config.fields, ...(config.searchFieldId === undefined ? {} : { searchFieldId: config.searchFieldId }), at });
    const components = built.components.map((component) => {
        const prior = priorText.get(component.id);
        if (prior === undefined)
            return component;
        const props = { ...component.props };
        if (typeof prior.label === "string")
            props["label"] = prior.label;
        if (typeof prior.text === "string")
            props["text"] = prior.text;
        return { ...component, props };
    });
    return {
        ...stripped,
        components: [...stripped.components, ...components],
        state: [...stripped.state, ...built.state],
        dataSources: [...stripped.dataSources, ...built.dataSources],
        connections: [...stripped.connections, ...built.connections],
    };
}
export function blockLabels(page, block) {
    const roleOf = (component) => {
        if (component.kind === "core.button") {
            const label = typeof component.props["label"] === "string" ? component.props["label"] : "";
            return `버튼 (${label || component.id})`;
        }
        if (component.kind === "core.form")
            return "폼 제목";
        if (component.kind.startsWith("core.input."))
            return "입력 라벨";
        return null;
    };
    return page.components.flatMap((component) => {
        if (blockIdOf(component.id) !== block.id)
            return [];
        const role = roleOf(component);
        if (role === null)
            return [];
        return [{ componentId: component.id, role, value: typeof component.props["label"] === "string" ? component.props["label"] : "" }];
    });
}
/** Sets one component's label text directly (no rebuild), keeping everything else. */
export function setComponentLabel(page, componentId, label) {
    return {
        ...page,
        components: page.components.map((component) => component.id === componentId ? { ...component, props: { ...component.props, label } } : component),
    };
}
/**
 * Which output block kinds a source block kind can feed. Same-schema flow only
 * (slice 3-1): a search feeds a list (its rows) or a detail (its selected row);
 * a list feeds a detail (row selection). Cross-schema lookup is a later slice.
 */
export function canLinkBlocks(from, to, page) {
    if (from.id === to.id)
        return false;
    // A search feeds a row output (list/cards) with its query results.
    if (isSearchBlock(from.kind))
        return isListBlock(to.kind) || to.kind === "detail" || to.kind === "field";
    // A row output feeds a per-row consumer (detail/field/actions) via selection,
    // OR a cross-schema list/cards that runs its OWN query (self-query).
    if (isListBlock(from.kind)) {
        if (to.kind === "detail" || to.kind === "field" || to.kind === "item-actions")
            return true;
        if (isListBlock(to.kind) && page !== undefined && hasSelfQuery(page, to))
            return true;
    }
    return false;
}
/**
 * Cross-schema link (도서관 예시): the source list's selected-row value of
 * `sourceFieldId` feeds the target's self-query `param_link`, then re-runs it.
 * The target must already have a self-query (`enableSelfQuery`).
 */
export function linkBlocksByField(page, from, to, sourceFieldId) {
    if (!isListBlock(from.kind) || !isListBlock(to.kind) || !hasSelfQuery(page, to))
        return page;
    const output = page.components.find((entry) => entry.id === from.anchorComponentId);
    const queryId = `${to.id}_query`;
    if (output === undefined)
        return page;
    const stateId = `${to.id}_state_link`;
    const withState = page.state.some((entry) => entry.id === stateId)
        ? page
        : { ...page, state: [...page.state, { id: stateId, valueType: "string", initialValue: "" }] };
    let next = addLink(withState, `${to.id}_link_field`, comp(output.id, `selectedField:${sourceFieldId}`), state_(stateId, "write"));
    next = addLink(next, `${to.id}_link_param`, state_(stateId, "value"), ds(queryId, "parameter:param_link"));
    return next;
}
/**
 * Creates the internal atoms/connections that realize a form-to-form link.
 * search→list/cards: the search query's rows feed the output.
 * *→detail/field/actions: the source's selected row feeds the consumer via a
 * shared `<toBlockId>_state_target` document-id state (list writes it on select).
 */
export function linkBlocks(page, from, to) {
    if (!canLinkBlocks(from, to))
        return page;
    if (isSearchBlock(from.kind) && isListBlock(to.kind)) {
        const query = page.dataSources.find((entry) => blockIdOf(entry.id) === from.id);
        const output = page.components.find((entry) => entry.id === to.anchorComponentId);
        if (query === undefined || output === undefined)
            return page;
        return addLink(page, `${to.id}_link_rows`, ds(query.id, "rows"), comp(output.id, "data"));
    }
    // *→detail/field/item-actions: route the source's selected row via a state.
    const consumer = page.components.find((entry) => entry.id === to.anchorComponentId);
    if (consumer === undefined)
        return page;
    // The document-id state the consumer reads (item-actions declares it itself).
    const stateId = `${to.id}_state_target`;
    const withState = page.state.some((entry) => entry.id === stateId)
        ? page
        : { ...page, state: [...page.state, { id: stateId, valueType: "document-id", initialValue: null }] };
    let next = withState;
    // detail/field consume documentId; item-actions already reference the state.
    if (to.kind === "detail" || to.kind === "field") {
        next = addLink(next, `${to.id}_link_bind`, state_(stateId, "value"), comp(consumer.id, "documentId"));
    }
    if (isListBlock(from.kind)) {
        const output = page.components.find((entry) => entry.id === from.anchorComponentId);
        if (output !== undefined)
            next = addLink(next, `${to.id}_link_select`, comp(output.id, "selectedDocumentId"), state_(stateId, "write"));
    }
    return next;
}
/** Removes the atoms/connections a form-to-form link created (by its id prefix). */
export function unlinkBlocks(page, from, to) {
    const linkPrefix = `${to.id}_link_`;
    const keptConnections = page.connections.filter((connection) => !connection.id.startsWith(linkPrefix));
    void from;
    // Drop link-only states (`_state_target`, `_state_link`) that nothing else uses.
    // item-actions declares its own `_state_target`, so keep that one.
    const linkStates = [`${to.id}_state_link`];
    if (to.kind !== "item-actions")
        linkStates.push(`${to.id}_state_target`);
    const orphaned = new Set(linkStates.filter((stateId) => !keptConnections.some((c) => c.from.nodeId === stateId || c.to.nodeId === stateId)));
    return {
        ...page,
        connections: keptConnections,
        state: page.state.filter((entry) => !orphaned.has(entry.id)),
    };
}
/** The form-to-form links currently on a page, derived from `_link_` connections. */
export function blockLinks(page) {
    const links = new Map();
    const byComponent = new Map();
    for (const block of describeBlocks(page)) {
        for (const componentId of block.componentIds)
            byComponent.set(componentId, block.id);
    }
    for (const connection of page.connections) {
        const match = /^(blk\d+)_link_/.exec(connection.id);
        if (match === null)
            continue;
        const toBlockId = match[1];
        // The other endpoint that is not the target block identifies the source.
        const endpoints = [connection.from.nodeId, connection.to.nodeId]
            .map((nodeId) => byComponent.get(nodeId) ?? blockIdOf(nodeId))
            .filter((id) => id !== null && id !== toBlockId);
        const fromBlockId = endpoints[0];
        if (fromBlockId !== undefined)
            links.set(`${fromBlockId}->${toBlockId}`, { fromBlockId, toBlockId });
    }
    return [...links.values()];
}
function addLink(page, id, from, to) {
    if (page.connections.some((connection) => connection.id === id))
        return page;
    return { ...page, connections: [...page.connections, conn(id, from, to)] };
}
/** First empty grid row below every existing component. */
function nextFreeRow(page) {
    const lowest = page.components.reduce((max, component) => Math.max(max, component.placement.y + component.placement.height), 0);
    return lowest === 0 ? 0 : lowest + 2;
}
//# sourceMappingURL=form-blocks.js.map