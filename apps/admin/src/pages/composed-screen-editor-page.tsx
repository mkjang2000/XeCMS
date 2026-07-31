import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import {
  validateAdminAppManifestV2,
  convertGeneratedToComposed,
  masterDetailPreset,
  searchListPreset,
  viewEditPreset,
  type AdminAppManifestV2,
  type ComponentDefinition,
  type ComposedPageDefinition,
  type PresetColumn,
} from "@xecms/admin-apps";
import {
  CANVAS_WIDTH,
  COLUMN_WIDTH,
  ROW_HEIGHT,
  SHELL_WIDTH,
  baseViewportHeight,
  computeShellScale,
} from "@xecms/admin-runtime/geometry";
import {
  XeCmsApiError,
  type AdminAppDto,
  type AdminAppDraftDto,
  type CollectionSummaryDto,
} from "@xecms/client";

import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import { xecmsClient as client } from "../xecms-client.js";
import { ComposedCanvas, type LinkDragState } from "./composed-editor/canvas.js";
import {
  addBlockToPage,
  blockFields,
  blockIdOf,
  blockKindLabel,
  blockLinks,
  canLinkBlocks,
  describeBlocks,
  duplicateBlock,
  hasSelfQuery,
  isListBlock,
  legacyComponents,
  linkBlocks,
  linkBlocksByField,
  removeBlockFromPage,
  removeLegacyComponents,
  unlinkBlocks,
  type BlockLink,
  type FormBlock,
  type FormBlockField,
  type FormBlockKind,
} from "./composed-editor/form-blocks.js";
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
import {
  removeComponent,
  replacePage,
  updateComponentEvents,
  updateComponentProps,
  updatePlacement,
} from "./composed-editor/model.js";
import styles from "./composed-screen-editor.module.css";

const MENU_WIDTH = 240;

/** Palette groups the form blocks the user can add, in user-facing categories. */
const PALETTE_GROUPS: readonly { readonly title: string; readonly kinds: readonly FormBlockKind[] }[] = [
  { title: "검색", kinds: ["search", "date-search", "select-search", "number-search", "multi-search"] },
  { title: "출력", kinds: ["list", "cards", "detail", "field"] },
  { title: "입력·작업", kinds: ["input-form", "item-actions"] },
];

export function ComposedScreenEditorPage() {
  const { appId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [app, setApp] = useState<AdminAppDto | null>(null);
  const [draft, setDraft] = useState<AdminAppDraftDto | null>(null);
  const history = useManifestHistory();
  const { manifest, undo, redo, canUndo, canRedo } = history;
  const setManifest = history.set;
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<readonly CollectionSummaryDto[]>([]);
  const [mode, setMode] = useState<"layout" | "connect">("layout");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  // Connect mode: the block picked as the link source ("이 검색폼에서 →").
  const [pendingLinkBlockId, setPendingLinkBlockId] = useState<string | null>(null);
  // Connect mode: an in-progress drag from a source block to a target (rubber-band line).
  const [linkDrag, setLinkDrag] = useState<LinkDragState | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const savedJson = useRef<string>("");
  const dirty = manifest !== null && JSON.stringify(manifest) !== savedJson.current;

  // Keyboard shortcuts read the latest handlers through a ref so this effect
  // binds once (the derived selection/active values live after the early returns).
  const shortcutsRef = useRef<{
    undo: () => void; redo: () => void;
    deleteSelected: () => void; duplicateSelected: () => void; save: () => void;
  }>({ undo: () => {}, redo: () => {}, deleteSelected: () => {}, duplicateSelected: () => {}, save: () => {} });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      // Don't hijack typing in inputs/selects/textareas.
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) shortcutsRef.current.redo(); else shortcutsRef.current.undo();
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault(); shortcutsRef.current.redo();
      } else if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault(); shortcutsRef.current.save();
      } else if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault(); shortcutsRef.current.duplicateSelected();
      } else if (event.key === "Delete" || event.key === "Backspace") {
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
        if (!active) return;
        setApp(nextApp);
        setDraft(nextDraft);
        setCollections(schema.items.filter(({ status }) => status === "applied"));
        if (nextDraft?.manifest.formatVersion === 2) {
          history.reset(nextDraft.manifest);
          savedJson.current = JSON.stringify(nextDraft.manifest);
        }
      } catch (caught) {
        if (active) setError(message(caught));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [appId]);

  const composedPages = useMemo(
    () => (manifest?.pages.filter((page): page is ComposedPageDefinition => page.type === "composed-page") ?? []),
    [manifest],
  );
  const activePageId = searchParams.get("page") ?? composedPages[0]?.id ?? null;
  const active = composedPages.find((page) => page.id === activePageId) ?? composedPages[0] ?? null;

  const save = async (): Promise<void> => {
    if (manifest === null || draft === null) return;
    setPending(true); setError(null);
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
    } catch (caught) {
      setError(caught instanceof XeCmsApiError && caught.status === 409
        ? "다른 곳에서 Draft가 변경되었습니다. 페이지를 새로고침해 주세요."
        : message(caught));
    } finally { setPending(false); }
  };

  if (loading) return <LoadingIndicator label="화면 편집기를 불러오는 중" />;
  if (error !== null && manifest === null) {
    return <FullscreenNotice title="편집기를 열 수 없습니다" detail={error} onBack={() => navigate(`/admin/apps/${appId}`)} />;
  }
  if (app === null || draft === null) {
    return <FullscreenNotice title="Draft가 필요합니다" detail="빌더에서 Draft를 만든 뒤 화면을 편집할 수 있습니다." onBack={() => navigate(`/admin/apps/${appId}`)} />;
  }
  if (manifest === null) {
    return <FullscreenNotice title="Composed App이 아닙니다" detail="이 화면 편집기는 Composed(V2) App에서만 사용할 수 있습니다. 빌더에서 V2로 업그레이드하세요." onBack={() => navigate(`/admin/apps/${appId}`)} />;
  }

  const commit = (nextPage: ComposedPageDefinition): void => setManifest(replacePage(manifest, nextPage.id, nextPage));

  /** Inserts a Composed Page plus a navigation entry, then focuses it. */
  const addPage = (page: ComposedPageDefinition): void => {
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

  const addScreen = (): void => {
    const meta = nextScreenMeta();
    addPage({
      id: meta.pageId, type: "composed-page", screenNo: meta.screenNo, title: meta.title, menuLabel: meta.menuLabel,
      layout: { columns: 48, rowHeight: 8 }, state: [], dataSources: [], components: [], connections: [],
    });
  };

  /** Adds a Composed Page from a built-in Preset, seeded from a Collection's fields. */
  const addPreset = (kind: "searchList" | "masterDetail" | "viewEdit", collectionId: string): void => {
    const collection = collections.find((entry) => entry.id === collectionId);
    if (collection === undefined || collection.fields.length === 0) return;
    const meta = nextScreenMeta();
    const searchFieldId = collection.fields[0]!.id;
    const columns: PresetColumn[] = collection.fields.slice(0, 4).map((field) => ({
      fieldId: field.id, label: field.label ?? field.name,
      ...(field.sensitivity?.defaultMaskPolicyId === undefined ? {} : { maskPolicyId: field.sensitivity.defaultMaskPolicyId }),
    }));
    const detailFields = columns;
    if (kind === "searchList") {
      addPage(searchListPreset({ meta, collectionId, searchFieldId, columns }));
    } else if (kind === "masterDetail") {
      addPage(masterDetailPreset({ meta, collectionId, searchFieldId, listColumns: columns, detailFields }));
    } else {
      addPage(viewEditPreset({ meta, collectionId, searchFieldId, listColumns: columns, detailFields, formFieldIds: columns.map((c) => c.fieldId) }));
    }
  };

  /** Copies a Generated Page in this manifest into a new, independent Composed Page. */
  const convertGenerated = (generatedPageId: string): void => {
    const generated = manifest.pages.find((page) => page.id === generatedPageId);
    if (generated === undefined || generated.type === "composed-page") return;
    const composed = convertGeneratedToComposed(generated, nextScreenMeta());
    if (composed === null) { setError("이 Generated Page는 아직 Composed로 변환할 수 없습니다."); return; }
    addPage(composed);
  };

  const patchActiveMeta = (patch: Partial<Pick<ComposedPageDefinition, "screenNo" | "title" | "menuLabel">>): void => {
    if (active === null) return;
    const nextPage = { ...active, ...patch };
    // The App menu shows the nav label; keep it in sync with the screen's menuLabel.
    const navigation = patch.menuLabel === undefined
      ? manifest.navigation
      : manifest.navigation.map((item) => item.pageId === active.id ? { ...item, label: patch.menuLabel! } : item);
    setManifest({ ...replacePage(manifest, active.id, nextPage), navigation });
  };

  /** Removes the active screen (its page + navigation entry) and focuses another. */
  const removeScreen = (): void => {
    if (active === null) return;
    if (composedPages.length <= 1) { setError("마지막 화면은 삭제할 수 없습니다."); return; }
    if (typeof window !== "undefined" && !window.confirm(`화면 '${active.title || active.id}'을(를) 삭제할까요?`)) return;
    const remaining = manifest.pages.filter((page) => page.id !== active.id);
    const nextManifest: AdminAppManifestV2 = {
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
    if (nextFocus !== undefined) setSearchParams({ page: nextFocus.id });
  };

  /** Moves the active screen earlier/later in the page + navigation order. */
  const moveScreen = (direction: -1 | 1): void => {
    if (active === null) return;
    const order = composedPages.map((page) => page.id);
    const from = order.indexOf(active.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    // Reorder within the composed-page positions of the full pages array.
    const composedPositions = manifest.pages.flatMap((page, index) => page.type === "composed-page" ? [index] : []);
    const pages = [...manifest.pages];
    const a = composedPositions[from]!; const b = composedPositions[to]!;
    [pages[a], pages[b]] = [pages[b]!, pages[a]!];
    // Mirror the order in navigation (keep entries for these two pages swapped).
    const navFrom = manifest.navigation.findIndex((item) => item.pageId === order[from]);
    const navTo = manifest.navigation.findIndex((item) => item.pageId === order[to]);
    const navigation = [...manifest.navigation];
    if (navFrom >= 0 && navTo >= 0) [navigation[navFrom], navigation[navTo]] = [navigation[navTo]!, navigation[navFrom]!];
    setManifest({ ...manifest, pages, navigation });
  };

  /** Adds a form block seeded from a Collection's first fields; user refines in the inspector. */
  const addFormBlock = (kind: FormBlockKind): void => {
    if (active === null) return;
    const collection = collections[0];
    if (collection === undefined) { setError("먼저 스키마(Collection)를 만들어 주세요."); return; }
    const fields: FormBlockField[] = collection.fields.slice(0, 4).map((field) => ({
      fieldId: field.id, label: field.label ?? field.name,
      ...(field.sensitivity?.defaultMaskPolicyId === undefined ? {} : { maskPolicyId: field.sensitivity.defaultMaskPolicyId }),
    }));
    const { page, blockId } = addBlockToPage(active, { kind, collectionId: collection.id, fields });
    commit(page);
    const block = describeBlocks(page).find((entry) => entry.id === blockId);
    if (block !== undefined) { setSelectedId(block.anchorComponentId); setSelectedConnectionId(null); }
  };

  /** Commits a form→form link if the blocks are compatible. Shared by click & drag. */
  const linkBlockIds = (fromBlockId: string, toBlockId: string): void => {
    if (active === null || fromBlockId === toBlockId) return;
    const blocks = describeBlocks(active);
    const from = blocks.find((block) => block.id === fromBlockId);
    const to = blocks.find((block) => block.id === toBlockId);
    if (from === undefined || to === undefined || !canLinkBlocks(from, to, active)) return;
    // Cross-schema: target runs its own query → feed it a source-row field value.
    if (isListBlock(from.kind) && isListBlock(to.kind) && hasSelfQuery(active, to)) {
      const sourceFieldId = blockFields(active, from)[0]?.fieldId;
      if (sourceFieldId !== undefined) commit(linkBlocksByField(active, from, to, sourceFieldId));
    } else {
      commit(linkBlocks(active, from, to));
    }
  };

  /** Connect mode (click flow): pick a source block, then a target to link. */
  const onBlockClick = (componentId: string): void => {
    if (active === null) return;
    // The canvas hands us the clicked component id; map it to its owning block.
    const blockId = blockIdOf(componentId);
    if (blockId === null) return;
    if (pendingLinkBlockId === null) { setPendingLinkBlockId(blockId); return; }
    if (pendingLinkBlockId === blockId) { setPendingLinkBlockId(null); return; }
    linkBlockIds(pendingLinkBlockId, blockId);
    setPendingLinkBlockId(null);
  };

  /** Connect mode (drag flow): the canvas reports the live drag; mirror its source
   *  into `pendingLinkBlockId` so target highlighting/overlay dimming light up. */
  const onLinkDrag = (state: LinkDragState | null): void => {
    setLinkDrag(state);
    if (state === null) return;
    const sourceBlockId = blockIdOf(state.sourceId);
    if (sourceBlockId !== null) setPendingLinkBlockId(sourceBlockId);
  };

  /** Connect mode (drag flow): released over a target cell → link the two blocks. */
  const onLinkDrop = (sourceComponentId: string, targetComponentId: string | null): void => {
    const fromBlockId = blockIdOf(sourceComponentId);
    const toBlockId = targetComponentId === null ? null : blockIdOf(targetComponentId);
    if (fromBlockId !== null && toBlockId !== null) linkBlockIds(fromBlockId, toBlockId);
    setPendingLinkBlockId(null);
    setLinkDrag(null);
  };

  const selected = active?.components.find(({ id }) => id === selectedId) ?? null;
  // A selected component that belongs to a form block → edit the whole block.
  const selectedBlock: FormBlock | null = active !== null && selectedId !== null
    ? describeBlocks(active).find((block) => block.componentIds.includes(selectedId)) ?? null
    : null;
  // The Collection a table renders = the collection of the Data Source feeding its `data` port.
  const tableCollectionId = selected?.kind === "core.output.table" && active !== null
    ? tableSourceCollectionId(active, selected.id) : undefined;
  const issues = validateAdminAppManifestV2(manifest).issues;
  const legacyCount = active === null ? 0 : legacyComponents(active).length;
  // Component ids on the active page that have a validation issue (for canvas
  // badges). A plain computation (not a hook) — it runs after early returns.
  const issueComponentIds = ((): ReadonlySet<string> => {
    const ids = new Set<string>();
    if (active === null) return ids;
    const pageIndex = manifest.pages.findIndex((page) => page.id === active.id);
    for (const issue of issues) {
      const [root, pIdx, section, cIdx] = issue.path;
      if (root === "pages" && pIdx === pageIndex && section === "components" && typeof cIdx === "number") {
        const component = active.components[cIdx];
        if (component !== undefined) ids.add(component.id);
      }
    }
    return ids;
  })();

  // Keep the keyboard shortcut handlers pointed at the current selection/state.
  const deleteSelected = (): void => {
    if (active === null || selectedBlock === null) return;
    commit(removeBlockFromPage(active, selectedBlock.id));
    setSelectedId(null);
  };
  const duplicateSelected = (): void => {
    if (active === null || selectedBlock === null) return;
    const result = duplicateBlock(active, selectedBlock);
    commit(result.page);
    const block = describeBlocks(result.page).find((entry) => entry.id === result.blockId);
    if (block !== undefined) setSelectedId(block.anchorComponentId);
  };
  shortcutsRef.current = { undo, redo, deleteSelected, duplicateSelected, save: () => { void save(); } };

  return (
    <div className={styles.workspace}>
      <UnsavedChangesGuard when={dirty} />
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Button size="small" variant="secondary" onPress={() => navigate(`/admin/apps/${appId}`)}>← 빌더로</Button>
          <strong>{app.name}</strong>
          <select
            value={active?.id ?? ""}
            onChange={(event) => setSearchParams({ page: event.target.value })}
            aria-label="편집할 화면"
          >
            {composedPages.map((page) => <option key={page.id} value={page.id}>{page.screenNo} · {page.title}</option>)}
          </select>
          <Button size="small" variant="secondary" onPress={() => addScreen()}>+ 빈 화면</Button>
          <PresetMenu
            collections={collections}
            generatedPages={manifest.pages.filter((page) => page.type !== "composed-page")}
            onPreset={addPreset}
            onConvert={convertGenerated}
          />
          {active !== null && legacyCount > 0 ? (
            <Button size="small" variant="secondary" onPress={() => {
              if (typeof window !== "undefined" && !window.confirm(`이 화면에서 편집할 수 없는 이전 폼 ${legacyCount}개를 삭제할까요?`)) return;
              commit(removeLegacyComponents(active));
              setSelectedId(null);
            }}>이전 폼 정리 ({legacyCount})</Button>
          ) : null}
        </div>
        <div className={styles.topbarRight}>
          <div className={styles.undoRedo}>
            <button type="button" onClick={undo} disabled={!canUndo} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">↶</button>
            <button type="button" onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">↷</button>
          </div>
          <div className={styles.modeToggle} role="tablist" aria-label="편집 모드">
            <button type="button" role="tab" aria-selected={mode === "layout"} onClick={() => { setMode("layout"); setPendingLinkBlockId(null); }}>배치</button>
            <button type="button" role="tab" aria-selected={mode === "connect"} onClick={() => { setMode("connect"); setSelectedId(null); }}>연결</button>
          </div>
          {mode === "connect" ? (
            <span className={styles.connectHint}>{linkDrag !== null ? "결과를 받을 폼 위에서 놓으세요" : pendingLinkBlockId === null ? "검색폼에서 결과 폼으로 드래그하거나, 눌러서 연결하세요" : "결과를 받을 폼을 누르세요"}</span>
          ) : null}
          {issues.length > 0 ? (
            <button type="button" className={styles.issueBadge} onClick={() => setIssuesOpen((open) => !open)} aria-expanded={issuesOpen}>
              {issues.length}개 문제 {issuesOpen ? "▲" : "▼"}
            </button>
          ) : null}
          <Button size="small" variant="secondary" onPress={() => setPreviewOpen(true)} isDisabled={composedPages.length === 0}>미리보기</Button>
          <Button size="small" onPress={() => void save()} isDisabled={pending || !dirty}>{pending ? "저장 중…" : "저장"}</Button>
        </div>
      </header>
      {error !== null ? <Callout tone="error">{error}</Callout> : null}
      {issues.length > 0 && issuesOpen ? (
        <div className={styles.issuePanel} role="region" aria-label="검증 문제">
          <ul>
            {issues.slice(0, 20).map((issue, index) => {
              const componentId = issueComponentId(manifest, active, issue);
              return (
                <li key={index}>
                  {componentId !== null ? (
                    <button type="button" className={styles.issueJump} onClick={() => { setMode("layout"); setSelectedId(componentId); }}>
                      {friendlyIssue(issue.code, issue.message)} <span aria-hidden="true">→ 이동</span>
                    </button>
                  ) : friendlyIssue(issue.code, issue.message)}
                </li>
              );
            })}
          </ul>
          {issues.length > 20 ? <p className={styles.paletteHint}>외 {issues.length - 20}건</p> : null}
        </div>
      ) : null}

      <div className={styles.body}>
        <aside className={styles.palette} aria-label="폼 블록 팔레트">
          {mode === "layout" ? (
            <>
              {PALETTE_GROUPS.map((group) => (
                <section key={group.title}>
                  <h4>{group.title}</h4>
                  {group.kinds.map((kind) => (
                    <button key={kind} type="button" className={styles.paletteItem} onClick={() => addFormBlock(kind)} disabled={active === null}>
                      + {blockKindLabel(kind)}
                    </button>
                  ))}
                </section>
              ))}
              <p className={styles.paletteHint}>폼을 놓으면 스키마 첫 필드로 채워집니다. 폼을 선택해 스키마·필드를 바꾸세요.</p>
            </>
          ) : (
            <section>
              <h4>폼 연결</h4>
              <p className={styles.paletteHint}>검색폼에서 목록·상세 폼으로 <b>드래그</b>해 연결하세요. (누른 뒤 대상 폼을 눌러도 됩니다.) 연결하면 검색 결과가 그 폼으로 흘러갑니다.</p>
              <p className={styles.paletteHint}>연결선 가운데 점을 누르면 연결이 끊깁니다.</p>
            </section>
          )}
        </aside>

        <div className={styles.stage}>
          {active === null ? (
            <p className={styles.stageEmpty}>편집할 Composed 화면이 없습니다.</p>
          ) : (
            <AppShellFrame manifest={manifest} activePageId={active.id}>
              {(scale) => (
                <>
                {mode === "layout" && active.components.length === 0 ? (
                  <div className={styles.onboarding} role="note">
                    <strong>이 화면은 비어 있습니다</strong>
                    <p>왼쪽 <b>폼 추가</b>에서 폼을 놓아 시작하세요. 보통 이렇게 만듭니다:</p>
                    <ol>
                      <li><b>검색폼</b>으로 스키마·검색 조건을 정하고</li>
                      <li><b>목록표</b>를 추가해 <b>연결 모드</b>에서 검색폼과 이으면</li>
                      <li>조회 결과가 목록에 나옵니다. <b>상세</b>도 목록에 이어 붙일 수 있어요.</li>
                    </ol>
                    <div className={styles.onboardingActions}>
                      <Button size="small" onPress={() => addFormBlock("search")}>검색폼 추가</Button>
                      <Button size="small" variant="secondary" onPress={() => addFormBlock("list")}>목록표 추가</Button>
                    </div>
                  </div>
                ) : null}
                <ComposedCanvas
                  page={active}
                  selectedId={selectedId}
                  locked={mode === "connect"}
                  scale={scale}
                  profile={manifest.presentation.layoutProfile}
                  onSelect={(id) => { setSelectedId(id); setSelectedConnectionId(null); }}
                  onPlace={(id, placement) => commit(updatePlacement(active, id, placement))}
                  onLockedActivate={onBlockClick}
                  onLinkDrag={mode === "connect" ? onLinkDrag : undefined}
                  onLinkDrop={mode === "connect" ? onLinkDrop : undefined}
                  cellTone={mode === "connect" ? (id) => blockCellTone(active, id, pendingLinkBlockId) : undefined}
                  cellHasIssue={(id) => issueComponentIds.has(id)}
                  overlay={mode === "connect" ? (
                    <BlockLinkOverlay page={active} pendingLinkBlockId={pendingLinkBlockId} linkDrag={linkDrag} onUnlink={(link) => {
                      const blocks = describeBlocks(active);
                      const from = blocks.find((b) => b.id === link.fromBlockId);
                      const to = blocks.find((b) => b.id === link.toBlockId);
                      if (from !== undefined && to !== undefined) commit(unlinkBlocks(active, from, to));
                    }} />
                  ) : undefined}
                  renderComponent={(component) => (
                    mode === "connect"
                      ? <BlockPreview component={component} />
                      : <div className={styles.livePreview}><LivePreviewCell component={component} collections={collections} /></div>
                  )}
                />
                </>
              )}
            </AppShellFrame>
          )}
        </div>

        <aside className={styles.inspector} aria-label="속성">
          {selectedBlock !== null && active !== null ? (
            <FormBlockPanel
              page={active}
              block={selectedBlock}
              collections={collections}
              onChange={(next) => commit(next)}
              onDuplicate={duplicateSelected}
              onRemove={() => { commit(removeBlockFromPage(active, selectedBlock.id)); setSelectedId(null); }}
            />
          ) : selected !== null && selected.kind === "core.output.detail" && active !== null ? (
            <DetailPanel
              component={selected}
              collections={collections}
              onChangeProps={(props) => commit(updateComponentProps(active, selected.id, props))}
              onRemove={() => { commit(removeComponent(active, selected.id)); setSelectedId(null); }}
            />
          ) : selected !== null && selected.kind === "core.input.adaptive" && active !== null ? (
            <AdaptivePanel
              component={selected}
              onChangeProps={(props) => commit(updateComponentProps(active, selected.id, props))}
              onRemove={() => { commit(removeComponent(active, selected.id)); setSelectedId(null); }}
            />
          ) : selected !== null && selected.kind === "core.output.table" && active !== null ? (
            <TablePanel
              component={selected}
              collectionId={tableCollectionId}
              collections={collections}
              onChangeProps={(props) => commit(updateComponentProps(active, selected.id, props))}
              onRemove={() => { commit(removeComponent(active, selected.id)); setSelectedId(null); }}
            />
          ) : selected !== null && selected.kind === "core.form" && active !== null ? (
            <FormPanel
              component={selected}
              collections={collections}
              onChangeProps={(props) => commit(updateComponentProps(active, selected.id, props))}
              onRemove={() => { commit(removeComponent(active, selected.id)); setSelectedId(null); }}
            />
          ) : selected !== null && selected.kind === "core.button" && active !== null ? (
            <ButtonPanel
              component={selected}
              pages={composedPages}
              page={active}
              collections={collections}
              onChangeProps={(props) => commit(updateComponentProps(active, selected.id, props))}
              onChangeEvents={(events) => commit(updateComponentEvents(active, selected.id, events))}
              onRemove={() => { commit(removeComponent(active, selected.id)); setSelectedId(null); }}
            />
          ) : selected !== null ? (
            <div className={styles.inspectorBody}>
              <h4>{selected.kind}</h4>
              <code>{selected.id}</code>
              <label className={styles.inspectorField}>
                <span>Label</span>
                <input
                  value={typeof selected.props["label"] === "string" ? selected.props["label"] : ""}
                  onChange={(event) => active !== null && commit(updateComponentProps(active, selected.id, { ...selected.props, label: event.target.value }))}
                />
              </label>
              <Button size="small" variant="secondary" onPress={() => { if (active !== null) { commit(removeComponent(active, selected.id)); setSelectedId(null); } }}>Component 제거</Button>
            </div>
          ) : active !== null ? (
            <div className={styles.inspectorBody}>
              <h4>화면 설정</h4>
              <label className={styles.inspectorField}><span>화면번호</span><input value={active.screenNo} onChange={(event) => patchActiveMeta({ screenNo: event.target.value })} /></label>
              <label className={styles.inspectorField}><span>화면명</span><input value={active.title} onChange={(event) => patchActiveMeta({ title: event.target.value })} /></label>
              <label className={styles.inspectorField}><span>메뉴명</span><input value={active.menuLabel} onChange={(event) => patchActiveMeta({ menuLabel: event.target.value })} /></label>
              <div className={styles.inspectorField}>
                <span>화면 순서</span>
                <div className={styles.dataFieldRow}>
                  <Button size="small" variant="secondary" onPress={() => moveScreen(-1)} isDisabled={composedPages.findIndex((p) => p.id === active.id) <= 0}>↑ 위로</Button>
                  <Button size="small" variant="secondary" onPress={() => moveScreen(1)} isDisabled={composedPages.findIndex((p) => p.id === active.id) >= composedPages.length - 1}>↓ 아래로</Button>
                </div>
              </div>
              <Button size="small" variant="secondary" onPress={removeScreen} isDisabled={composedPages.length <= 1}>이 화면 삭제</Button>
              <RolePreview page={active} collections={collections} />
              <p className={styles.inspectorEmpty}>Component를 선택하면 속성을 편집합니다.</p>
            </div>
          ) : (
            <p className={styles.inspectorEmpty}>Component를 선택하세요.</p>
          )}
        </aside>
      </div>
      {previewOpen ? (
        <PreviewModal
          manifest={manifest}
          collections={collections}
          initialPageId={active?.id ?? ""}
          schemaRevisionId={null}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * "Preset에서 시작" and "Generated Page 복제" entry points. Presets and the
 * converter are pure templates that produce the same Composed Page contract as
 * hand-built screens, so the author can freely edit the result afterwards.
 */
function PresetMenu({ collections, generatedPages, onPreset, onConvert }: {
  readonly collections: readonly CollectionSummaryDto[];
  readonly generatedPages: readonly { readonly id: string; readonly type: string }[];
  readonly onPreset: (kind: "searchList" | "masterDetail" | "viewEdit", collectionId: string) => void;
  readonly onConvert: (pageId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [collectionId, setCollectionId] = useState("");
  const activeCollection = collectionId !== "" ? collectionId : collections[0]?.id ?? "";

  if (!open) {
    return <Button size="small" variant="secondary" onPress={() => setOpen(true)}>+ Preset에서</Button>;
  }
  return (
    <div className={styles.presetMenu} role="group" aria-label="Preset에서 화면 추가">
      <select value={activeCollection} onChange={(event) => setCollectionId(event.target.value)} aria-label="Preset Collection">
        {collections.length === 0 ? <option value="">Collection 없음</option>
          : collections.map((entry) => <option key={entry.id} value={entry.id}>{entry.label ?? entry.name}</option>)}
      </select>
      <Button size="small" variant="secondary" onPress={() => { if (activeCollection !== "") onPreset("searchList", activeCollection); setOpen(false); }}>검색+목록</Button>
      <Button size="small" variant="secondary" onPress={() => { if (activeCollection !== "") onPreset("masterDetail", activeCollection); setOpen(false); }}>master·detail</Button>
      <Button size="small" variant="secondary" onPress={() => { if (activeCollection !== "") onPreset("viewEdit", activeCollection); setOpen(false); }}>조회+수정</Button>
      {generatedPages.length > 0 ? (
        <select
          defaultValue=""
          aria-label="Generated Page 변환"
          onChange={(event) => { if (event.target.value !== "") { onConvert(event.target.value); setOpen(false); } }}
        >
          <option value="">Generated 복제…</option>
          {generatedPages.map((page) => <option key={page.id} value={page.id}>{page.id} ({page.type})</option>)}
        </select>
      ) : null}
      <button type="button" onClick={() => setOpen(false)} aria-label="닫기">✕</button>
    </div>
  );
}

/**
 * Shows the content permissions this screen's Actions require, so an App author
 * can prepare a Role before publishing. The server re-derives the same gate and
 * enforces it — this is a preview, not an authorization decision.
 */
function RolePreview({ page, collections }: {
  readonly page: ComposedPageDefinition;
  readonly collections: readonly CollectionSummaryDto[];
}) {
  const required = useMemo(() => requiredPermissions(page), [page]);
  if (required.length === 0) {
    return <p className={styles.inspectorEmpty}>이 화면의 작업이 요구하는 권한이 없습니다.</p>;
  }
  const collectionName = (id: string | undefined): string => {
    if (id === undefined) return "";
    const collection = collections.find((entry) => entry.id === id);
    return collection?.label ?? collection?.name ?? id;
  };
  return (
    <div className={styles.inspectorField}>
      <span>필요 권한 (Role Preview)</span>
      <ul className={styles.rolePreviewList}>
        {required.map((entry) => (
          <li key={`${entry.permission}:${entry.collectionId ?? ""}`}>
            <code>{entry.permission}</code>
            {entry.collectionId === undefined ? null : <> · {collectionName(entry.collectionId)}</>}
          </li>
        ))}
      </ul>
      <p className={styles.inspectorEmpty}>이 권한을 가진 Role을 대상 Realm에 부여하세요. 서버가 실행 시 다시 검증합니다.</p>
    </div>
  );
}

/** Turns a validator code into a "전산 사용자"-friendly Korean hint (falls back to the raw message). */
/** The component id a validation issue points at on the active page, if any. */
function issueComponentId(
  manifest: AdminAppManifestV2,
  active: ComposedPageDefinition | null,
  issue: { readonly path: readonly (string | number)[] },
): string | null {
  if (active === null) return null;
  const pageIndex = manifest.pages.findIndex((page) => page.id === active.id);
  const [root, pIdx, section, cIdx] = issue.path;
  if (root === "pages" && pIdx === pageIndex && section === "components" && typeof cIdx === "number") {
    return active.components[cIdx]?.id ?? null;
  }
  return null;
}

function friendlyIssue(code: string, message: string): string {
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
function blockCellTone(page: ComposedPageDefinition, componentId: string, pendingLinkBlockId: string | null): "source" | "target" | null {
  const blockId = blockIdOf(componentId);
  if (blockId === null) return null;
  if (pendingLinkBlockId === null) return null;
  if (blockId === pendingLinkBlockId) return "source";
  const blocks = describeBlocks(page);
  const from = blocks.find((block) => block.id === pendingLinkBlockId);
  const to = blocks.find((block) => block.id === blockId);
  return from !== undefined && to !== undefined && canLinkBlocks(from, to, page) ? "target" : null;
}

/** Editor cell body for a component: kind chrome comes in slice 4 (real renderer). */
function BlockPreview({ component }: { readonly component: ComponentDefinition }) {
  const label = typeof component.props["label"] === "string" ? component.props["label"] : component.kind;
  return (
    <div className={styles.componentPreview}>
      <span className={styles.componentKind}>{component.kind.replace("core.", "")}</span>
      <strong>{label}</strong>
    </div>
  );
}

/** Draws a line between each linked pair of blocks, plus the live drag rubber-band. */
function BlockLinkOverlay({ page, pendingLinkBlockId, linkDrag, onUnlink }: {
  readonly page: ComposedPageDefinition;
  readonly pendingLinkBlockId: string | null;
  readonly linkDrag: LinkDragState | null;
  readonly onUnlink: (link: BlockLink) => void;
}) {
  const blocks = describeBlocks(page);
  const anchorOf = (component: ComponentDefinition | undefined) => {
    if (component === undefined) return null;
    const { x, y, width, height } = component.placement;
    return { cx: (x + width / 2) * COLUMN_WIDTH, cy: (y + height / 2) * ROW_HEIGHT };
  };
  const anchor = (blockId: string) => {
    const block = blocks.find((entry) => entry.id === blockId);
    return anchorOf(page.components.find((entry) => entry.id === block?.anchorComponentId));
  };
  const links = blockLinks(page);
  const height = Math.max(baseViewportHeight("16:9"), ...page.components.map((c) => (c.placement.y + c.placement.height) * ROW_HEIGHT));
  // Rubber-band: from the drag source's anchor to the current cursor position.
  const dragFrom = linkDrag === null ? null : anchorOf(page.components.find((c) => c.id === linkDrag.sourceId));
  return (
    <svg className={styles.linkLayer} style={{ width: CANVAS_WIDTH, height }} viewBox={`0 0 ${CANVAS_WIDTH} ${height}`}>
      {links.map((link) => {
        const from = anchor(link.fromBlockId); const to = anchor(link.toBlockId);
        if (from === null || to === null) return null;
        const dim = pendingLinkBlockId !== null && link.fromBlockId !== pendingLinkBlockId && link.toBlockId !== pendingLinkBlockId;
        return (
          <g key={`${link.fromBlockId}->${link.toBlockId}`} className={dim ? styles.linkDimmed : undefined}>
            <line x1={from.cx} y1={from.cy} x2={to.cx} y2={to.cy} className={styles.linkLine} />
            <circle cx={(from.cx + to.cx) / 2} cy={(from.cy + to.cy) / 2} r={9} className={styles.linkHandle}
              onClick={(event) => { event.stopPropagation(); onUnlink(link); }} />
          </g>
        );
      })}
      {dragFrom !== null && linkDrag !== null ? (
        <line
          x1={dragFrom.cx} y1={dragFrom.cy}
          x2={linkDrag.cursor.x} y2={linkDrag.cursor.y}
          className={styles.linkDragLine}
        />
      ) : null}
    </svg>
  );
}

/** Renders the real App shell (menu + 1152 content) at 1440 width, scaled to fit. */
function AppShellFrame({ manifest, activePageId, children }: {
  readonly manifest: AdminAppManifestV2;
  readonly activePageId: string;
  readonly children: (scale: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // Unscaled layout height of the frame (offsetHeight ignores the CSS transform),
  // so the sizer can reserve the correct scaled footprint for scrolling.
  const [frameHeight, setFrameHeight] = useState(baseViewportHeight(manifest.presentation.layoutProfile));
  const profile = manifest.presentation.layoutProfile;
  const menuRight = manifest.presentation.menuPosition === "right";

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      setScale(computeShellScale(width, height, profile));
      if (frameRef.current !== null) setFrameHeight(frameRef.current.offsetHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (frameRef.current !== null) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [profile]);

  return (
    <div className={styles.stageViewport} ref={ref}>
      {/* Sizer reserves the *scaled* footprint so the parent's scrollbars match
          what's actually visible; the frame scales from its top-left corner. */}
      <div className={styles.shellSizer} style={{ width: SHELL_WIDTH * scale, height: frameHeight * scale }}>
        <div
          ref={frameRef}
          className={styles.shellFrame}
          style={{ width: SHELL_WIDTH, minHeight: baseViewportHeight(profile), transform: `scale(${scale})`, transformOrigin: "top left", flexDirection: menuRight ? "row-reverse" : "row" }}
        >
          <nav className={styles.shellMenu} style={{ width: MENU_WIDTH }} aria-hidden="true">
            <div className={styles.shellBrand}>{manifest.name}</div>
            {manifest.navigation.map((item) => (
              <span key={item.id} data-active={item.pageId === activePageId} className={styles.shellNavItem}>{item.label}</span>
            ))}
          </nav>
          <div className={styles.shellContent} style={{ width: CANVAS_WIDTH }}>
            {children(scale)}
          </div>
        </div>
      </div>
    </div>
  );
}

function FullscreenNotice({ title, detail, onBack }: {
  readonly title: string;
  readonly detail: string;
  readonly onBack: () => void;
}) {
  return (
    <div className={styles.notice}>
      <h1>{title}</h1>
      <p>{detail}</p>
      <Button variant="secondary" onPress={onBack}>← 빌더로 돌아가기</Button>
    </div>
  );
}

/** The Collection id of the Data Source whose `rows` feed a table's `data` port. */
function tableSourceCollectionId(page: ComposedPageDefinition, tableId: string): string | undefined {
  const connection = page.connections.find((c) =>
    c.from.nodeType === "data-source" && c.from.portId === "rows"
    && c.to.nodeType === "component" && c.to.nodeId === tableId && c.to.portId === "data");
  if (connection === undefined) return undefined;
  return page.dataSources.find((source) => source.id === connection.from.nodeId)?.collectionId;
}

function uniqueId(preferred: string, used: readonly string[]): string {
  const taken = new Set(used);
  if (!taken.has(preferred)) return preferred;
  let index = 2;
  while (taken.has(`${preferred}-${index}`)) index += 1;
  return `${preferred}-${index}`;
}

function message(error: unknown): string {
  return error instanceof XeCmsApiError ? `${error.message} (${error.code})`
    : error instanceof Error ? error.message : "요청을 처리할 수 없습니다.";
}
