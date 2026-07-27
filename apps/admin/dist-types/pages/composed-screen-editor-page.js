import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import { validateAdminAppManifestV2, convertGeneratedToComposed, masterDetailPreset, searchListPreset, viewEditPreset, } from "@xecms/admin-apps";
import { CANVAS_WIDTH, COLUMN_WIDTH, ROW_HEIGHT, SHELL_WIDTH, baseViewportHeight, computeShellScale, } from "@xecms/admin-runtime/geometry";
import { XeCmsApiError, } from "@xecms/client";
import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import { xecmsClient as client } from "../xecms-client.js";
import { ComposedCanvas } from "./composed-editor/canvas.js";
import { addBlockToPage, blockFields, blockIdOf, blockKindLabel, blockLinks, canLinkBlocks, describeBlocks, duplicateBlock, hasSelfQuery, isListBlock, legacyComponents, linkBlocks, linkBlocksByField, removeBlockFromPage, removeLegacyComponents, unlinkBlocks, } from "./composed-editor/form-blocks.js";
import { FormBlockPanel } from "./composed-editor/form-block-panel.js";
import { PreviewModal } from "./composed-editor/preview-modal.js";
import { LivePreviewCell } from "./composed-editor/live-preview.js";
import { useManifestHistory } from "./composed-editor/use-manifest-history.js";
import { DetailPanel } from "./composed-editor/detail-panel.js";
import { TablePanel } from "./composed-editor/table-panel.js";
import { AdaptivePanel } from "./composed-editor/adaptive-panel.js";
import { ButtonPanel } from "./composed-editor/button-panel.js";
import { FormPanel } from "./composed-editor/form-panel.js";
import { requiredPermissions } from "./composed-editor/permissions.js";
import { removeComponent, replacePage, updateComponentEvents, updateComponentProps, updatePlacement, } from "./composed-editor/model.js";
import styles from "./composed-screen-editor.module.css";
const MENU_WIDTH = 240;
/** Palette groups the form blocks the user can add, in user-facing categories. */
const PALETTE_GROUPS = [
    { title: "검색", kinds: ["search", "date-search", "select-search", "number-search", "multi-search"] },
    { title: "출력", kinds: ["list", "cards", "detail", "field"] },
    { title: "입력·작업", kinds: ["input-form", "item-actions"] },
];
export function ComposedScreenEditorPage() {
    const { appId = "" } = useParams();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [app, setApp] = useState(null);
    const [draft, setDraft] = useState(null);
    const history = useManifestHistory();
    const { manifest, undo, redo, canUndo, canRedo } = history;
    const setManifest = history.set;
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const [collections, setCollections] = useState([]);
    const [mode, setMode] = useState("layout");
    const [selectedId, setSelectedId] = useState(null);
    const [selectedConnectionId, setSelectedConnectionId] = useState(null);
    // Connect mode: the block picked as the link source ("이 검색폼에서 →").
    const [pendingLinkBlockId, setPendingLinkBlockId] = useState(null);
    const [issuesOpen, setIssuesOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const savedJson = useRef("");
    const dirty = manifest !== null && JSON.stringify(manifest) !== savedJson.current;
    // Keyboard shortcuts read the latest handlers through a ref so this effect
    // binds once (the derived selection/active values live after the early returns).
    const shortcutsRef = useRef({ undo: () => { }, redo: () => { }, deleteSelected: () => { }, duplicateSelected: () => { }, save: () => { } });
    useEffect(() => {
        const onKeyDown = (event) => {
            const target = event.target;
            // Don't hijack typing in inputs/selects/textareas.
            if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
                return;
            const meta = event.metaKey || event.ctrlKey;
            if (meta && event.key.toLowerCase() === "z") {
                event.preventDefault();
                if (event.shiftKey)
                    shortcutsRef.current.redo();
                else
                    shortcutsRef.current.undo();
            }
            else if (meta && event.key.toLowerCase() === "y") {
                event.preventDefault();
                shortcutsRef.current.redo();
            }
            else if (meta && event.key.toLowerCase() === "s") {
                event.preventDefault();
                shortcutsRef.current.save();
            }
            else if (meta && event.key.toLowerCase() === "d") {
                event.preventDefault();
                shortcutsRef.current.duplicateSelected();
            }
            else if (event.key === "Delete" || event.key === "Backspace") {
                shortcutsRef.current.deleteSelected();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const [nextApp, nextDraft, schema] = await Promise.all([
                    client.adminApps.get(appId),
                    client.adminApps.getDraft(appId),
                    client.collections.list(),
                ]);
                if (!active)
                    return;
                setApp(nextApp);
                setDraft(nextDraft);
                setCollections(schema.items.filter(({ status }) => status === "applied"));
                if (nextDraft?.manifest.formatVersion === 2) {
                    history.reset(nextDraft.manifest);
                    savedJson.current = JSON.stringify(nextDraft.manifest);
                }
            }
            catch (caught) {
                if (active)
                    setError(message(caught));
            }
            finally {
                if (active)
                    setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [appId]);
    const composedPages = useMemo(() => (manifest?.pages.filter((page) => page.type === "composed-page") ?? []), [manifest]);
    const activePageId = searchParams.get("page") ?? composedPages[0]?.id ?? null;
    const active = composedPages.find((page) => page.id === activePageId) ?? composedPages[0] ?? null;
    const save = async () => {
        if (manifest === null || draft === null)
            return;
        setPending(true);
        setError(null);
        try {
            const saved = await client.adminApps.saveDraft(appId, {
                expectedDraftVersion: draft.draftVersion,
                expectedBaseRevisionId: draft.baseRevisionId,
                manifest,
            });
            setDraft(saved);
            if (saved.manifest.formatVersion === 2) {
                history.reset(saved.manifest);
                savedJson.current = JSON.stringify(saved.manifest);
            }
        }
        catch (caught) {
            setError(caught instanceof XeCmsApiError && caught.status === 409
                ? "다른 곳에서 Draft가 변경되었습니다. 페이지를 새로고침해 주세요."
                : message(caught));
        }
        finally {
            setPending(false);
        }
    };
    if (loading)
        return _jsx(LoadingIndicator, { label: "\uD654\uBA74 \uD3B8\uC9D1\uAE30\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" });
    if (error !== null && manifest === null) {
        return _jsx(FullscreenNotice, { title: "\uD3B8\uC9D1\uAE30\uB97C \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4", detail: error, onBack: () => navigate(`/admin/apps/${appId}`) });
    }
    if (app === null || draft === null) {
        return _jsx(FullscreenNotice, { title: "Draft\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4", detail: "\uBE4C\uB354\uC5D0\uC11C Draft\uB97C \uB9CC\uB4E0 \uB4A4 \uD654\uBA74\uC744 \uD3B8\uC9D1\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", onBack: () => navigate(`/admin/apps/${appId}`) });
    }
    if (manifest === null) {
        return _jsx(FullscreenNotice, { title: "Composed App\uC774 \uC544\uB2D9\uB2C8\uB2E4", detail: "\uC774 \uD654\uBA74 \uD3B8\uC9D1\uAE30\uB294 Composed(V2) App\uC5D0\uC11C\uB9CC \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uBE4C\uB354\uC5D0\uC11C V2\uB85C \uC5C5\uADF8\uB808\uC774\uB4DC\uD558\uC138\uC694.", onBack: () => navigate(`/admin/apps/${appId}`) });
    }
    const commit = (nextPage) => setManifest(replacePage(manifest, nextPage.id, nextPage));
    /** Inserts a Composed Page plus a navigation entry, then focuses it. */
    const addPage = (page) => {
        const navId = uniqueId(`nav-${composedPages.length + 1}`, manifest.navigation.map((item) => item.id));
        setManifest({
            ...manifest,
            pages: [...manifest.pages, page],
            navigation: [...manifest.navigation, { id: navId, label: page.menuLabel, pageId: page.id }],
        });
        setSearchParams({ page: page.id });
    };
    const nextScreenMeta = () => {
        const index = composedPages.length + 1;
        const pageId = uniqueId(`pg-screen-${index}`, manifest.pages.map((page) => page.id));
        return { pageId, screenNo: `SCR-${String(index).padStart(3, "0")}`, title: `화면 ${index}`, menuLabel: `화면 ${index}` };
    };
    const addScreen = () => {
        const meta = nextScreenMeta();
        addPage({
            id: meta.pageId, type: "composed-page", screenNo: meta.screenNo, title: meta.title, menuLabel: meta.menuLabel,
            layout: { columns: 48, rowHeight: 8 }, state: [], dataSources: [], components: [], connections: [],
        });
    };
    /** Adds a Composed Page from a built-in Preset, seeded from a Collection's fields. */
    const addPreset = (kind, collectionId) => {
        const collection = collections.find((entry) => entry.id === collectionId);
        if (collection === undefined || collection.fields.length === 0)
            return;
        const meta = nextScreenMeta();
        const searchFieldId = collection.fields[0].id;
        const columns = collection.fields.slice(0, 4).map((field) => ({
            fieldId: field.id, label: field.label ?? field.name,
            ...(field.sensitivity?.defaultMaskPolicyId === undefined ? {} : { maskPolicyId: field.sensitivity.defaultMaskPolicyId }),
        }));
        const detailFields = columns;
        if (kind === "searchList") {
            addPage(searchListPreset({ meta, collectionId, searchFieldId, columns }));
        }
        else if (kind === "masterDetail") {
            addPage(masterDetailPreset({ meta, collectionId, searchFieldId, listColumns: columns, detailFields }));
        }
        else {
            addPage(viewEditPreset({ meta, collectionId, searchFieldId, listColumns: columns, detailFields, formFieldIds: columns.map((c) => c.fieldId) }));
        }
    };
    /** Copies a Generated Page in this manifest into a new, independent Composed Page. */
    const convertGenerated = (generatedPageId) => {
        const generated = manifest.pages.find((page) => page.id === generatedPageId);
        if (generated === undefined || generated.type === "composed-page")
            return;
        const composed = convertGeneratedToComposed(generated, nextScreenMeta());
        if (composed === null) {
            setError("이 Generated Page는 아직 Composed로 변환할 수 없습니다.");
            return;
        }
        addPage(composed);
    };
    const patchActiveMeta = (patch) => {
        if (active === null)
            return;
        const nextPage = { ...active, ...patch };
        // The App menu shows the nav label; keep it in sync with the screen's menuLabel.
        const navigation = patch.menuLabel === undefined
            ? manifest.navigation
            : manifest.navigation.map((item) => item.pageId === active.id ? { ...item, label: patch.menuLabel } : item);
        setManifest({ ...replacePage(manifest, active.id, nextPage), navigation });
    };
    /** Removes the active screen (its page + navigation entry) and focuses another. */
    const removeScreen = () => {
        if (active === null)
            return;
        if (composedPages.length <= 1) {
            setError("마지막 화면은 삭제할 수 없습니다.");
            return;
        }
        if (typeof window !== "undefined" && !window.confirm(`화면 '${active.title || active.id}'을(를) 삭제할까요?`))
            return;
        const remaining = manifest.pages.filter((page) => page.id !== active.id);
        const nextManifest = {
            ...manifest,
            pages: remaining,
            navigation: manifest.navigation.filter((item) => item.pageId !== active.id),
            startPageId: manifest.startPageId === active.id
                ? (remaining.find((page) => page.type === "composed-page")?.id ?? remaining[0]?.id ?? manifest.startPageId)
                : manifest.startPageId,
        };
        setManifest(nextManifest);
        setSelectedId(null);
        const nextFocus = nextManifest.pages.find((page) => page.type === "composed-page");
        if (nextFocus !== undefined)
            setSearchParams({ page: nextFocus.id });
    };
    /** Moves the active screen earlier/later in the page + navigation order. */
    const moveScreen = (direction) => {
        if (active === null)
            return;
        const order = composedPages.map((page) => page.id);
        const from = order.indexOf(active.id);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= order.length)
            return;
        // Reorder within the composed-page positions of the full pages array.
        const composedPositions = manifest.pages.flatMap((page, index) => page.type === "composed-page" ? [index] : []);
        const pages = [...manifest.pages];
        const a = composedPositions[from];
        const b = composedPositions[to];
        [pages[a], pages[b]] = [pages[b], pages[a]];
        // Mirror the order in navigation (keep entries for these two pages swapped).
        const navFrom = manifest.navigation.findIndex((item) => item.pageId === order[from]);
        const navTo = manifest.navigation.findIndex((item) => item.pageId === order[to]);
        const navigation = [...manifest.navigation];
        if (navFrom >= 0 && navTo >= 0)
            [navigation[navFrom], navigation[navTo]] = [navigation[navTo], navigation[navFrom]];
        setManifest({ ...manifest, pages, navigation });
    };
    /** Adds a form block seeded from a Collection's first fields; user refines in the inspector. */
    const addFormBlock = (kind) => {
        if (active === null)
            return;
        const collection = collections[0];
        if (collection === undefined) {
            setError("먼저 스키마(Collection)를 만들어 주세요.");
            return;
        }
        const fields = collection.fields.slice(0, 4).map((field) => ({
            fieldId: field.id, label: field.label ?? field.name,
            ...(field.sensitivity?.defaultMaskPolicyId === undefined ? {} : { maskPolicyId: field.sensitivity.defaultMaskPolicyId }),
        }));
        const { page, blockId } = addBlockToPage(active, { kind, collectionId: collection.id, fields });
        commit(page);
        const block = describeBlocks(page).find((entry) => entry.id === blockId);
        if (block !== undefined) {
            setSelectedId(block.anchorComponentId);
            setSelectedConnectionId(null);
        }
    };
    /** Connect mode: clicking a block picks it as source, then a target to link. */
    const onBlockClick = (componentId) => {
        if (active === null)
            return;
        // The canvas hands us the clicked component id; map it to its owning block.
        const blockId = blockIdOf(componentId);
        if (blockId === null)
            return;
        const blocks = describeBlocks(active);
        if (pendingLinkBlockId === null) {
            setPendingLinkBlockId(blockId);
            return;
        }
        if (pendingLinkBlockId === blockId) {
            setPendingLinkBlockId(null);
            return;
        }
        const from = blocks.find((block) => block.id === pendingLinkBlockId);
        const to = blocks.find((block) => block.id === blockId);
        if (from !== undefined && to !== undefined && canLinkBlocks(from, to, active)) {
            // Cross-schema: target runs its own query → feed it a source-row field value.
            if (isListBlock(from.kind) && isListBlock(to.kind) && hasSelfQuery(active, to)) {
                const sourceFieldId = blockFields(active, from)[0]?.fieldId;
                if (sourceFieldId !== undefined)
                    commit(linkBlocksByField(active, from, to, sourceFieldId));
            }
            else {
                commit(linkBlocks(active, from, to));
            }
        }
        setPendingLinkBlockId(null);
    };
    const selected = active?.components.find(({ id }) => id === selectedId) ?? null;
    // A selected component that belongs to a form block → edit the whole block.
    const selectedBlock = active !== null && selectedId !== null
        ? describeBlocks(active).find((block) => block.componentIds.includes(selectedId)) ?? null
        : null;
    // The Collection a table renders = the collection of the Data Source feeding its `data` port.
    const tableCollectionId = selected?.kind === "core.output.table" && active !== null
        ? tableSourceCollectionId(active, selected.id) : undefined;
    const issues = validateAdminAppManifestV2(manifest).issues;
    const legacyCount = active === null ? 0 : legacyComponents(active).length;
    // Component ids on the active page that have a validation issue (for canvas
    // badges). A plain computation (not a hook) — it runs after early returns.
    const issueComponentIds = (() => {
        const ids = new Set();
        if (active === null)
            return ids;
        const pageIndex = manifest.pages.findIndex((page) => page.id === active.id);
        for (const issue of issues) {
            const [root, pIdx, section, cIdx] = issue.path;
            if (root === "pages" && pIdx === pageIndex && section === "components" && typeof cIdx === "number") {
                const component = active.components[cIdx];
                if (component !== undefined)
                    ids.add(component.id);
            }
        }
        return ids;
    })();
    // Keep the keyboard shortcut handlers pointed at the current selection/state.
    const deleteSelected = () => {
        if (active === null || selectedBlock === null)
            return;
        commit(removeBlockFromPage(active, selectedBlock.id));
        setSelectedId(null);
    };
    const duplicateSelected = () => {
        if (active === null || selectedBlock === null)
            return;
        const result = duplicateBlock(active, selectedBlock);
        commit(result.page);
        const block = describeBlocks(result.page).find((entry) => entry.id === result.blockId);
        if (block !== undefined)
            setSelectedId(block.anchorComponentId);
    };
    shortcutsRef.current = { undo, redo, deleteSelected, duplicateSelected, save: () => { void save(); } };
    return (_jsxs("div", { className: styles.workspace, children: [_jsx(UnsavedChangesGuard, { when: dirty }), _jsxs("header", { className: styles.topbar, children: [_jsxs("div", { className: styles.topbarLeft, children: [_jsx(Button, { size: "small", variant: "secondary", onPress: () => navigate(`/admin/apps/${appId}`), children: "\u2190 \uBE4C\uB354\uB85C" }), _jsx("strong", { children: app.name }), _jsx("select", { value: active?.id ?? "", onChange: (event) => setSearchParams({ page: event.target.value }), "aria-label": "\uD3B8\uC9D1\uD560 \uD654\uBA74", children: composedPages.map((page) => _jsxs("option", { value: page.id, children: [page.screenNo, " \u00B7 ", page.title] }, page.id)) }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => addScreen(), children: "+ \uBE48 \uD654\uBA74" }), _jsx(PresetMenu, { collections: collections, generatedPages: manifest.pages.filter((page) => page.type !== "composed-page"), onPreset: addPreset, onConvert: convertGenerated }), active !== null && legacyCount > 0 ? (_jsxs(Button, { size: "small", variant: "secondary", onPress: () => {
                                    if (typeof window !== "undefined" && !window.confirm(`이 화면에서 편집할 수 없는 이전 폼 ${legacyCount}개를 삭제할까요?`))
                                        return;
                                    commit(removeLegacyComponents(active));
                                    setSelectedId(null);
                                }, children: ["\uC774\uC804 \uD3FC \uC815\uB9AC (", legacyCount, ")"] })) : null] }), _jsxs("div", { className: styles.topbarRight, children: [_jsxs("div", { className: styles.undoRedo, children: [_jsx("button", { type: "button", onClick: undo, disabled: !canUndo, title: "\uC2E4\uD589 \uCDE8\uC18C (Ctrl+Z)", "aria-label": "\uC2E4\uD589 \uCDE8\uC18C", children: "\u21B6" }), _jsx("button", { type: "button", onClick: redo, disabled: !canRedo, title: "\uB2E4\uC2DC \uC2E4\uD589 (Ctrl+Shift+Z)", "aria-label": "\uB2E4\uC2DC \uC2E4\uD589", children: "\u21B7" })] }), _jsxs("div", { className: styles.modeToggle, role: "tablist", "aria-label": "\uD3B8\uC9D1 \uBAA8\uB4DC", children: [_jsx("button", { type: "button", role: "tab", "aria-selected": mode === "layout", onClick: () => { setMode("layout"); setPendingLinkBlockId(null); }, children: "\uBC30\uCE58" }), _jsx("button", { type: "button", role: "tab", "aria-selected": mode === "connect", onClick: () => { setMode("connect"); setSelectedId(null); }, children: "\uC5F0\uACB0" })] }), mode === "connect" ? (_jsx("span", { className: styles.connectHint, children: pendingLinkBlockId === null ? "연결할 검색폼을 누르세요" : "결과를 받을 폼을 누르세요" })) : null, issues.length > 0 ? (_jsxs("button", { type: "button", className: styles.issueBadge, onClick: () => setIssuesOpen((open) => !open), "aria-expanded": issuesOpen, children: [issues.length, "\uAC1C \uBB38\uC81C ", issuesOpen ? "▲" : "▼"] })) : null, _jsx(Button, { size: "small", variant: "secondary", onPress: () => setPreviewOpen(true), isDisabled: composedPages.length === 0, children: "\uBBF8\uB9AC\uBCF4\uAE30" }), _jsx(Button, { size: "small", onPress: () => void save(), isDisabled: pending || !dirty, children: pending ? "저장 중…" : "저장" })] })] }), error !== null ? _jsx(Callout, { tone: "error", children: error }) : null, issues.length > 0 && issuesOpen ? (_jsxs("div", { className: styles.issuePanel, role: "region", "aria-label": "\uAC80\uC99D \uBB38\uC81C", children: [_jsx("ul", { children: issues.slice(0, 20).map((issue, index) => {
                            const componentId = issueComponentId(manifest, active, issue);
                            return (_jsx("li", { children: componentId !== null ? (_jsxs("button", { type: "button", className: styles.issueJump, onClick: () => { setMode("layout"); setSelectedId(componentId); }, children: [friendlyIssue(issue.code, issue.message), " ", _jsx("span", { "aria-hidden": "true", children: "\u2192 \uC774\uB3D9" })] })) : friendlyIssue(issue.code, issue.message) }, index));
                        }) }), issues.length > 20 ? _jsxs("p", { className: styles.paletteHint, children: ["\uC678 ", issues.length - 20, "\uAC74"] }) : null] })) : null, _jsxs("div", { className: styles.body, children: [_jsx("aside", { className: styles.palette, "aria-label": "\uD3FC \uBE14\uB85D \uD314\uB808\uD2B8", children: mode === "layout" ? (_jsxs(_Fragment, { children: [PALETTE_GROUPS.map((group) => (_jsxs("section", { children: [_jsx("h4", { children: group.title }), group.kinds.map((kind) => (_jsxs("button", { type: "button", className: styles.paletteItem, onClick: () => addFormBlock(kind), disabled: active === null, children: ["+ ", blockKindLabel(kind)] }, kind)))] }, group.title))), _jsx("p", { className: styles.paletteHint, children: "\uD3FC\uC744 \uB193\uC73C\uBA74 \uC2A4\uD0A4\uB9C8 \uCCAB \uD544\uB4DC\uB85C \uCC44\uC6CC\uC9D1\uB2C8\uB2E4. \uD3FC\uC744 \uC120\uD0DD\uD574 \uC2A4\uD0A4\uB9C8\u00B7\uD544\uB4DC\uB97C \uBC14\uAFB8\uC138\uC694." })] })) : (_jsxs("section", { children: [_jsx("h4", { children: "\uD3FC \uC5F0\uACB0" }), _jsx("p", { className: styles.paletteHint, children: "\uAC80\uC0C9\uD3FC\uC744 \uBAA9\uB85D\u00B7\uC0C1\uC138 \uD3FC\uC5D0 \uC5F0\uACB0\uD558\uBA74, \uAC80\uC0C9 \uACB0\uACFC\uAC00 \uADF8 \uD3FC\uC73C\uB85C \uD758\uB7EC\uAC11\uB2C8\uB2E4." })] })) }), _jsx("div", { className: styles.stage, children: active === null ? (_jsx("p", { className: styles.stageEmpty, children: "\uD3B8\uC9D1\uD560 Composed \uD654\uBA74\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." })) : (_jsx(AppShellFrame, { manifest: manifest, activePageId: active.id, children: (scale) => (_jsxs(_Fragment, { children: [mode === "layout" && active.components.length === 0 ? (_jsxs("div", { className: styles.onboarding, role: "note", children: [_jsx("strong", { children: "\uC774 \uD654\uBA74\uC740 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4" }), _jsxs("p", { children: ["\uC67C\uCABD ", _jsx("b", { children: "\uD3FC \uCD94\uAC00" }), "\uC5D0\uC11C \uD3FC\uC744 \uB193\uC544 \uC2DC\uC791\uD558\uC138\uC694. \uBCF4\uD1B5 \uC774\uB807\uAC8C \uB9CC\uB4ED\uB2C8\uB2E4:"] }), _jsxs("ol", { children: [_jsxs("li", { children: [_jsx("b", { children: "\uAC80\uC0C9\uD3FC" }), "\uC73C\uB85C \uC2A4\uD0A4\uB9C8\u00B7\uAC80\uC0C9 \uC870\uAC74\uC744 \uC815\uD558\uACE0"] }), _jsxs("li", { children: [_jsx("b", { children: "\uBAA9\uB85D\uD45C" }), "\uB97C \uCD94\uAC00\uD574 ", _jsx("b", { children: "\uC5F0\uACB0 \uBAA8\uB4DC" }), "\uC5D0\uC11C \uAC80\uC0C9\uD3FC\uACFC \uC774\uC73C\uBA74"] }), _jsxs("li", { children: ["\uC870\uD68C \uACB0\uACFC\uAC00 \uBAA9\uB85D\uC5D0 \uB098\uC635\uB2C8\uB2E4. ", _jsx("b", { children: "\uC0C1\uC138" }), "\uB3C4 \uBAA9\uB85D\uC5D0 \uC774\uC5B4 \uBD99\uC77C \uC218 \uC788\uC5B4\uC694."] })] }), _jsxs("div", { className: styles.onboardingActions, children: [_jsx(Button, { size: "small", onPress: () => addFormBlock("search"), children: "\uAC80\uC0C9\uD3FC \uCD94\uAC00" }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => addFormBlock("list"), children: "\uBAA9\uB85D\uD45C \uCD94\uAC00" })] })] })) : null, _jsx(ComposedCanvas, { page: active, selectedId: selectedId, locked: mode === "connect", scale: scale, profile: manifest.presentation.layoutProfile, onSelect: (id) => { setSelectedId(id); setSelectedConnectionId(null); }, onPlace: (id, placement) => commit(updatePlacement(active, id, placement)), onLockedActivate: onBlockClick, cellTone: mode === "connect" ? (id) => blockCellTone(active, id, pendingLinkBlockId) : undefined, cellHasIssue: (id) => issueComponentIds.has(id), overlay: mode === "connect" ? (_jsx(BlockLinkOverlay, { page: active, pendingLinkBlockId: pendingLinkBlockId, onUnlink: (link) => {
                                                const blocks = describeBlocks(active);
                                                const from = blocks.find((b) => b.id === link.fromBlockId);
                                                const to = blocks.find((b) => b.id === link.toBlockId);
                                                if (from !== undefined && to !== undefined)
                                                    commit(unlinkBlocks(active, from, to));
                                            } })) : undefined, renderComponent: (component) => (mode === "connect"
                                            ? _jsx(BlockPreview, { component: component })
                                            : _jsx("div", { className: styles.livePreview, children: _jsx(LivePreviewCell, { component: component, collections: collections }) })) })] })) })) }), _jsx("aside", { className: styles.inspector, "aria-label": "\uC18D\uC131", children: selectedBlock !== null && active !== null ? (_jsx(FormBlockPanel, { page: active, block: selectedBlock, collections: collections, onChange: (next) => commit(next), onDuplicate: duplicateSelected, onRemove: () => { commit(removeBlockFromPage(active, selectedBlock.id)); setSelectedId(null); } })) : selected !== null && selected.kind === "core.output.detail" && active !== null ? (_jsx(DetailPanel, { component: selected, collections: collections, onChangeProps: (props) => commit(updateComponentProps(active, selected.id, props)), onRemove: () => { commit(removeComponent(active, selected.id)); setSelectedId(null); } })) : selected !== null && selected.kind === "core.input.adaptive" && active !== null ? (_jsx(AdaptivePanel, { component: selected, onChangeProps: (props) => commit(updateComponentProps(active, selected.id, props)), onRemove: () => { commit(removeComponent(active, selected.id)); setSelectedId(null); } })) : selected !== null && selected.kind === "core.output.table" && active !== null ? (_jsx(TablePanel, { component: selected, collectionId: tableCollectionId, collections: collections, onChangeProps: (props) => commit(updateComponentProps(active, selected.id, props)), onRemove: () => { commit(removeComponent(active, selected.id)); setSelectedId(null); } })) : selected !== null && selected.kind === "core.form" && active !== null ? (_jsx(FormPanel, { component: selected, collections: collections, onChangeProps: (props) => commit(updateComponentProps(active, selected.id, props)), onRemove: () => { commit(removeComponent(active, selected.id)); setSelectedId(null); } })) : selected !== null && selected.kind === "core.button" && active !== null ? (_jsx(ButtonPanel, { component: selected, pages: composedPages, page: active, collections: collections, onChangeProps: (props) => commit(updateComponentProps(active, selected.id, props)), onChangeEvents: (events) => commit(updateComponentEvents(active, selected.id, events)), onRemove: () => { commit(removeComponent(active, selected.id)); setSelectedId(null); } })) : selected !== null ? (_jsxs("div", { className: styles.inspectorBody, children: [_jsx("h4", { children: selected.kind }), _jsx("code", { children: selected.id }), _jsxs("label", { className: styles.inspectorField, children: [_jsx("span", { children: "Label" }), _jsx("input", { value: typeof selected.props["label"] === "string" ? selected.props["label"] : "", onChange: (event) => active !== null && commit(updateComponentProps(active, selected.id, { ...selected.props, label: event.target.value })) })] }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => { if (active !== null) {
                                        commit(removeComponent(active, selected.id));
                                        setSelectedId(null);
                                    } }, children: "Component \uC81C\uAC70" })] })) : active !== null ? (_jsxs("div", { className: styles.inspectorBody, children: [_jsx("h4", { children: "\uD654\uBA74 \uC124\uC815" }), _jsxs("label", { className: styles.inspectorField, children: [_jsx("span", { children: "\uD654\uBA74\uBC88\uD638" }), _jsx("input", { value: active.screenNo, onChange: (event) => patchActiveMeta({ screenNo: event.target.value }) })] }), _jsxs("label", { className: styles.inspectorField, children: [_jsx("span", { children: "\uD654\uBA74\uBA85" }), _jsx("input", { value: active.title, onChange: (event) => patchActiveMeta({ title: event.target.value }) })] }), _jsxs("label", { className: styles.inspectorField, children: [_jsx("span", { children: "\uBA54\uB274\uBA85" }), _jsx("input", { value: active.menuLabel, onChange: (event) => patchActiveMeta({ menuLabel: event.target.value }) })] }), _jsxs("div", { className: styles.inspectorField, children: [_jsx("span", { children: "\uD654\uBA74 \uC21C\uC11C" }), _jsxs("div", { className: styles.dataFieldRow, children: [_jsx(Button, { size: "small", variant: "secondary", onPress: () => moveScreen(-1), isDisabled: composedPages.findIndex((p) => p.id === active.id) <= 0, children: "\u2191 \uC704\uB85C" }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => moveScreen(1), isDisabled: composedPages.findIndex((p) => p.id === active.id) >= composedPages.length - 1, children: "\u2193 \uC544\uB798\uB85C" })] })] }), _jsx(Button, { size: "small", variant: "secondary", onPress: removeScreen, isDisabled: composedPages.length <= 1, children: "\uC774 \uD654\uBA74 \uC0AD\uC81C" }), _jsx(RolePreview, { page: active, collections: collections }), _jsx("p", { className: styles.inspectorEmpty, children: "Component\uB97C \uC120\uD0DD\uD558\uBA74 \uC18D\uC131\uC744 \uD3B8\uC9D1\uD569\uB2C8\uB2E4." })] })) : (_jsx("p", { className: styles.inspectorEmpty, children: "Component\uB97C \uC120\uD0DD\uD558\uC138\uC694." })) })] }), previewOpen ? (_jsx(PreviewModal, { manifest: manifest, collections: collections, initialPageId: active?.id ?? "", schemaRevisionId: null, onClose: () => setPreviewOpen(false) })) : null] }));
}
/**
 * "Preset에서 시작" and "Generated Page 복제" entry points. Presets and the
 * converter are pure templates that produce the same Composed Page contract as
 * hand-built screens, so the author can freely edit the result afterwards.
 */
function PresetMenu({ collections, generatedPages, onPreset, onConvert }) {
    const [open, setOpen] = useState(false);
    const [collectionId, setCollectionId] = useState("");
    const activeCollection = collectionId !== "" ? collectionId : collections[0]?.id ?? "";
    if (!open) {
        return _jsx(Button, { size: "small", variant: "secondary", onPress: () => setOpen(true), children: "+ Preset\uC5D0\uC11C" });
    }
    return (_jsxs("div", { className: styles.presetMenu, role: "group", "aria-label": "Preset\uC5D0\uC11C \uD654\uBA74 \uCD94\uAC00", children: [_jsx("select", { value: activeCollection, onChange: (event) => setCollectionId(event.target.value), "aria-label": "Preset Collection", children: collections.length === 0 ? _jsx("option", { value: "", children: "Collection \uC5C6\uC74C" })
                    : collections.map((entry) => _jsx("option", { value: entry.id, children: entry.label ?? entry.name }, entry.id)) }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => { if (activeCollection !== "")
                    onPreset("searchList", activeCollection); setOpen(false); }, children: "\uAC80\uC0C9+\uBAA9\uB85D" }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => { if (activeCollection !== "")
                    onPreset("masterDetail", activeCollection); setOpen(false); }, children: "master\u00B7detail" }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => { if (activeCollection !== "")
                    onPreset("viewEdit", activeCollection); setOpen(false); }, children: "\uC870\uD68C+\uC218\uC815" }), generatedPages.length > 0 ? (_jsxs("select", { defaultValue: "", "aria-label": "Generated Page \uBCC0\uD658", onChange: (event) => { if (event.target.value !== "") {
                    onConvert(event.target.value);
                    setOpen(false);
                } }, children: [_jsx("option", { value: "", children: "Generated \uBCF5\uC81C\u2026" }), generatedPages.map((page) => _jsxs("option", { value: page.id, children: [page.id, " (", page.type, ")"] }, page.id))] })) : null, _jsx("button", { type: "button", onClick: () => setOpen(false), "aria-label": "\uB2EB\uAE30", children: "\u2715" })] }));
}
/**
 * Shows the content permissions this screen's Actions require, so an App author
 * can prepare a Role before publishing. The server re-derives the same gate and
 * enforces it — this is a preview, not an authorization decision.
 */
function RolePreview({ page, collections }) {
    const required = useMemo(() => requiredPermissions(page), [page]);
    if (required.length === 0) {
        return _jsx("p", { className: styles.inspectorEmpty, children: "\uC774 \uD654\uBA74\uC758 \uC791\uC5C5\uC774 \uC694\uAD6C\uD558\uB294 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." });
    }
    const collectionName = (id) => {
        if (id === undefined)
            return "";
        const collection = collections.find((entry) => entry.id === id);
        return collection?.label ?? collection?.name ?? id;
    };
    return (_jsxs("div", { className: styles.inspectorField, children: [_jsx("span", { children: "\uD544\uC694 \uAD8C\uD55C (Role Preview)" }), _jsx("ul", { className: styles.rolePreviewList, children: required.map((entry) => (_jsxs("li", { children: [_jsx("code", { children: entry.permission }), entry.collectionId === undefined ? null : _jsxs(_Fragment, { children: [" \u00B7 ", collectionName(entry.collectionId)] })] }, `${entry.permission}:${entry.collectionId ?? ""}`))) }), _jsx("p", { className: styles.inspectorEmpty, children: "\uC774 \uAD8C\uD55C\uC744 \uAC00\uC9C4 Role\uC744 \uB300\uC0C1 Realm\uC5D0 \uBD80\uC5EC\uD558\uC138\uC694. \uC11C\uBC84\uAC00 \uC2E4\uD589 \uC2DC \uB2E4\uC2DC \uAC80\uC99D\uD569\uB2C8\uB2E4." })] }));
}
/** Turns a validator code into a "전산 사용자"-friendly Korean hint (falls back to the raw message). */
/** The component id a validation issue points at on the active page, if any. */
function issueComponentId(manifest, active, issue) {
    if (active === null)
        return null;
    const pageIndex = manifest.pages.findIndex((page) => page.id === active.id);
    const [root, pIdx, section, cIdx] = issue.path;
    if (root === "pages" && pIdx === pageIndex && section === "components" && typeof cIdx === "number") {
        return active.components[cIdx]?.id ?? null;
    }
    return null;
}
function friendlyIssue(code, message) {
    switch (code) {
        case "COMPONENT_OVERLAP": return "폼이 서로 겹쳐 있습니다. 겹치지 않게 옮겨 주세요.";
        case "INVALID_PLACEMENT": return "폼이 화면 밖으로 나갔습니다. 안쪽으로 옮겨 주세요.";
        case "INVALID_COLLECTION_REFERENCE": return "폼에 스키마가 지정되지 않았습니다. 폼을 선택해 스키마를 골라 주세요.";
        case "INVALID_FIELD_REFERENCE": return "폼에 없는 필드가 참조되고 있습니다. 필드를 다시 선택해 주세요.";
        case "UNKNOWN_QUERY_PARAMETER": return "검색 조건이 올바르지 않습니다. 검색폼의 검색 필드를 다시 지정해 주세요.";
        case "INVALID_SCREEN_NO": return "화면번호 형식이 올바르지 않습니다.";
        case "DUPLICATE_SCREEN_NO": return "화면번호가 중복됩니다.";
        default: return message;
    }
}
/** Cell highlight in connect mode: the pending source, or a linkable target. */
function blockCellTone(page, componentId, pendingLinkBlockId) {
    const blockId = blockIdOf(componentId);
    if (blockId === null)
        return null;
    if (pendingLinkBlockId === null)
        return null;
    if (blockId === pendingLinkBlockId)
        return "source";
    const blocks = describeBlocks(page);
    const from = blocks.find((block) => block.id === pendingLinkBlockId);
    const to = blocks.find((block) => block.id === blockId);
    return from !== undefined && to !== undefined && canLinkBlocks(from, to, page) ? "target" : null;
}
/** Editor cell body for a component: kind chrome comes in slice 4 (real renderer). */
function BlockPreview({ component }) {
    const label = typeof component.props["label"] === "string" ? component.props["label"] : component.kind;
    return (_jsxs("div", { className: styles.componentPreview, children: [_jsx("span", { className: styles.componentKind, children: component.kind.replace("core.", "") }), _jsx("strong", { children: label })] }));
}
/** Draws a line between each linked pair of blocks (form-to-form links). */
function BlockLinkOverlay({ page, pendingLinkBlockId, onUnlink }) {
    const blocks = describeBlocks(page);
    const anchor = (blockId) => {
        const block = blocks.find((entry) => entry.id === blockId);
        const component = page.components.find((entry) => entry.id === block?.anchorComponentId);
        if (component === undefined)
            return null;
        const { x, y, width, height } = component.placement;
        return { cx: (x + width / 2) * COLUMN_WIDTH, cy: (y + height / 2) * ROW_HEIGHT };
    };
    const links = blockLinks(page);
    const height = Math.max(baseViewportHeight("16:9"), ...page.components.map((c) => (c.placement.y + c.placement.height) * ROW_HEIGHT));
    return (_jsx("svg", { className: styles.linkLayer, style: { width: CANVAS_WIDTH, height }, viewBox: `0 0 ${CANVAS_WIDTH} ${height}`, children: links.map((link) => {
            const from = anchor(link.fromBlockId);
            const to = anchor(link.toBlockId);
            if (from === null || to === null)
                return null;
            const dim = pendingLinkBlockId !== null && link.fromBlockId !== pendingLinkBlockId && link.toBlockId !== pendingLinkBlockId;
            return (_jsxs("g", { className: dim ? styles.linkDimmed : undefined, children: [_jsx("line", { x1: from.cx, y1: from.cy, x2: to.cx, y2: to.cy, className: styles.linkLine }), _jsx("circle", { cx: (from.cx + to.cx) / 2, cy: (from.cy + to.cy) / 2, r: 9, className: styles.linkHandle, onClick: (event) => { event.stopPropagation(); onUnlink(link); } })] }, `${link.fromBlockId}->${link.toBlockId}`));
        }) }));
}
/** Renders the real App shell (menu + 1152 content) at 1440 width, scaled to fit. */
function AppShellFrame({ manifest, activePageId, children }) {
    const ref = useRef(null);
    const frameRef = useRef(null);
    const [scale, setScale] = useState(1);
    // Unscaled layout height of the frame (offsetHeight ignores the CSS transform),
    // so the sizer can reserve the correct scaled footprint for scrolling.
    const [frameHeight, setFrameHeight] = useState(baseViewportHeight(manifest.presentation.layoutProfile));
    const profile = manifest.presentation.layoutProfile;
    const menuRight = manifest.presentation.menuPosition === "right";
    useEffect(() => {
        const element = ref.current;
        if (element === null || typeof ResizeObserver === "undefined")
            return;
        const update = () => {
            const { width, height } = element.getBoundingClientRect();
            setScale(computeShellScale(width, height, profile));
            if (frameRef.current !== null)
                setFrameHeight(frameRef.current.offsetHeight);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        if (frameRef.current !== null)
            observer.observe(frameRef.current);
        return () => observer.disconnect();
    }, [profile]);
    return (_jsx("div", { className: styles.stageViewport, ref: ref, children: _jsx("div", { className: styles.shellSizer, style: { width: SHELL_WIDTH * scale, height: frameHeight * scale }, children: _jsxs("div", { ref: frameRef, className: styles.shellFrame, style: { width: SHELL_WIDTH, minHeight: baseViewportHeight(profile), transform: `scale(${scale})`, transformOrigin: "top left", flexDirection: menuRight ? "row-reverse" : "row" }, children: [_jsxs("nav", { className: styles.shellMenu, style: { width: MENU_WIDTH }, "aria-hidden": "true", children: [_jsx("div", { className: styles.shellBrand, children: manifest.name }), manifest.navigation.map((item) => (_jsx("span", { "data-active": item.pageId === activePageId, className: styles.shellNavItem, children: item.label }, item.id)))] }), _jsx("div", { className: styles.shellContent, style: { width: CANVAS_WIDTH }, children: children(scale) })] }) }) }));
}
function FullscreenNotice({ title, detail, onBack }) {
    return (_jsxs("div", { className: styles.notice, children: [_jsx("h1", { children: title }), _jsx("p", { children: detail }), _jsx(Button, { variant: "secondary", onPress: onBack, children: "\u2190 \uBE4C\uB354\uB85C \uB3CC\uC544\uAC00\uAE30" })] }));
}
/** The Collection id of the Data Source whose `rows` feed a table's `data` port. */
function tableSourceCollectionId(page, tableId) {
    const connection = page.connections.find((c) => c.from.nodeType === "data-source" && c.from.portId === "rows"
        && c.to.nodeType === "component" && c.to.nodeId === tableId && c.to.portId === "data");
    if (connection === undefined)
        return undefined;
    return page.dataSources.find((source) => source.id === connection.from.nodeId)?.collectionId;
}
function uniqueId(preferred, used) {
    const taken = new Set(used);
    if (!taken.has(preferred))
        return preferred;
    let index = 2;
    while (taken.has(`${preferred}-${index}`))
        index += 1;
    return `${preferred}-${index}`;
}
function message(error) {
    return error instanceof XeCmsApiError ? `${error.message} (${error.code})`
        : error instanceof Error ? error.message : "요청을 처리할 수 없습니다.";
}
//# sourceMappingURL=composed-screen-editor-page.js.map