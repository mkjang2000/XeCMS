import { useState } from "react";
import { validateAuthoringSchema, validatePageAuthoring, withPageAuthoring, type ComposedPageDefinition, type PageBlockDefinition } from "@xecms/admin-apps";
import type { CollectionSummaryDto } from "@xecms/client";
import { Button } from "@xecms/ui";
import { BlockInspector } from "./block-inspector.js";
import { addBusinessTemplate, BLOCK_TITLES, newPageBlock, removeAuthoredBlock, replaceBlock } from "./model.js";
import styles from "./block-editor.module.css";

export function BlockEditor({ page, collections, onChange, onRemoveScreen, onMoveScreen, canRemoveScreen, canMoveUp, canMoveDown }: {
  readonly page: ComposedPageDefinition;
  readonly collections: readonly CollectionSummaryDto[];
  readonly onChange: (page: ComposedPageDefinition) => void;
  readonly onRemoveScreen: () => void;
  readonly onMoveScreen: (direction: -1 | 1) => void;
  readonly canRemoveScreen: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}) {
  const blocks = page.authoring?.blocks ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const collection = collections.find((c) => c.id === collectionId);
  const selected = blocks.find((b) => b.id === selectedId);
  const issues = [...validatePageAuthoring({ version: 1, blocks }), ...validateAuthoringSchema({ version: 1, blocks }, collections)];
  return <div className={styles.editor}>
    <aside className={styles.sidebar} aria-label="블록 구성">
      <h3>업무 화면</h3>
      <label>추가할 데이터<select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
        {collections.map((c) => <option key={c.id} value={c.id}>{c.label ?? c.name}</option>)}
      </select></label>
      <Button size="small" isDisabled={collection === undefined || blocks.length > 0} onPress={() => {
        if (collection !== undefined) onChange(addBusinessTemplate(page, collection));
      }}>검색·목록·수정 화면 만들기</Button>
      <p>블록을 고르고 표시할 데이터와 동작을 설정하세요.</p>
      {(Object.keys(BLOCK_TITLES) as PageBlockDefinition["kind"][]).map((kind) => <Button key={kind} size="small" variant="secondary" isDisabled={collection === undefined} onPress={() => {
        if (collection === undefined) return;
        const block = newPageBlock(page, kind, collection);
        onChange(withPageAuthoring(page, { version: 1, blocks: [...blocks, block] })); setSelectedId(block.id);
      }}>+ {BLOCK_TITLES[kind]}</Button>)}
    </aside>
    <main className={styles.main}>
      <div className={styles.screenSettings}>
        <label>화면명<input value={page.title} onChange={(e) => onChange({ ...page, title: e.target.value })} /></label>
        <label>메뉴명<input value={page.menuLabel} onChange={(e) => onChange({ ...page, menuLabel: e.target.value })} /></label>
        <label>화면번호<input value={page.screenNo} onChange={(e) => onChange({ ...page, screenNo: e.target.value })} /></label>
        <Button size="small" variant="secondary" isDisabled={!canMoveUp} onPress={() => onMoveScreen(-1)}>화면 위로</Button>
        <Button size="small" variant="secondary" isDisabled={!canMoveDown} onPress={() => onMoveScreen(1)}>화면 아래로</Button>
        <Button size="small" variant="secondary" isDisabled={!canRemoveScreen} onPress={onRemoveScreen}>화면 삭제</Button>
      </div>
      {issues.length > 0 ? <div role="alert" className={styles.issues}>{issues.map((issue, i) => <p key={i}>{blocks[Number(issue.path[1])]?.title}: {issue.message}</p>)}</div> : null}
      {blocks.length === 0 ? <p>왼쪽에서 업무 화면을 만들거나 블록을 추가하세요.</p> : null}
      <div className={styles.canvas} aria-label="블록 배치" style={{ minHeight: Math.max(320, ...blocks.map((b) => (b.placement.y + b.placement.height) * 8)) }}>
        {blocks.map((block) => <button key={block.id} type="button" className={styles.block} aria-pressed={selectedId === block.id}
          style={{ gridColumn: `${Math.max(1, block.placement.x + 1)} / span ${Math.max(1, block.placement.width)}`, gridRow: `${Math.max(1, block.placement.y + 1)} / span ${Math.max(1, block.placement.height)}` }}
          onClick={() => setSelectedId(block.id)}>
          <strong>{block.title}</strong><span>{BLOCK_TITLES[block.kind]}</span>
          {"fields" in block ? <small>{block.fields.map((f) => f.label).join(" · ")}</small> : null}
          {"input" in block && block.input !== undefined ? <small>← {blocks.find((b) => b.id === block.input?.blockId)?.title ?? "연결 확인 필요"}</small> : null}
        </button>)}
      </div>
    </main>
    <aside className={styles.sidebar} aria-label="블록 설정">
      {selected === undefined ? <p>블록을 선택하면 데이터·연결·배치를 설정할 수 있습니다.</p> : <>
        <h3>{selected.title}</h3>
        <BlockInspector block={selected} blocks={blocks} collections={collections} onChange={(block) => onChange(replaceBlock(page, block))} />
        <Button variant="secondary" size="small" onPress={() => { onChange(removeAuthoredBlock(page, selected.id)); setSelectedId(null); }}>블록 삭제</Button>
      </>}
    </aside>
  </div>;
}
