import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { generateAdminAppManifest, } from "@xecms/admin-apps";
import { XeCmsApiError, } from "@xecms/client";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import { xecmsClient as client } from "../xecms-client.js";
import styles from "../admin-apps.module.css";
export function AdminAppListPage() {
    const [apps, setApps] = useState([]);
    const [health, setHealth] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        void client.adminApps.list(true).then(async ({ items }) => {
            setApps(items);
            const results = await Promise.all(items.map(async (app) => [app.id, await client.adminApps.health(app.id)]));
            setHealth(Object.fromEntries(results));
        })
            .catch((caught) => setError(message(caught))).finally(() => setLoading(false));
    }, []);
    return _jsxs("section", { className: styles.page, children: [_jsx(PageHeader, { title: "\uC6B4\uC601 \uC571", description: "\uC5C5\uBB34 \uB2F4\uB2F9\uC790\uC6A9 \uBCC4\uB3C4 Admin App\uC744 \uB9CC\uB4E4\uACE0 \uC801\uC6A9\uD569\uB2C8\uB2E4.", action: _jsx(Button, { onPress: () => { window.location.href = "/admin/apps/new"; }, children: "\uC0C8 App" }) }), error ? _jsx(Callout, { tone: "error", children: error }) : null, loading ? _jsx(LoadingIndicator, { label: "\uC6B4\uC601 \uC571\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) : apps.length === 0 ? _jsxs("div", { className: styles.empty, children: [_jsx("h2", { children: "\uC544\uC9C1 \uC6B4\uC601 \uC571\uC774 \uC5C6\uC2B5\uB2C8\uB2E4" }), _jsx("p", { children: "Schema\uC5D0\uC11C \uBAA9\uB85D\uACFC \uD3FC\uC744 \uC790\uB3D9 \uC0DD\uC131\uD574 \uCCAB App\uC744 \uC2DC\uC791\uD558\uC138\uC694." }), _jsx(Button, { onPress: () => { window.location.href = "/admin/apps/new"; }, children: "\uCCAB App \uB9CC\uB4E4\uAE30" })] }) : _jsx("div", { className: styles.appGrid, children: apps.map((app) => _jsxs(Link, { className: styles.appCard, to: `/admin/apps/${app.id}`, children: [_jsxs("div", { children: [_jsx("span", { className: styles.appMark, children: app.name.slice(0, 1).toUpperCase() }), _jsxs("span", { className: styles.badges, children: [_jsx("span", { className: styles.health, "data-state": health[app.id]?.state ?? "checking", children: healthLabel(health[app.id]) }), _jsx("span", { className: styles.status, "data-state": app.status, children: app.status === "active" ? "활성" : "보관됨" })] })] }), _jsx("h2", { children: app.name }), _jsxs("code", { children: ["/apps/", app.key] }), _jsxs("footer", { children: [_jsx("span", { children: app.audience.type === "system" ? "System Realm" : app.audience.realmId }), _jsx("span", { children: app.activeRevisionId === null ? "Draft only" : `Route r${app.routeVersion}` })] })] }, app.id)) })] });
}
export function AdminAppCreatePage() {
    const navigate = useNavigate();
    const [collections, setCollections] = useState([]);
    const [realms, setRealms] = useState([]);
    const [name, setName] = useState("Operations");
    const [key, setKey] = useState("operations");
    const [audience, setAudience] = useState("system");
    const [selected, setSelected] = useState([]);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        void Promise.all([client.collections.list(), client.identityRealms.list()]).then(([schema, realmList]) => {
            setCollections(schema.items);
            const activeRealms = realmList.items.filter(({ kind, status }) => kind === "content" && status === "active");
            setRealms(activeRealms);
            setSelected(collectionsForRealm(schema.items, activeRealms, "system").slice(0, 1).map(({ id }) => id));
        }).catch((caught) => setError(message(caught)));
    }, []);
    const eligibleCollections = useMemo(() => collectionsForRealm(collections, realms, audience), [audience, collections, realms]);
    const changeRealm = (realmId) => {
        setAudience(realmId);
        const eligible = new Set(collectionsForRealm(collections, realms, realmId).map(({ id }) => id));
        setSelected((current) => current.filter((id) => eligible.has(id)));
    };
    const create = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            const manifest = generateAdminAppManifest({
                name,
                key,
                audience: audience === "system" ? { type: "system" } : { type: "content-realm", realmId: audience },
                collections: eligibleCollections.filter(({ id }) => selected.includes(id)),
            });
            const created = await client.adminApps.create({ manifest });
            navigate(`/admin/apps/${created.app.id}`);
        }
        catch (caught) {
            setError(message(caught));
        }
        finally {
            setPending(false);
        }
    };
    return _jsxs("section", { className: styles.page, children: [_jsx(PageHeader, { title: "\uC0C8 \uC6B4\uC601 \uC571", description: "Schema\uB97C \uAE30\uBC18\uC73C\uB85C \uBAA9\uB85D\u00B7\uC0DD\uC131\u00B7\uD3B8\uC9D1\u00B7\uC0C1\uC138 \uD654\uBA74\uC744 \uC790\uB3D9 \uAD6C\uC131\uD569\uB2C8\uB2E4." }), error ? _jsx(Callout, { tone: "error", children: error }) : null, _jsxs("form", { className: styles.builderCard, onSubmit: (event) => void create(event), children: [_jsxs("div", { className: styles.twoColumns, children: [_jsx(TextField, { label: "App \uC774\uB984", value: name, onChange: setName, required: true }), _jsx(TextField, { label: "URL key", value: key, onChange: setKey, required: true, pattern: "[a-z0-9]+(?:-[a-z0-9]+)*" })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uB300\uC0C1 Realm" }), _jsxs("select", { value: audience, onChange: (event) => changeRealm(event.target.value), children: [_jsx("option", { value: "system", children: "System Realm" }), realms.map((realm) => _jsxs("option", { value: realm.realmId, children: [realm.name, " (", realm.realmKey, ")"] }, realm.realmId))] }), _jsx("small", { children: "App\uACFC \uC778\uC99D \uC138\uC158, \uAD8C\uD55C\uC740 \uC120\uD0DD\uD55C Realm\uC5D0 \uADC0\uC18D\uB429\uB2C8\uB2E4. \uB2E4\uB978 Realm\uC758 Auth Collection\uC740 \uD3EC\uD568\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." })] }), _jsxs("fieldset", { className: styles.collectionPicker, children: [_jsx("legend", { children: "\uD3EC\uD568\uD560 Collection" }), eligibleCollections.length === 0 ? _jsx("p", { children: "\uC774 Realm\uC5D0\uC11C \uC0AC\uC6A9\uD560 \uC218 \uC788\uB294 Collection\uC774 \uC5C6\uC5B4 \uBE48 \uB300\uC2DC\uBCF4\uB4DC App\uC73C\uB85C \uC2DC\uC791\uD569\uB2C8\uB2E4." }) : eligibleCollections.map((collection) => _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: selected.includes(collection.id), onChange: (event) => setSelected((current) => event.target.checked ? [...current, collection.id] : current.filter((id) => id !== collection.id)) }), _jsxs("span", { children: [_jsx("strong", { children: collection.label ?? collection.name }), _jsxs("small", { children: [collection.fields.length, " fields \u00B7 ", collection.id, collection.authRealmKey ? ` · Auth: ${collection.authRealmKey}` : ""] })] })] }, collection.id))] }), _jsxs("div", { className: styles.actions, children: [_jsx(Button, { variant: "secondary", onPress: () => navigate("/admin/apps"), children: "\uCDE8\uC18C" }), _jsx(Button, { type: "submit", isDisabled: pending, children: pending ? "생성 중…" : "Draft 생성" })] })] })] });
}
export function AdminAppBuilderPage() {
    const { appId = "" } = useParams();
    const navigate = useNavigate();
    const [app, setApp] = useState(null);
    const [draft, setDraft] = useState(null);
    const [revisions, setRevisions] = useState([]);
    const [health, setHealth] = useState(null);
    const [collections, setCollections] = useState([]);
    const [realms, setRealms] = useState([]);
    const [source, setSource] = useState("");
    const [mode, setMode] = useState("basic");
    const [preview, setPreview] = useState(null);
    const [password, setPassword] = useState("");
    const [pending, setPending] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const manifest = useMemo(() => parseManifest(source), [source]);
    const dirty = draft !== null && source !== JSON.stringify(draft.manifest, null, 2);
    const eligibleCollections = useMemo(() => manifest === null ? [] : collectionsForAudience(collections, realms, manifest.audience), [collections, manifest, realms]);
    const reload = async () => {
        const [nextApp, nextDraft, history, schema, realmList, nextHealth] = await Promise.all([
            client.adminApps.get(appId), client.adminApps.getDraft(appId), client.adminApps.revisions(appId), client.collections.list(), client.identityRealms.list(), client.adminApps.health(appId),
        ]);
        setApp(nextApp);
        setDraft(nextDraft);
        setRevisions(history.items);
        setCollections(schema.items.filter(({ status }) => status === "applied"));
        setHealth(nextHealth);
        setRealms(realmList.items.filter(({ kind, status }) => kind === "content" && status === "active"));
        if (nextDraft !== null)
            setSource(JSON.stringify(nextDraft.manifest, null, 2));
    };
    useEffect(() => { void reload().catch((caught) => setError(message(caught))).finally(() => setLoading(false)); }, [appId]);
    const run = async (operation) => {
        setPending(true);
        setError(null);
        try {
            await operation();
        }
        catch (caught) {
            setError(message(caught));
        }
        finally {
            setPending(false);
        }
    };
    const ensureDraft = () => run(async () => {
        if (app === null)
            return;
        const created = await client.adminApps.createDraft(app.id, { expectedRouteVersion: app.routeVersion });
        setDraft(created);
        setSource(JSON.stringify(created.manifest, null, 2));
    });
    const save = async () => {
        if (draft === null || manifest === null)
            throw new Error("유효한 Manifest JSON이 필요합니다.");
        const saved = await client.adminApps.saveDraft(appId, {
            expectedDraftVersion: draft.draftVersion,
            expectedBaseRevisionId: draft.baseRevisionId,
            manifest,
        });
        setDraft(saved);
        setSource(JSON.stringify(saved.manifest, null, 2));
        setPreview(null);
        return saved;
    };
    const previewDraft = () => run(async () => {
        const saved = await save();
        if (app === null)
            return;
        setPreview(await client.adminApps.preview(appId, {
            expectedActiveRevisionId: app.activeRevisionId,
            expectedRouteVersion: app.routeVersion,
            expectedDraftVersion: saved.draftVersion,
        }));
    });
    const apply = () => run(async () => {
        if (preview === null || app === null || draft === null)
            return;
        await client.adminApps.apply(appId, {
            expectedActiveRevisionId: app.activeRevisionId,
            expectedRouteVersion: app.routeVersion,
            expectedDraftVersion: draft.draftVersion,
            planId: preview.planId,
        });
        setPreview(null);
        await reload();
    });
    const importSource = () => run(async () => {
        if (draft === null || manifest === null || app === null)
            return;
        const imported = await client.adminApps.importManifest({
            appId: app.id,
            expectedRouteVersion: app.routeVersion,
            expectedDraftVersion: draft.draftVersion,
            expectedBaseRevisionId: draft.baseRevisionId,
            manifest,
        });
        setDraft(imported.draft);
        setSource(JSON.stringify(imported.draft.manifest, null, 2));
    });
    const patchManifest = (update) => {
        if (manifest !== null)
            setSource(JSON.stringify(update(manifest), null, 2));
    };
    if (loading)
        return _jsx(LoadingIndicator, { label: "App Builder\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" });
    if (app === null)
        return _jsx(Callout, { tone: "error", children: error ?? "App을 찾을 수 없습니다." });
    return _jsxs("section", { className: styles.page, children: [_jsx(UnsavedChangesGuard, { when: dirty }), _jsx(PageHeader, { title: app.name, description: `/apps/${app.key} · ${app.audience.type === "system" ? "System Realm" : app.audience.realmId}`, action: app.activeRevisionId === null ? null : _jsx("a", { className: styles.previewLink, href: `/apps/${app.key}`, target: "_blank", rel: "noreferrer", children: "\uC2E4\uD589 App \uC5F4\uAE30 \u2197" }) }), error ? _jsx(Callout, { tone: "error", children: error }) : null, health?.state === "degraded" ? _jsxs("section", { className: styles.healthPanel, children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { children: "DEPENDENCY HEALTH" }), _jsx("h2", { children: "\uD604\uC7AC \uD658\uACBD\uACFC \uC801\uC6A9\uB41C Revision\uC774 \uB2EC\uB77C\uC84C\uC2B5\uB2C8\uB2E4" })] }), _jsx("span", { className: styles.health, "data-state": "degraded", children: "\uD655\uC778 \uD544\uC694" })] }), _jsx("p", { children: "App\uC740 \uC81C\uD55C \uBAA8\uB4DC\uB85C \uC5F4\uB9AC\uBA70, \uC544\uB798 \uD56D\uBAA9\uC744 \uD655\uC778\uD55C \uB4A4 \uC0C8 Draft\uB97C Preview/Apply\uD558\uC138\uC694." }), _jsx("div", { children: health.blockers.map((blocker) => _jsxs("article", { children: [_jsx("strong", { children: blocker.code }), _jsx("span", { children: blocker.message })] }, `${blocker.code}:${blocker.message}`)) })] }) : null, _jsxs("div", { className: styles.builderToolbar, children: [_jsx("div", { className: styles.modeTabs, children: ["basic", "standard", "advanced"].map((value) => _jsx("button", { type: "button", "data-active": mode === value, onClick: () => setMode(value), children: value === "basic" ? "Basic" : value === "standard" ? "Standard" : "Advanced" }, value)) }), _jsxs("span", { className: styles.badges, children: [_jsx("span", { className: styles.health, "data-state": health?.state ?? "checking", children: healthLabel(health) }), _jsx("span", { className: styles.status, "data-state": app.status, children: app.status === "active" ? "활성" : "보관됨" })] })] }), draft === null ? _jsxs("div", { className: styles.empty, children: [_jsx("h2", { children: "\uC801\uC6A9\uB41C Revision" }), _jsx("p", { children: "\uC0C8 Draft\uB97C \uB9CC\uB4E4\uC5B4 \uD3B8\uC9D1\uC744 \uC2DC\uC791\uD558\uC138\uC694." }), _jsx(Button, { onPress: () => void ensureDraft(), children: "\uC0C8 Draft" })] }) : manifest === null ? _jsx(Callout, { tone: "error", children: "Manifest JSON \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }) : _jsxs(_Fragment, { children: [mode === "basic" ? _jsxs("div", { className: styles.builderCard, children: [_jsxs("div", { className: styles.twoColumns, children: [_jsx(TextField, { label: "App \uC774\uB984", value: manifest.name, onChange: (name) => patchManifest((current) => ({ ...current, name })) }), _jsx(TextField, { label: "URL key", value: manifest.key, onChange: (key) => patchManifest((current) => ({ ...current, key })) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC2DC\uC791 \uD654\uBA74" }), _jsx("select", { value: manifest.startPageId, onChange: (event) => patchManifest((current) => ({ ...current, startPageId: event.target.value })), children: manifest.pages.map((page) => _jsx("option", { value: page.id, children: pageLabel(page) }, page.id)) })] }), _jsx("div", { className: styles.pageSummary, children: manifest.pages.map((page) => _jsxs("article", { children: [_jsx("span", { children: page.type }), _jsx("strong", { children: pageLabel(page) }), "collectionId" in page ? _jsx("code", { children: page.collectionId }) : null] }, page.id)) })] }) : null, mode === "standard" ? _jsxs(_Fragment, { children: [_jsx(PageCatalogEditor, { manifest: manifest, collections: eligibleCollections, onChange: (next) => setSource(JSON.stringify(next, null, 2)) }), _jsx(NavigationEditor, { manifest: manifest, onChange: (navigation) => patchManifest((current) => ({ ...current, navigation })) }), _jsx(PageStructureEditor, { manifest: manifest, onChange: (pages) => patchManifest((current) => ({ ...current, pages })) })] }) : null, mode === "advanced" ? _jsxs("div", { className: styles.builderCard, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Manifest source" }), _jsx("textarea", { className: styles.source, rows: 26, value: source, onChange: (event) => setSource(event.target.value), spellCheck: false })] }), _jsxs("div", { className: styles.actions, children: [_jsxs("label", { className: styles.fileButton, children: ["JSON \uD30C\uC77C \uC5F4\uAE30", _jsx("input", { type: "file", accept: "application/json,.json", onChange: (event) => {
                                                    const file = event.target.files?.[0];
                                                    if (file)
                                                        void file.text().then(setSource).catch((caught) => setError(message(caught)));
                                                    event.target.value = "";
                                                } })] }), _jsx(Button, { variant: "secondary", onPress: () => void importSource(), isDisabled: pending || manifest === null, children: "Import source" })] })] }) : null, _jsxs("div", { className: styles.actions, children: [_jsx(Button, { variant: "secondary", onPress: () => void run(async () => { await save(); }), isDisabled: pending || manifest === null, children: "Draft \uC800\uC7A5" }), _jsx(Button, { onPress: () => void previewDraft(), isDisabled: pending || manifest === null, children: "\uAC80\uC99D \uBC0F Preview" })] })] }), preview ? _jsxs("section", { className: styles.previewPanel, children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("span", { children: "APPLY PREVIEW" }), _jsx("h2", { children: preview.blockers.length === 0 ? "적용할 준비가 됐습니다" : `${preview.blockers.length}개 문제를 해결해 주세요` })] }), _jsxs("code", { children: [preview.planId.slice(0, 24), "\u2026"] })] }), preview.blockers.map((blocker) => _jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: blocker.code }), " \u00B7 ", blocker.message, blocker.path ? _jsx("span", { className: styles.issuePath, children: blocker.path.join(".") }) : null, _jsx("button", { className: styles.issueLink, type: "button", onClick: () => setMode("advanced"), children: "\uC18C\uC2A4\uC5D0\uC11C \uD655\uC778" })] }, `${blocker.code}:${blocker.message}`)), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "Dependency" }), _jsx("dd", { children: preview.dependencies.length })] }), _jsxs("div", { children: [_jsx("dt", { children: "Draft version" }), _jsx("dd", { children: preview.draftVersion })] }), _jsxs("div", { children: [_jsx("dt", { children: "\uBCC0\uACBD" }), _jsx("dd", { children: preview.diff === null ? "최초 적용" : preview.diff.changed ? "있음" : "없음" })] })] }), preview.diff?.entries.length ? _jsxs("section", { className: styles.diffPanel, children: [_jsx("h3", { children: "Manifest \uBCC0\uACBD \uC0C1\uC138" }), _jsx("div", { children: preview.diff.entries.map((entry, index) => _jsx(DiffEntry, { entry: entry }, `${entry.kind}:${entry.path.join(".")}:${index}`)) })] }) : preview.diff?.changed === false ? _jsx("p", { className: styles.help, children: "\uC801\uC6A9\uB41C Revision\uACFC Manifest\uAC00 \uAC19\uC2B5\uB2C8\uB2E4." }) : null, _jsx("div", { className: styles.actions, children: _jsx(Button, { onPress: () => void apply(), isDisabled: pending || preview.blockers.length > 0, children: "Apply" }) })] }) : null, _jsxs("section", { className: styles.builderCard, children: [_jsx("h2", { children: "Revision\uACFC \uC0C1\uD0DC" }), _jsx("div", { className: styles.revisions, children: revisions.map((revision) => _jsxs("article", { children: [_jsxs("div", { children: [_jsxs("strong", { children: ["Revision ", revision.sequence] }), _jsx("small", { children: new Date(revision.createdAt).toLocaleString() })] }), revision.id === app.activeRevisionId ? _jsx("span", { children: "\uD604\uC7AC" }) : _jsx(Button, { size: "small", variant: "secondary", onPress: () => void run(async () => {
                                        if (app.activeRevisionId === null)
                                            return;
                                        await client.adminApps.rollback(app.id, { targetRevisionId: revision.id, expectedActiveRevisionId: app.activeRevisionId, expectedRouteVersion: app.routeVersion });
                                        await reload();
                                    }), children: "Rollback" })] }, revision.id)) }), _jsxs("div", { className: styles.stateControls, children: [_jsx(TextField, { label: "\uC911\uC694 \uC791\uC5C5\uC6A9 \uD604\uC7AC \uBE44\uBC00\uBC88\uD638", type: "password", value: password, onChange: setPassword }), _jsxs("div", { className: styles.actions, children: [_jsx(Button, { variant: "secondary", onPress: () => void run(async () => {
                                            const artifact = await client.adminApps.exportManifest(app.id);
                                            download(`${app.key}.admin-app.json`, artifact.serialized);
                                        }), children: "Export" }), _jsx(Button, { variant: "secondary", isDisabled: !password || pending, onPress: () => void run(async () => {
                                            if (app.activeRevisionId === null) {
                                                await client.adminApps.delete(app.id, { expectedRouteVersion: app.routeVersion, currentPassword: password });
                                                navigate("/admin/apps", { replace: true });
                                                return;
                                            }
                                            if (app.status === "active")
                                                await client.adminApps.archive(app.id, { expectedRouteVersion: app.routeVersion, currentPassword: password });
                                            else
                                                await client.adminApps.reactivate(app.id, { expectedRouteVersion: app.routeVersion, currentPassword: password });
                                            setPassword("");
                                            await reload();
                                        }), children: app.activeRevisionId === null ? "Delete Draft App" : app.status === "active" ? "Archive" : "Reactivate" })] })] })] })] });
}
function PageCatalogEditor({ manifest, collections, onChange }) {
    const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
    const [pageType, setPageType] = useState("list");
    const selected = collections.find(({ id }) => id === collectionId) ?? collections[0];
    useEffect(() => {
        if (collectionId === "" && collections[0])
            setCollectionId(collections[0].id);
    }, [collectionId, collections]);
    useEffect(() => {
        if (selected?.kind === "singleton")
            setPageType("singleton");
        else if (pageType === "singleton")
            setPageType("list");
    }, [pageType, selected?.kind]);
    const add = () => {
        if (selected === undefined)
            return;
        const generated = generateAdminAppManifest({
            name: manifest.name,
            key: manifest.key,
            audience: manifest.audience,
            collections: [selected],
        });
        const candidate = generated.pages.find((page) => pageMatchesChoice(page, pageType));
        if (candidate === undefined)
            return;
        const id = uniquePortableId(candidate.id, new Set(manifest.pages.map((page) => page.id)));
        let page = { ...candidate, id };
        if (page.type === "collection-list" && page.rowClick !== undefined) {
            const targetCollectionId = page.collectionId;
            const detail = manifest.pages.find((current) => current.type === "document-detail"
                && current.collectionId === targetCollectionId);
            page = detail === undefined ? { ...page, rowClick: undefined } : { ...page, rowClick: { ...page.rowClick, pageId: detail.id } };
        }
        const navId = uniquePortableId(`${id}-nav`, new Set(flatNavigation(manifest.navigation).map((item) => item.id)));
        onChange({
            ...manifest,
            pages: [...manifest.pages, page],
            navigation: [...manifest.navigation, { id: navId, label: pageLabel(page), pageId: page.id }],
        });
    };
    const remove = (pageId) => {
        if (manifest.pages.length <= 1)
            return;
        const pages = manifest.pages.filter(({ id }) => id !== pageId).map((page) => page.type === "collection-list" && page.rowClick?.pageId === pageId
            ? { ...page, rowClick: undefined }
            : page);
        onChange({
            ...manifest,
            pages,
            navigation: removePageNavigation(manifest.navigation, pageId),
            startPageId: manifest.startPageId === pageId ? pages[0].id : manifest.startPageId,
        });
    };
    return _jsxs("section", { className: styles.builderCard, children: [_jsx("h2", { children: "Pages" }), _jsx("p", { className: styles.help, children: "Schema \uAE30\uBC18 \uD654\uBA74\uC744 \uCD94\uAC00\uD558\uAC70\uB098 \uB354 \uC774\uC0C1 \uC4F0\uC9C0 \uC54A\uB294 \uD654\uBA74\uC744 \uC81C\uAC70\uD569\uB2C8\uB2E4." }), _jsxs("div", { className: styles.pageComposer, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Collection" }), _jsx("select", { value: selected?.id ?? "", onChange: (event) => setCollectionId(event.target.value), children: collections.map((collection) => _jsx("option", { value: collection.id, children: collection.label ?? collection.name }, collection.id)) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uD654\uBA74 \uC885\uB958" }), _jsx("select", { value: pageType, onChange: (event) => setPageType(event.target.value), children: selected?.kind === "singleton" ? _jsx("option", { value: "singleton", children: "Singleton editor" }) : _jsxs(_Fragment, { children: [_jsx("option", { value: "list", children: "\uBAA9\uB85D" }), _jsx("option", { value: "create", children: "\uC0DD\uC131 Form" }), _jsx("option", { value: "edit", children: "\uD3B8\uC9D1 Form" }), _jsx("option", { value: "detail", children: "\uC0C1\uC138" }), _jsx("option", { value: "trash", children: "\uD734\uC9C0\uD1B5" })] }) })] }), _jsx(Button, { onPress: add, isDisabled: selected === undefined, children: "Page \uCD94\uAC00" })] }), _jsx("div", { className: styles.pageRows, children: manifest.pages.map((page) => _jsxs("article", { children: [_jsxs("div", { children: [_jsx("strong", { children: pageLabel(page) }), _jsxs("small", { children: [page.type, " \u00B7 ", page.id, page.id === manifest.startPageId ? " · 시작 화면" : ""] })] }), _jsx(Button, { size: "small", variant: "secondary", isDisabled: manifest.pages.length <= 1, onPress: () => remove(page.id), children: "\uC81C\uAC70" })] }, page.id)) })] });
}
function NavigationEditor({ manifest, onChange }) {
    const move = (index, offset) => {
        const items = [...manifest.navigation];
        const target = index + offset;
        if (target < 0 || target >= items.length)
            return;
        [items[index], items[target]] = [items[target], items[index]];
        onChange(items);
    };
    return _jsxs("section", { className: styles.builderCard, children: [_jsx("h2", { children: "Navigation" }), _jsx("p", { className: styles.help, children: "\uD0A4\uBCF4\uB4DC\uB85C\uB3C4 \uC21C\uC11C\uB97C \uC870\uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }), _jsx("div", { className: styles.navigationEditor, children: manifest.navigation.map((item, index) => _jsxs("article", { children: [_jsxs("div", { children: [_jsx("strong", { children: item.label }), _jsx("small", { children: item.pageId ?? `${item.children?.length ?? 0} children` })] }), _jsxs("span", { children: [_jsx("button", { type: "button", disabled: index === 0, onClick: () => move(index, -1), "aria-label": `${item.label} 위로`, children: "\u2191" }), _jsx("button", { type: "button", disabled: index === manifest.navigation.length - 1, onClick: () => move(index, 1), "aria-label": `${item.label} 아래로`, children: "\u2193" })] })] }, item.id)) })] });
}
function PageStructureEditor({ manifest, onChange }) {
    const replace = (pageId, next) => onChange(manifest.pages.map((page) => page.id === pageId ? next : page));
    return _jsxs("section", { className: styles.builderCard, children: [_jsx("h2", { children: "List columns\uC640 Form field \uC21C\uC11C" }), _jsx("p", { className: styles.help, children: "Manifest\uAC00 \uCC38\uC870\uD558\uB294 stable Field ID\uB294 \uC720\uC9C0\uD558\uBA74\uC11C \uD45C\uC2DC \uC21C\uC11C\uB97C \uC870\uC815\uD569\uB2C8\uB2E4." }), _jsx("div", { className: styles.structurePages, children: manifest.pages.flatMap((page) => {
                    if (page.type === "collection-list")
                        return [_jsxs("article", { children: [_jsxs("header", { children: [_jsx("span", { children: "LIST" }), _jsx("strong", { children: pageLabel(page) })] }), _jsx("div", { children: page.columns.map((column, index) => _jsxs("div", { children: [_jsx("code", { children: column.label ?? column.id }), _jsxs("span", { children: [_jsx("button", { type: "button", disabled: index === 0, onClick: () => { const columns = [...page.columns]; [columns[index - 1], columns[index]] = [columns[index], columns[index - 1]]; replace(page.id, { ...page, columns }); }, children: "\u2191" }), _jsx("button", { type: "button", disabled: index === page.columns.length - 1, onClick: () => { const columns = [...page.columns]; [columns[index + 1], columns[index]] = [columns[index], columns[index + 1]]; replace(page.id, { ...page, columns }); }, children: "\u2193" }), _jsx("button", { type: "button", disabled: page.columns.length <= 1, onClick: () => replace(page.id, { ...page, columns: page.columns.filter(({ id }) => id !== column.id) }), children: "\u00D7" })] })] }, column.id)) }), _jsxs("div", { className: styles.inlineEditor, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uAE30\uBCF8 \uC815\uB82C" }), _jsxs("select", { value: fieldReferenceKey(page.defaultSort?.[0]?.field), onChange: (event) => {
                                                            const column = page.columns.find(({ field }) => fieldReferenceKey(field) === event.target.value);
                                                            replace(page.id, { ...page, defaultSort: column === undefined ? undefined : [{ field: column.field, direction: page.defaultSort?.[0]?.direction ?? "asc" }] });
                                                        }, children: [_jsx("option", { value: "", children: "\uC815\uB82C \uC5C6\uC74C" }), page.columns.map((column) => _jsx("option", { value: fieldReferenceKey(column.field), children: column.label ?? column.id }, column.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uBC29\uD5A5" }), _jsxs("select", { disabled: !page.defaultSort?.[0], value: page.defaultSort?.[0]?.direction ?? "asc", onChange: (event) => page.defaultSort?.[0] && replace(page.id, { ...page, defaultSort: [{ ...page.defaultSort[0], direction: event.target.value }] }), children: [_jsx("option", { value: "asc", children: "\uC624\uB984\uCC28\uC21C" }), _jsx("option", { value: "desc", children: "\uB0B4\uB9BC\uCC28\uC21C" })] })] })] }), _jsxs("div", { className: styles.filterEditor, children: [_jsx("strong", { children: "\uC0AC\uC6A9\uC790 \uD544\uD130" }), page.availableFilters?.map((filter) => _jsxs("div", { children: [_jsx("code", { children: filter.label }), _jsx("button", { type: "button", onClick: () => replace(page.id, { ...page, availableFilters: page.availableFilters?.filter(({ id }) => id !== filter.id) }), children: "\uC81C\uAC70" })] }, filter.id)), _jsx("button", { type: "button", onClick: () => {
                                                    const column = page.columns.find(({ field }) => field.kind === "data" && !page.availableFilters?.some((filter) => fieldReferenceKey(filter.field) === fieldReferenceKey(field)));
                                                    if (column?.field.kind !== "data")
                                                        return;
                                                    const id = uniquePortableId(`${page.id}-filter`, new Set(page.availableFilters?.map((filter) => filter.id) ?? []));
                                                    replace(page.id, { ...page, availableFilters: [...(page.availableFilters ?? []), { id, label: column.label ?? column.field.fieldId, field: column.field, operators: ["eq"] }] });
                                                }, children: "Column \uD544\uD130 \uCD94\uAC00" })] })] }, page.id)];
                    if (page.type === "document-form") {
                        const section = page.layout.nodes.find((node) => node.type === "section");
                        if (section === undefined)
                            return [];
                        const fields = section.children.filter((node) => node.type === "field");
                        return [_jsxs("article", { children: [_jsxs("header", { children: [_jsxs("span", { children: ["FORM \u00B7 ", page.mode] }), _jsx("strong", { children: page.id })] }), _jsxs("div", { className: styles.inlineEditor, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Section \uC81C\uBAA9" }), _jsx("input", { value: section.title ?? "", onChange: (event) => replace(page.id, { ...page, layout: { nodes: page.layout.nodes.map((node) => node.id === section.id ? { ...section, title: event.target.value || undefined } : node) } }) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Columns" }), _jsxs("select", { value: section.columns ?? 1, onChange: (event) => replace(page.id, { ...page, layout: { nodes: page.layout.nodes.map((node) => node.id === section.id ? { ...section, columns: Number(event.target.value) } : node) } }), children: [_jsx("option", { value: "1", children: "1" }), _jsx("option", { value: "2", children: "2" }), _jsx("option", { value: "3", children: "3" })] })] })] }), _jsx("div", { children: fields.map((field, index) => _jsxs("div", { children: [_jsx("code", { children: field.fieldId }), _jsxs("span", { children: [_jsx("button", { type: "button", disabled: index === 0, onClick: () => moveFormField(page, section.id, index, -1, replace), children: "\u2191" }), _jsx("button", { type: "button", disabled: index === fields.length - 1, onClick: () => moveFormField(page, section.id, index, 1, replace), children: "\u2193" })] })] }, field.id)) })] }, page.id)];
                    }
                    return [];
                }) })] });
}
function moveFormField(page, sectionId, index, offset, replace) {
    const nodes = page.layout.nodes.map((node) => {
        if (node.type !== "section" || node.id !== sectionId)
            return node;
        const children = [...node.children];
        [children[index + offset], children[index]] = [children[index], children[index + offset]];
        return { ...node, children };
    });
    replace(page.id, { ...page, layout: { nodes } });
}
function pageMatchesChoice(page, choice) {
    if (choice === "list")
        return page.type === "collection-list" && page.state !== "deleted";
    if (choice === "trash")
        return page.type === "collection-list" && page.state === "deleted";
    if (choice === "create" || choice === "edit")
        return page.type === "document-form" && page.mode === choice;
    return page.type === choice;
}
function flatNavigation(items) {
    return items.flatMap((item) => [item, ...flatNavigation(item.children ?? [])]);
}
function removePageNavigation(items, pageId) {
    return items.flatMap((item) => {
        const children = removePageNavigation(item.children ?? [], pageId);
        const pageMatches = item.pageId === pageId;
        if (pageMatches && children.length === 0)
            return [];
        return [{
                ...item,
                ...(pageMatches ? { pageId: undefined } : {}),
                ...(item.children === undefined && children.length === 0 ? {} : { children }),
            }];
    });
}
function uniquePortableId(preferred, used) {
    const base = preferred.slice(0, 60).replace(/-+$/g, "") || "page";
    if (!used.has(base))
        return base;
    for (let index = 2; index < 10_000; index += 1) {
        const suffix = `-${index}`;
        const candidate = `${base.slice(0, 64 - suffix.length).replace(/-+$/g, "")}${suffix}`;
        if (!used.has(candidate))
            return candidate;
    }
    throw new Error("고유한 ID를 만들 수 없습니다.");
}
function fieldReferenceKey(field) {
    if (field === undefined)
        return "";
    return field.kind === "data" ? `data:${field.fieldId}` : `system:${field.field}`;
}
function collectionsForRealm(collections, realms, realmId) {
    if (realmId === "system")
        return collections.filter(({ authRealmKey }) => authRealmKey === undefined);
    const realmKey = realms.find((realm) => realm.realmId === realmId)?.realmKey;
    return collections.filter(({ authRealmKey }) => authRealmKey === undefined || authRealmKey === realmKey);
}
function collectionsForAudience(collections, realms, audience) {
    return collectionsForRealm(collections, realms, audience.type === "system" ? "system" : audience.realmId);
}
function PageHeader({ title, description, action }) { return _jsxs("header", { className: styles.pageHeader, children: [_jsxs("div", { children: [_jsx("span", { children: "Custom Admin Apps" }), _jsx("h1", { children: title }), _jsx("p", { children: description })] }), action] }); }
function DiffEntry({ entry }) {
    return _jsxs("article", { "data-kind": entry.kind, children: [_jsxs("header", { children: [_jsx("span", { children: entry.kind === "added" ? "추가" : entry.kind === "removed" ? "삭제" : "변경" }), _jsx("code", { children: entry.path.length === 0 ? "(root)" : entry.path.join(".") })] }), _jsxs("div", { children: [entry.kind === "added" ? null : _jsxs("p", { children: [_jsx("small", { children: "\uC774\uC804" }), _jsx("code", { children: diffValue(entry.before) })] }), entry.kind === "removed" ? null : _jsxs("p", { children: [_jsx("small", { children: "\uC774\uD6C4" }), _jsx("code", { children: diffValue(entry.after) })] })] })] });
}
function diffValue(value) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
        return "undefined";
    return serialized.length > 240 ? `${serialized.slice(0, 237)}…` : serialized;
}
function healthLabel(health) {
    if (health === undefined || health === null)
        return "확인 중";
    if (health.state === "not-applied")
        return "미적용";
    return health.state === "healthy" ? "정상" : "확인 필요";
}
function TextField({ label, value, onChange, type = "text", required = false, pattern }) { return _jsxs("label", { className: styles.field, children: [_jsx("span", { children: label }), _jsx("input", { type: type, value: value, onChange: (event) => onChange(event.target.value), required: required, pattern: pattern })] }); }
function parseManifest(source) { try {
    const value = JSON.parse(source);
    return typeof value === "object" && value !== null ? value : null;
}
catch {
    return null;
} }
function pageLabel(page) { return "title" in page && page.title ? page.title : page.id; }
function message(error) { return error instanceof XeCmsApiError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : "요청을 처리할 수 없습니다."; }
function download(fileName, value) { const url = URL.createObjectURL(new Blob([value], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); }
//# sourceMappingURL=admin-app-pages.js.map