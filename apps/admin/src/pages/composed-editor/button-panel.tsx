import { Button } from "@xecms/ui";
import type {
  ComponentDefinition,
  ComposedEffectDefinition,
  ComposedPageDefinition,
  ComposedPageEventBinding,
} from "@xecms/admin-apps";

import styles from "./composed-editor.module.css";

type EffectKind = ComposedEffectDefinition["kind"];

const EFFECT_KINDS: readonly { readonly kind: EffectKind; readonly label: string }[] = [
  { kind: "navigate", label: "화면 이동" },
  { kind: "data-source.execute", label: "Data Source 실행" },
  { kind: "data-source.reset", label: "Data Source 초기화" },
  { kind: "state.reset", label: "State 초기화" },
  { kind: "action.execute", label: "작업 실행(생성/수정/삭제)" },
];

const ACTION_IDS: readonly { readonly id: string; readonly label: string }[] = [
  { id: "core.action.create", label: "생성" },
  { id: "core.action.update", label: "수정" },
  { id: "core.action.delete", label: "삭제" },
];

export interface ButtonPanelProps {
  readonly component: ComponentDefinition;
  /** All pages, so a navigate effect can target another screen. */
  readonly pages: readonly ComposedPageDefinition[];
  readonly page: ComposedPageDefinition;
  readonly collections: readonly { readonly id: string; readonly name: string }[];
  readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
  readonly onChangeEvents: (events: readonly ComposedPageEventBinding[]) => void;
  readonly onRemove: () => void;
}

/**
 * Inspector for a `core.button`. Edits its Label and the onClick effect chain
 * (CPB-7). The chain runs in order at runtime; the delete action is gated by the
 * server's access profile and re-checked by the content API, so nothing edited
 * here can grant a permission the actor does not already hold.
 */
export function ButtonPanel({ component, pages, page, collections, onChangeProps, onChangeEvents, onRemove }: ButtonPanelProps) {
  const label = typeof component.props["label"] === "string" ? component.props["label"] : "";
  const onClick = (component.events ?? []).find((binding) => binding.event === "onClick");
  const effects = onClick?.effects ?? [];
  const documentStates = page.state.filter((state) => state.valueType === "document-id");
  const formComponents = page.components.filter((entry) => entry.kind === "core.form");

  const setEffects = (next: readonly ComposedEffectDefinition[]): void => {
    const others = (component.events ?? []).filter((binding) => binding.event !== "onClick");
    if (next.length === 0) {
      onChangeEvents(others);
      return;
    }
    const binding: ComposedPageEventBinding = { id: onClick?.id ?? "evt_onclick", event: "onClick", effects: next };
    onChangeEvents([...others, binding]);
  };

  const addEffect = (): void => {
    const id = `fx_${effects.length + 1}`;
    setEffects([...effects, { id, kind: "navigate", args: {} }]);
  };

  const patchEffect = (id: string, patch: Partial<ComposedEffectDefinition>): void => {
    setEffects(effects.map((effect) => (effect.id === id ? { ...effect, ...patch } : effect)));
  };

  const patchArgs = (id: string, args: Readonly<Record<string, unknown>>): void => {
    setEffects(effects.map((effect) => (effect.id === id ? { ...effect, args: { ...effect.args, ...args } } : effect)));
  };

  const removeEffect = (id: string): void => setEffects(effects.filter((effect) => effect.id !== id));

  return (
    <div className={styles.dataForm}>
      <h4>버튼 {component.id}</h4>
      <label className={styles.dataField}>
        <span>Label</span>
        <input value={label} onChange={(event) => onChangeProps({ ...component.props, label: event.target.value })} />
      </label>

      <div className={styles.dataField}>
        <span>클릭 시 동작</span>
        <p className={styles.inspectorEmpty}>위에서 아래 순서로 실행됩니다. 실패하면 거기서 멈춥니다.</p>
        {effects.map((effect) => (
          <div key={effect.id} className={styles.dataField} style={{ borderTop: "1px solid var(--xe-color-border,#eee)", paddingTop: "0.4rem" }}>
            <select value={effect.kind} onChange={(event) => patchEffect(effect.id, { kind: event.target.value as EffectKind, args: {} })}>
              {EFFECT_KINDS.map((entry) => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}
            </select>

            {effect.kind === "navigate" ? (
              <select value={stringArg(effect, "pageId")} onChange={(event) => patchArgs(effect.id, { pageId: event.target.value })}>
                <option value="">화면 선택…</option>
                {pages.map((target) => <option key={target.id} value={target.id}>{target.menuLabel || target.title || target.id}</option>)}
              </select>
            ) : effect.kind === "data-source.execute" || effect.kind === "data-source.reset" ? (
              <select value={stringArg(effect, "dataSourceId")} onChange={(event) => patchArgs(effect.id, { dataSourceId: event.target.value })}>
                <option value="">Data Source 선택…</option>
                {page.dataSources.map((source) => <option key={source.id} value={source.id}>{source.id}</option>)}
              </select>
            ) : effect.kind === "state.reset" ? (
              <select value={stringArg(effect, "stateId")} onChange={(event) => patchArgs(effect.id, { stateId: event.target.value })}>
                <option value="">State 선택…</option>
                {page.state.map((state) => <option key={state.id} value={state.id}>{state.id}</option>)}
              </select>
            ) : effect.kind === "action.execute" ? (
              <>
                <select value={stringArg(effect, "actionId")} onChange={(event) => patchArgs(effect.id, { actionId: event.target.value })}>
                  <option value="">작업 선택…</option>
                  {ACTION_IDS.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}
                </select>
                <select value={stringArg(effect, "collectionId")} onChange={(event) => patchArgs(effect.id, { collectionId: event.target.value })}>
                  <option value="">컬렉션 선택…</option>
                  {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
                </select>
                {stringArg(effect, "actionId") === "core.action.create" || stringArg(effect, "actionId") === "core.action.update" ? (
                  <select value={stringArg(effect, "formComponentId")} onChange={(event) => patchArgs(effect.id, { formComponentId: event.target.value })}>
                    <option value="">입력 폼 선택…</option>
                    {formComponents.map((form) => <option key={form.id} value={form.id}>{typeof form.props["label"] === "string" ? `${form.props["label"]} (${form.id})` : form.id}</option>)}
                  </select>
                ) : null}
                {stringArg(effect, "actionId") === "core.action.update" || stringArg(effect, "actionId") === "core.action.delete" ? (
                  <select value={stringArg(effect, "documentStateId")} onChange={(event) => patchArgs(effect.id, { documentStateId: event.target.value })}>
                    <option value="">대상 State(document-id) 선택…</option>
                    {documentStates.map((state) => <option key={state.id} value={state.id}>{state.id}</option>)}
                  </select>
                ) : null}
                {stringArg(effect, "actionId") === "core.action.delete" ? (
                  <input placeholder="확인 문구" value={stringArg(effect, "confirm")} onChange={(event) => patchArgs(effect.id, { confirm: event.target.value })} />
                ) : null}
                <p className={styles.inspectorEmpty}>작업 권한은 서버에서 다시 검증됩니다.</p>
              </>
            ) : null}

            <button type="button" onClick={() => removeEffect(effect.id)}>동작 제거</button>
          </div>
        ))}
        <Button size="small" variant="secondary" onPress={addEffect}>+ 동작</Button>
      </div>

      <Button size="small" variant="secondary" onPress={onRemove}>Component 제거</Button>
    </div>
  );
}

function stringArg(effect: ComposedEffectDefinition, key: string): string {
  const value = effect.args?.[key];
  return typeof value === "string" ? value : "";
}
