import { Component, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  generateAdminAppManifest,
  upgradeManifestToV2,
  type AdminAppManifestDiffEntry,
  type AdminAppManifestV1,
  type AdminAppManifestV2,
  type ComposedPageDefinition,
  type AdminNavigationItem,
  type AdminPageDefinition,
} from "@xecms/admin-apps";
import {
  XeCmsApiError,
  type AdminAppDto,
  type AdminAppDraftDto,
  type AdminAppHealthDto,
  type AdminAppPreviewDto,
  type AdminAppRevisionDto,
  type CollectionSummaryDto,
  type IdentityRealmDto,
} from "@xecms/client";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import { xecmsClient as client } from "../xecms-client.js";
import styles from "../admin-apps.module.css";

export function AdminAppListPage() {
  const [apps, setApps] = useState<readonly AdminAppDto[]>([]);
  const [health, setHealth] = useState<Readonly<Record<string, AdminAppHealthDto>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void client.adminApps.list(true).then(async ({ items }) => {
      setApps(items);
      const results = await Promise.all(items.map(async (app) => [app.id, await client.adminApps.health(app.id)] as const));
      setHealth(Object.fromEntries(results));
    })
      .catch((caught) => setError(message(caught))).finally(() => setLoading(false));
  }, []);
  return <section className={styles.page}>
    <PageHeader title="운영 앱" description="업무 담당자용 별도 Admin App을 만들고 적용합니다."
      action={<Button onPress={() => { window.location.href = "/admin/apps/new"; }}>새 App</Button>} />
    {error ? <Callout tone="error">{error}</Callout> : null}
    {loading ? <LoadingIndicator label="운영 앱을 불러오는 중" /> : apps.length === 0 ? <div className={styles.empty}>
      <h2>아직 운영 앱이 없습니다</h2><p>Schema에서 목록과 폼을 자동 생성해 첫 App을 시작하세요.</p>
      <Button onPress={() => { window.location.href = "/admin/apps/new"; }}>첫 App 만들기</Button>
    </div> : <div className={styles.appGrid}>{apps.map((app) => <Link className={styles.appCard} key={app.id} to={`/admin/apps/${app.id}`}>
      <div><span className={styles.appMark}>{app.name.slice(0, 1).toUpperCase()}</span><span className={styles.badges}><span className={styles.health} data-state={health[app.id]?.state ?? "checking"}>{healthLabel(health[app.id])}</span><span className={styles.status} data-state={app.status}>{app.status === "active" ? "활성" : "보관됨"}</span></span></div>
      <h2>{app.name}</h2><code>/apps/{app.key}</code>
      <footer><span>{app.audience.type === "system" ? "System Realm" : app.audience.realmId}</span><span>{app.activeRevisionId === null ? "Draft only" : `Route r${app.routeVersion}`}</span></footer>
    </Link>)}</div>}
  </section>;
}

export function AdminAppCreatePage() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<readonly CollectionSummaryDto[]>([]);
  const [realms, setRealms] = useState<readonly IdentityRealmDto[]>([]);
  const [name, setName] = useState("Operations");
  const [key, setKey] = useState("operations");
  const [audience, setAudience] = useState("system");
  const [appKind, setAppKind] = useState<"generated" | "composed">("generated");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([client.collections.list(), client.identityRealms.list()]).then(([schema, realmList]) => {
      setCollections(schema.items);
      const activeRealms = realmList.items.filter(({ kind, status }) => kind === "content" && status === "active");
      setRealms(activeRealms);
      setSelected(collectionsForRealm(schema.items, activeRealms, "system").slice(0, 1).map(({ id }) => id));
    }).catch((caught) => setError(message(caught)));
  }, []);
  const eligibleCollections = useMemo(
    () => collectionsForRealm(collections, realms, audience),
    [audience, collections, realms],
  );
  const changeRealm = (realmId: string) => {
    setAudience(realmId);
    const eligible = new Set(collectionsForRealm(collections, realms, realmId).map(({ id }) => id));
    setSelected((current) => current.filter((id) => eligible.has(id)));
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError(null);
    try {
      const audienceValue = audience === "system"
        ? { type: "system" as const }
        : { type: "content-realm" as const, realmId: audience };
      const manifest = appKind === "composed"
        ? buildComposedManifest({ name, key, audience: audienceValue })
        : generateAdminAppManifest({
            name,
            key,
            audience: audienceValue,
            collections: eligibleCollections.filter(({ id }) => selected.includes(id)),
          });
      const created = await client.adminApps.create({ manifest });
      navigate(`/admin/apps/${created.app.id}`);
    } catch (caught) { setError(message(caught)); } finally { setPending(false); }
  };
  return <section className={styles.page}>
    <PageHeader title="새 운영 앱" description="Schema를 기반으로 목록·생성·편집·상세 화면을 자동 구성합니다." />
    {error ? <Callout tone="error">{error}</Callout> : null}
    <form className={styles.builderCard} onSubmit={(event) => void create(event)}>
      <div className={styles.twoColumns}>
        <TextField label="App 이름" value={name} onChange={setName} required />
        <TextField label="URL key" value={key} onChange={setKey} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
      </div>
      <label className={styles.field}><span>대상 Realm</span><select value={audience} onChange={(event) => changeRealm(event.target.value)}>
        <option value="system">System Realm</option>
        {realms.map((realm) => <option key={realm.realmId} value={realm.realmId}>{realm.name} ({realm.realmKey})</option>)}
      </select><small>App과 인증 세션, 권한은 선택한 Realm에 귀속됩니다. 다른 Realm의 Auth Collection은 포함할 수 없습니다.</small></label>
      <fieldset className={styles.collectionPicker}><legend>App 유형</legend>
        <label><input type="radio" name="app-kind" checked={appKind === "generated"} onChange={() => setAppKind("generated")} /><span><strong>Generated (V1)</strong><small>Schema 기반 목록·생성·편집·상세 화면을 자동 구성</small></span></label>
        <label><input type="radio" name="app-kind" checked={appKind === "composed"} onChange={() => setAppKind("composed")} /><span><strong>Composed (V2)</strong><small>빈 화면에서 드래그로 직접 구성하는 Composed Page</small></span></label>
      </fieldset>
      {appKind === "composed" ? null : <fieldset className={styles.collectionPicker}><legend>포함할 Collection</legend>
        {eligibleCollections.length === 0 ? <p>이 Realm에서 사용할 수 있는 Collection이 없어 빈 대시보드 App으로 시작합니다.</p> : eligibleCollections.map((collection) => <label key={collection.id}>
          <input type="checkbox" checked={selected.includes(collection.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, collection.id] : current.filter((id) => id !== collection.id))} />
          <span><strong>{collection.label ?? collection.name}</strong><small>{collection.fields.length} fields · {collection.id}{collection.authRealmKey ? ` · Auth: ${collection.authRealmKey}` : ""}</small></span>
        </label>)}
      </fieldset>}
      <div className={styles.actions}><Button variant="secondary" onPress={() => navigate("/admin/apps")}>취소</Button><Button type="submit" isDisabled={pending}>{pending ? "생성 중…" : "Draft 생성"}</Button></div>
    </form>
  </section>;
}

export function AdminAppBuilderPage() {
  const { appId = "" } = useParams();
  const navigate = useNavigate();
  const [app, setApp] = useState<AdminAppDto | null>(null);
  const [draft, setDraft] = useState<AdminAppDraftDto | null>(null);
  const [revisions, setRevisions] = useState<readonly AdminAppRevisionDto[]>([]);
  const [health, setHealth] = useState<AdminAppHealthDto | null>(null);
  const [collections, setCollections] = useState<readonly CollectionSummaryDto[]>([]);
  const [realms, setRealms] = useState<readonly IdentityRealmDto[]>([]);
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<"basic" | "standard" | "advanced">("basic");
  const [preview, setPreview] = useState<AdminAppPreviewDto | null>(null);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const manifest = useMemo(() => parseManifest(source), [source]);
  const composed = useMemo(() => parseManifestV2(source), [source]);
  const [composedView, setComposedView] = useState<"canvas" | "json">("canvas");
  const dirty = draft !== null && source !== JSON.stringify(draft.manifest, null, 2);
  const eligibleCollections = useMemo(
    () => manifest === null ? [] : collectionsForAudience(collections, realms, manifest.audience),
    [collections, manifest, realms],
  );

  const reload = async () => {
    const [nextApp, nextDraft, history, schema, realmList, nextHealth] = await Promise.all([
      client.adminApps.get(appId), client.adminApps.getDraft(appId), client.adminApps.revisions(appId), client.collections.list(), client.identityRealms.list(), client.adminApps.health(appId),
    ]);
    setApp(nextApp); setDraft(nextDraft); setRevisions(history.items); setCollections(schema.items.filter(({ status }) => status === "applied"));
    setHealth(nextHealth);
    setRealms(realmList.items.filter(({ kind, status }) => kind === "content" && status === "active"));
    if (nextDraft !== null) setSource(JSON.stringify(nextDraft.manifest, null, 2));
  };
  useEffect(() => { void reload().catch((caught) => setError(message(caught))).finally(() => setLoading(false)); }, [appId]);

  const run = async (operation: () => Promise<void>) => {
    setPending(true); setError(null);
    try { await operation(); } catch (caught) { setError(message(caught)); } finally { setPending(false); }
  };
  const ensureDraft = () => run(async () => {
    if (app === null) return;
    const created = await client.adminApps.createDraft(app.id, { expectedRouteVersion: app.routeVersion });
    setDraft(created); setSource(JSON.stringify(created.manifest, null, 2));
  });
  const save = async (): Promise<AdminAppDraftDto> => {
    if (draft === null || manifest === null) throw new Error("유효한 Manifest JSON이 필요합니다.");
    const saved = await client.adminApps.saveDraft(appId, {
      expectedDraftVersion: draft.draftVersion,
      expectedBaseRevisionId: draft.baseRevisionId,
      manifest,
    });
    setDraft(saved); setSource(JSON.stringify(saved.manifest, null, 2)); setPreview(null);
    return saved;
  };
  const previewDraft = () => run(async () => {
    const saved = await save();
    if (app === null) return;
    setPreview(await client.adminApps.preview(appId, {
      expectedActiveRevisionId: app.activeRevisionId,
      expectedRouteVersion: app.routeVersion,
      expectedDraftVersion: saved.draftVersion,
    }));
  });
  const apply = () => run(async () => {
    if (preview === null || app === null || draft === null) return;
    await client.adminApps.apply(appId, {
      expectedActiveRevisionId: app.activeRevisionId,
      expectedRouteVersion: app.routeVersion,
      expectedDraftVersion: draft.draftVersion,
      planId: preview.planId,
    });
    setPreview(null); await reload();
  });
  const importSource = () => run(async () => {
    if (draft === null || manifest === null || app === null) return;
    const imported = await client.adminApps.importManifest({
      appId: app.id,
      expectedRouteVersion: app.routeVersion,
      expectedDraftVersion: draft.draftVersion,
      expectedBaseRevisionId: draft.baseRevisionId,
      manifest,
    });
    setDraft(imported.draft); setSource(JSON.stringify(imported.draft.manifest, null, 2));
  });
  const patchManifest = (update: (current: AdminAppManifestV1) => AdminAppManifestV1) => {
    if (manifest !== null) setSource(JSON.stringify(update(manifest), null, 2));
  };

  if (loading) return <LoadingIndicator label="App Builder를 불러오는 중" />;
  if (app === null) return <Callout tone="error">{error ?? "App을 찾을 수 없습니다."}</Callout>;
  return <section className={styles.page}>
    <UnsavedChangesGuard when={dirty} />
    <PageHeader title={app.name} description={`/apps/${app.key} · ${app.audience.type === "system" ? "System Realm" : app.audience.realmId}`}
      action={app.activeRevisionId === null ? null : <a className={styles.previewLink} href={`/apps/${app.key}`} target="_blank" rel="noreferrer">실행 App 열기 ↗</a>} />
    {error ? <Callout tone="error">{error}</Callout> : null}
    {health?.state === "degraded" ? <section className={styles.healthPanel}>
      <header><div><span>DEPENDENCY HEALTH</span><h2>현재 환경과 적용된 Revision이 달라졌습니다</h2></div><span className={styles.health} data-state="degraded">확인 필요</span></header>
      <p>App은 제한 모드로 열리며, 아래 항목을 확인한 뒤 새 Draft를 Preview/Apply하세요.</p>
      <div>{health.blockers.map((blocker) => <article key={`${blocker.code}:${blocker.message}`}><strong>{blocker.code}</strong><span>{blocker.message}</span></article>)}</div>
    </section> : null}
    <div className={styles.builderToolbar}>
      <div className={styles.modeTabs}>{(["basic", "standard", "advanced"] as const).map((value) => <button key={value} type="button" data-active={mode === value} onClick={() => setMode(value)}>{value === "basic" ? "Basic" : value === "standard" ? "Standard" : "Advanced"}</button>)}</div>
      <span className={styles.badges}><span className={styles.health} data-state={health?.state ?? "checking"}>{healthLabel(health)}</span><span className={styles.status} data-state={app.status}>{app.status === "active" ? "활성" : "보관됨"}</span></span>
    </div>
    {draft === null ? <div className={styles.empty}><h2>적용된 Revision</h2><p>새 Draft를 만들어 편집을 시작하세요.</p><Button onPress={() => void ensureDraft()}>새 Draft</Button></div> : manifest === null ? <Callout tone="error">Manifest JSON 형식이 올바르지 않습니다.</Callout> : composed !== null ? <>
      <div className={styles.builderToolbar}>
        <div className={styles.modeTabs}>
          <button type="button" data-active={composedView === "canvas"} onClick={() => setComposedView("canvas")}>화면</button>
          <button type="button" data-active={composedView === "json"} onClick={() => setComposedView("json")}>JSON</button>
        </div>
      </div>
      {composedView === "canvas" ? (
        <div className={styles.builderCard}>
          <div className={styles.composedPageBar}>
            <div><strong>Composed 화면</strong><span className={styles.help}>{composed.pages.filter((page) => page.type === "composed-page").length}개 화면. 실제 App 비율의 전용 편집기에서 드래그로 구성합니다.</span></div>
            <Button onPress={() => void run(async () => { if (dirty) await save(); navigate(`/admin-apps/${appId}/screens`); })} isDisabled={pending}>화면 편집 열기 ↗</Button>
          </div>
          <div className={styles.pageSummary}>{composed.pages.filter((page) => page.type === "composed-page").map((page) => <article key={page.id}><span>{page.screenNo}</span><strong>{page.title}</strong><code>{(page as ComposedPageDefinition).components.length} components</code></article>)}</div>
        </div>
      ) : (
        <div className={styles.builderCard}><label className={styles.field}><span>Manifest source (V2)</span><textarea className={styles.source} rows={26} value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} /></label></div>
      )}
      <div className={styles.actions}><Button variant="secondary" onPress={() => void run(async () => { await save(); })} isDisabled={pending}>Draft 저장</Button><Button onPress={() => void previewDraft()} isDisabled={pending}>검증 및 Preview</Button></div>
    </> : <>
      <div className={styles.upgradeBanner}>
        <div><strong>Composed Page로 확장</strong><span>이 App을 V2로 업그레이드하면 기존 화면을 유지한 채 드래그 캔버스로 새 화면을 구성할 수 있습니다. (Draft에만 적용되며 적용된 Revision은 보존됩니다.)</span></div>
        <Button
          size="small"
          variant="secondary"
          isDisabled={pending}
          onPress={() => {
            if (manifest === null) return;
            if (!window.confirm("이 Draft를 Composed Page 지원 V2로 업그레이드할까요? 기존 화면은 유지됩니다.")) return;
            setSource(JSON.stringify(upgradeManifestToV2(manifest), null, 2));
            setComposedView("canvas");
          }}
        >V2로 업그레이드</Button>
      </div>
      {mode === "basic" ? <div className={styles.builderCard}>
        <div className={styles.twoColumns}><TextField label="App 이름" value={manifest.name} onChange={(name) => patchManifest((current) => ({ ...current, name }))} /><TextField label="URL key" value={manifest.key} onChange={(key) => patchManifest((current) => ({ ...current, key }))} /></div>
        <label className={styles.field}><span>시작 화면</span><select value={manifest.startPageId} onChange={(event) => patchManifest((current) => ({ ...current, startPageId: event.target.value }))}>{manifest.pages.map((page) => <option key={page.id} value={page.id}>{pageLabel(page)}</option>)}</select></label>
        <div className={styles.pageSummary}>{manifest.pages.map((page) => <article key={page.id}><span>{page.type}</span><strong>{pageLabel(page)}</strong>{"collectionId" in page ? <code>{page.collectionId}</code> : null}</article>)}</div>
      </div> : null}
      {mode === "standard" ? <>
        <PageCatalogEditor manifest={manifest} collections={eligibleCollections} onChange={(next) => setSource(JSON.stringify(next, null, 2))} />
        <NavigationEditor manifest={manifest} onChange={(navigation) => patchManifest((current) => ({ ...current, navigation }))} />
        <PageStructureEditor manifest={manifest} onChange={(pages) => patchManifest((current) => ({ ...current, pages }))} />
      </> : null}
      {mode === "advanced" ? <div className={styles.builderCard}><label className={styles.field}><span>Manifest source</span><textarea className={styles.source} rows={26} value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} /></label><div className={styles.actions}>
        <label className={styles.fileButton}>JSON 파일 열기<input type="file" accept="application/json,.json" onChange={(event) => {
          const file = event.target.files?.[0]; if (file) void file.text().then(setSource).catch((caught) => setError(message(caught)));
          event.target.value = "";
        }} /></label>
        <Button variant="secondary" onPress={() => void importSource()} isDisabled={pending || manifest === null}>Import source</Button></div></div> : null}
      <div className={styles.actions}><Button variant="secondary" onPress={() => void run(async () => { await save(); })} isDisabled={pending || manifest === null}>Draft 저장</Button><Button onPress={() => void previewDraft()} isDisabled={pending || manifest === null}>검증 및 Preview</Button></div>
    </>}
    {preview ? <section className={styles.previewPanel}><header><div><span>APPLY PREVIEW</span><h2>{preview.blockers.length === 0 ? "적용할 준비가 됐습니다" : `${preview.blockers.length}개 문제를 해결해 주세요`}</h2></div><code>{preview.planId.slice(0, 24)}…</code></header>
      {preview.blockers.map((blocker) => <Callout key={`${blocker.code}:${blocker.message}`} tone="error"><strong>{blocker.code}</strong> · {blocker.message}
        {blocker.path ? <span className={styles.issuePath}>{blocker.path.join(".")}</span> : null}
        <button className={styles.issueLink} type="button" onClick={() => setMode("advanced")}>소스에서 확인</button>
      </Callout>)}
      <dl><div><dt>Dependency</dt><dd>{preview.dependencies.length}</dd></div><div><dt>Draft version</dt><dd>{preview.draftVersion}</dd></div><div><dt>변경</dt><dd>{preview.diff === null ? "최초 적용" : preview.diff.changed ? "있음" : "없음"}</dd></div></dl>
      {preview.diff?.entries.length ? <section className={styles.diffPanel}><h3>Manifest 변경 상세</h3><div>{preview.diff.entries.map((entry, index) => <DiffEntry key={`${entry.kind}:${entry.path.join(".")}:${index}`} entry={entry} />)}</div></section> : preview.diff?.changed === false ? <p className={styles.help}>적용된 Revision과 Manifest가 같습니다.</p> : null}
      <div className={styles.actions}><Button onPress={() => void apply()} isDisabled={pending || preview.blockers.length > 0}>Apply</Button></div>
    </section> : null}
    <section className={styles.builderCard}><h2>Revision과 상태</h2>
      <div className={styles.revisions}>{revisions.map((revision) => <article key={revision.id}><div><strong>Revision {revision.sequence}</strong><small>{new Date(revision.createdAt).toLocaleString()}</small></div>{revision.id === app.activeRevisionId ? <span>현재</span> : <Button size="small" variant="secondary" onPress={() => void run(async () => {
        if (app.activeRevisionId === null) return;
        await client.adminApps.rollback(app.id, { targetRevisionId: revision.id, expectedActiveRevisionId: app.activeRevisionId, expectedRouteVersion: app.routeVersion }); await reload();
      })}>Rollback</Button>}</article>)}</div>
      <div className={styles.stateControls}><TextField label="중요 작업용 현재 비밀번호" type="password" value={password} onChange={setPassword} /><div className={styles.actions}>
        <Button variant="secondary" onPress={() => void run(async () => {
          const artifact = await client.adminApps.exportManifest(app.id); download(`${app.key}.admin-app.json`, artifact.serialized);
        })}>Export</Button>
        <Button variant="secondary" isDisabled={!password || pending} onPress={() => void run(async () => {
          if (app.activeRevisionId === null) {
            await client.adminApps.delete(app.id, { expectedRouteVersion: app.routeVersion, currentPassword: password });
            navigate("/admin/apps", { replace: true }); return;
          }
          if (app.status === "active") await client.adminApps.archive(app.id, { expectedRouteVersion: app.routeVersion, currentPassword: password });
          else await client.adminApps.reactivate(app.id, { expectedRouteVersion: app.routeVersion, currentPassword: password });
          setPassword(""); await reload();
        })}>{app.activeRevisionId === null ? "Delete Draft App" : app.status === "active" ? "Archive" : "Reactivate"}</Button>
      </div></div>
    </section>
  </section>;
}

function PageCatalogEditor({ manifest, collections, onChange }: {
  readonly manifest: AdminAppManifestV1;
  readonly collections: readonly CollectionSummaryDto[];
  readonly onChange: (manifest: AdminAppManifestV1) => void;
}) {
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [pageType, setPageType] = useState<"list" | "create" | "edit" | "detail" | "trash" | "singleton">("list");
  const selected = collections.find(({ id }) => id === collectionId) ?? collections[0];
  useEffect(() => {
    if (collectionId === "" && collections[0]) setCollectionId(collections[0].id);
  }, [collectionId, collections]);
  useEffect(() => {
    if (selected?.kind === "singleton") setPageType("singleton");
    else if (pageType === "singleton") setPageType("list");
  }, [pageType, selected?.kind]);

  const add = () => {
    if (selected === undefined) return;
    const generated = generateAdminAppManifest({
      name: manifest.name,
      key: manifest.key,
      audience: manifest.audience,
      collections: [selected],
    });
    const candidate = generated.pages.find((page) => pageMatchesChoice(page, pageType));
    if (candidate === undefined) return;
    const id = uniquePortableId(candidate.id, new Set(manifest.pages.map((page) => page.id)));
    let page: AdminPageDefinition = { ...candidate, id };
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
  const remove = (pageId: string) => {
    if (manifest.pages.length <= 1) return;
    const pages = manifest.pages.filter(({ id }) => id !== pageId).map((page) =>
      page.type === "collection-list" && page.rowClick?.pageId === pageId
        ? { ...page, rowClick: undefined }
        : page);
    onChange({
      ...manifest,
      pages,
      navigation: removePageNavigation(manifest.navigation, pageId),
      startPageId: manifest.startPageId === pageId ? pages[0]!.id : manifest.startPageId,
    });
  };

  return <section className={styles.builderCard}><h2>Pages</h2><p className={styles.help}>Schema 기반 화면을 추가하거나 더 이상 쓰지 않는 화면을 제거합니다.</p>
    <div className={styles.pageComposer}>
      <label className={styles.field}><span>Collection</span><select value={selected?.id ?? ""} onChange={(event) => setCollectionId(event.target.value)}>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.label ?? collection.name}</option>)}</select></label>
      <label className={styles.field}><span>화면 종류</span><select value={pageType} onChange={(event) => setPageType(event.target.value as typeof pageType)}>
        {selected?.kind === "singleton" ? <option value="singleton">Singleton editor</option> : <><option value="list">목록</option><option value="create">생성 Form</option><option value="edit">편집 Form</option><option value="detail">상세</option><option value="trash">휴지통</option></>}
      </select></label><Button onPress={add} isDisabled={selected === undefined}>Page 추가</Button>
    </div>
    <div className={styles.pageRows}>{manifest.pages.map((page) => <article key={page.id}><div><strong>{pageLabel(page)}</strong><small>{page.type} · {page.id}{page.id === manifest.startPageId ? " · 시작 화면" : ""}</small></div><Button size="small" variant="secondary" isDisabled={manifest.pages.length <= 1} onPress={() => remove(page.id)}>제거</Button></article>)}</div>
  </section>;
}

function NavigationEditor({ manifest, onChange }: { readonly manifest: AdminAppManifestV1; readonly onChange: (items: readonly AdminNavigationItem[]) => void }) {
  const move = (index: number, offset: number) => {
    const items = [...manifest.navigation]; const target = index + offset;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!]; onChange(items);
  };
  return <section className={styles.builderCard}><h2>Navigation</h2><p className={styles.help}>키보드로도 순서를 조정할 수 있습니다.</p>
    <div className={styles.navigationEditor}>{manifest.navigation.map((item, index) => <article key={item.id}><div><strong>{item.label}</strong><small>{item.pageId ?? `${item.children?.length ?? 0} children`}</small></div><span><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${item.label} 위로`}>↑</button><button type="button" disabled={index === manifest.navigation.length - 1} onClick={() => move(index, 1)} aria-label={`${item.label} 아래로`}>↓</button></span></article>)}</div>
  </section>;
}

function PageStructureEditor({ manifest, onChange }: {
  readonly manifest: AdminAppManifestV1;
  readonly onChange: (pages: AdminAppManifestV1["pages"]) => void;
}) {
  const replace = (pageId: string, next: AdminAppManifestV1["pages"][number]) =>
    onChange(manifest.pages.map((page) => page.id === pageId ? next : page));
  return <section className={styles.builderCard}><h2>List columns와 Form field 순서</h2>
    <p className={styles.help}>Manifest가 참조하는 stable Field ID는 유지하면서 표시 순서를 조정합니다.</p>
    <div className={styles.structurePages}>{manifest.pages.flatMap((page) => {
      if (page.type === "collection-list") return [<article key={page.id}><header><span>LIST</span><strong>{pageLabel(page)}</strong></header>
        <div>{page.columns.map((column, index) => <div key={column.id}><code>{column.label ?? column.id}</code><span>
          <button type="button" disabled={index === 0} onClick={() => { const columns = [...page.columns]; [columns[index - 1], columns[index]] = [columns[index]!, columns[index - 1]!]; replace(page.id, { ...page, columns }); }}>↑</button>
          <button type="button" disabled={index === page.columns.length - 1} onClick={() => { const columns = [...page.columns]; [columns[index + 1], columns[index]] = [columns[index]!, columns[index + 1]!]; replace(page.id, { ...page, columns }); }}>↓</button>
          <button type="button" disabled={page.columns.length <= 1} onClick={() => replace(page.id, { ...page, columns: page.columns.filter(({ id }) => id !== column.id) })}>×</button>
        </span></div>)}</div>
        <div className={styles.inlineEditor}><label className={styles.field}><span>기본 정렬</span><select value={fieldReferenceKey(page.defaultSort?.[0]?.field)} onChange={(event) => {
          const column = page.columns.find(({ field }) => fieldReferenceKey(field) === event.target.value);
          replace(page.id, { ...page, defaultSort: column === undefined ? undefined : [{ field: column.field, direction: page.defaultSort?.[0]?.direction ?? "asc" }] });
        }}><option value="">정렬 없음</option>{page.columns.map((column) => <option key={column.id} value={fieldReferenceKey(column.field)}>{column.label ?? column.id}</option>)}</select></label>
        <label className={styles.field}><span>방향</span><select disabled={!page.defaultSort?.[0]} value={page.defaultSort?.[0]?.direction ?? "asc"} onChange={(event) => page.defaultSort?.[0] && replace(page.id, { ...page, defaultSort: [{ ...page.defaultSort[0], direction: event.target.value as "asc" | "desc" }] })}><option value="asc">오름차순</option><option value="desc">내림차순</option></select></label></div>
        <div className={styles.filterEditor}><strong>사용자 필터</strong>{page.availableFilters?.map((filter) => <div key={filter.id}><code>{filter.label}</code><button type="button" onClick={() => replace(page.id, { ...page, availableFilters: page.availableFilters?.filter(({ id }) => id !== filter.id) })}>제거</button></div>)}
          <button type="button" onClick={() => {
            const column = page.columns.find(({ field }) => field.kind === "data" && !page.availableFilters?.some((filter) => fieldReferenceKey(filter.field) === fieldReferenceKey(field)));
            if (column?.field.kind !== "data") return;
            const id = uniquePortableId(`${page.id}-filter`, new Set(page.availableFilters?.map((filter) => filter.id) ?? []));
            replace(page.id, { ...page, availableFilters: [...(page.availableFilters ?? []), { id, label: column.label ?? column.field.fieldId, field: column.field, operators: ["eq"] }] });
          }}>Column 필터 추가</button></div>
      </article>];
      if (page.type === "document-form") {
        const section = page.layout.nodes.find((node) => node.type === "section");
        if (section === undefined) return [];
        const fields = section.children.filter((node) => node.type === "field");
        return [<article key={page.id}><header><span>FORM · {page.mode}</span><strong>{page.id}</strong></header>
          <div className={styles.inlineEditor}><label className={styles.field}><span>Section 제목</span><input value={section.title ?? ""} onChange={(event) => replace(page.id, { ...page, layout: { nodes: page.layout.nodes.map((node) => node.id === section.id ? { ...section, title: event.target.value || undefined } : node) } })} /></label><label className={styles.field}><span>Columns</span><select value={section.columns ?? 1} onChange={(event) => replace(page.id, { ...page, layout: { nodes: page.layout.nodes.map((node) => node.id === section.id ? { ...section, columns: Number(event.target.value) as 1 | 2 | 3 } : node) } })}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label></div>
          <div>{fields.map((field, index) => <div key={field.id}><code>{field.fieldId}</code><span>
            <button type="button" disabled={index === 0} onClick={() => moveFormField(page, section.id, index, -1, replace)}>↑</button>
            <button type="button" disabled={index === fields.length - 1} onClick={() => moveFormField(page, section.id, index, 1, replace)}>↓</button>
          </span></div>)}</div></article>];
      }
      return [];
    })}</div>
  </section>;
}

function moveFormField(
  page: Extract<AdminAppManifestV1["pages"][number], { readonly type: "document-form" }>,
  sectionId: string,
  index: number,
  offset: number,
  replace: (pageId: string, next: AdminAppManifestV1["pages"][number]) => void,
): void {
  const nodes = page.layout.nodes.map((node) => {
    if (node.type !== "section" || node.id !== sectionId) return node;
    const children = [...node.children];
    [children[index + offset], children[index]] = [children[index]!, children[index + offset]!];
    return { ...node, children };
  });
  replace(page.id, { ...page, layout: { nodes } });
}

function pageMatchesChoice(page: AdminPageDefinition, choice: "list" | "create" | "edit" | "detail" | "trash" | "singleton"): boolean {
  if (choice === "list") return page.type === "collection-list" && page.state !== "deleted";
  if (choice === "trash") return page.type === "collection-list" && page.state === "deleted";
  if (choice === "create" || choice === "edit") return page.type === "document-form" && page.mode === choice;
  return page.type === choice;
}

function flatNavigation(items: readonly AdminNavigationItem[]): readonly AdminNavigationItem[] {
  return items.flatMap((item) => [item, ...flatNavigation(item.children ?? [])]);
}

function removePageNavigation(items: readonly AdminNavigationItem[], pageId: string): readonly AdminNavigationItem[] {
  return items.flatMap((item) => {
    const children = removePageNavigation(item.children ?? [], pageId);
    const pageMatches = item.pageId === pageId;
    if (pageMatches && children.length === 0) return [];
    return [{
      ...item,
      ...(pageMatches ? { pageId: undefined } : {}),
      ...(item.children === undefined && children.length === 0 ? {} : { children }),
    }];
  });
}

function uniquePortableId(preferred: string, used: ReadonlySet<string>): string {
  const base = preferred.slice(0, 60).replace(/-+$/g, "") || "page";
  if (!used.has(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 64 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("고유한 ID를 만들 수 없습니다.");
}

function fieldReferenceKey(field: { readonly kind: "data"; readonly fieldId: string } | { readonly kind: "system"; readonly field: string } | undefined): string {
  if (field === undefined) return "";
  return field.kind === "data" ? `data:${field.fieldId}` : `system:${field.field}`;
}

function collectionsForRealm(
  collections: readonly CollectionSummaryDto[],
  realms: readonly IdentityRealmDto[],
  realmId: string,
): readonly CollectionSummaryDto[] {
  if (realmId === "system") return collections.filter(({ authRealmKey }) => authRealmKey === undefined);
  const realmKey = realms.find((realm) => realm.realmId === realmId)?.realmKey;
  return collections.filter(({ authRealmKey }) => authRealmKey === undefined || authRealmKey === realmKey);
}

function collectionsForAudience(
  collections: readonly CollectionSummaryDto[],
  realms: readonly IdentityRealmDto[],
  audience: AdminAppManifestV1["audience"],
): readonly CollectionSummaryDto[] {
  return collectionsForRealm(
    collections,
    realms,
    audience.type === "system" ? "system" : audience.realmId,
  );
}

function PageHeader({ title, description, action }: { readonly title: string; readonly description: string; readonly action?: React.ReactNode }) { return <header className={styles.pageHeader}><div><span>Custom Admin Apps</span><h1>{title}</h1><p>{description}</p></div>{action}</header>; }

function DiffEntry({ entry }: { readonly entry: AdminAppManifestDiffEntry }) {
  return <article data-kind={entry.kind}><header><span>{entry.kind === "added" ? "추가" : entry.kind === "removed" ? "삭제" : "변경"}</span><code>{entry.path.length === 0 ? "(root)" : entry.path.join(".")}</code></header><div>
    {entry.kind === "added" ? null : <p><small>이전</small><code>{diffValue(entry.before)}</code></p>}
    {entry.kind === "removed" ? null : <p><small>이후</small><code>{diffValue(entry.after)}</code></p>}
  </div></article>;
}

function diffValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return "undefined";
  return serialized.length > 240 ? `${serialized.slice(0, 237)}…` : serialized;
}

function healthLabel(health: AdminAppHealthDto | null | undefined): string {
  if (health === undefined || health === null) return "확인 중";
  if (health.state === "not-applied") return "미적용";
  return health.state === "healthy" ? "정상" : "확인 필요";
}
function TextField({ label, value, onChange, type = "text", required = false, pattern }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly type?: string; readonly required?: boolean; readonly pattern?: string }) { return <label className={styles.field}><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} pattern={pattern} /></label>; }

function parseManifest(source: string): AdminAppManifestV1 | null { try { const value = JSON.parse(source) as unknown; return typeof value === "object" && value !== null ? value as AdminAppManifestV1 : null; } catch { return null; } }
/** A minimal, valid V2 manifest with one empty Composed Page to start editing. */
export function buildComposedManifest(input: {
  readonly name: string;
  readonly key: string;
  readonly audience: AdminAppManifestV2["audience"];
}): AdminAppManifestV2 {
  return {
    format: "xecms.admin-app",
    formatVersion: 2,
    id: input.key,
    name: input.name,
    key: input.key,
    audience: input.audience,
    presentation: { layoutProfile: "16:9", menuPosition: "left", canvasAlignment: "top-center" },
    navigation: [{ id: "nav-screen-1", label: "화면 1", pageId: "pg-screen-1" }],
    pages: [{
      id: "pg-screen-1",
      type: "composed-page",
      screenNo: "SCR-001",
      title: "화면 1",
      menuLabel: "화면 1",
      layout: { columns: 48, rowHeight: 8 },
      state: [],
      dataSources: [],
      components: [],
      connections: [],
    }],
    startPageId: "pg-screen-1",
  };
}

/**
 * Only treats a source as an editable V2 manifest once it is structurally
 * complete enough for the canvas editor. Mid-typing states (e.g. formatVersion
 * flipped to 2 before presentation/pages exist) fall back to the JSON editor
 * instead of crashing the editor.
 */
export function parseManifestV2(source: string): AdminAppManifestV2 | null {
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    if (value === null || typeof value !== "object" || value["formatVersion"] !== 2) return null;
    if (!Array.isArray(value["pages"]) || !Array.isArray(value["navigation"])) return null;
    if (value["presentation"] === null || typeof value["presentation"] !== "object") return null;
    return value as unknown as AdminAppManifestV2;
  } catch { return null; }
}
function pageLabel(page: AdminAppManifestV1["pages"][number]): string { return "title" in page && page.title ? page.title : page.id; }
function message(error: unknown): string { return error instanceof XeCmsApiError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : "요청을 처리할 수 없습니다."; }
function download(fileName: string, value: string): void { const url = URL.createObjectURL(new Blob([value], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); }
