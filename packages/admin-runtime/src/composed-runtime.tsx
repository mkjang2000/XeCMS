import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ComposedEffectDefinition, ComposedPageDefinition } from "@xecms/admin-apps";
import type { ComposedQueryRowDto } from "@xecms/contracts";

import type { ComponentDefinition } from "@xecms/admin-apps";
import type { ComposedDocumentDto } from "@xecms/contracts";

import type { AdminRuntimeDataClient } from "./api.js";
import { evaluateCondition, planEffect, type EffectContext } from "./composed-effects.js";
import {
  allVariantStatesFor,
  buildWiringGraph,
  collectParameters,
  dataSourcesExecutedBy,
  documentIdStateFor,
  onChangeDataSourcesForState,
  onLoadDataSources,
  rowsSourceFor,
  selectedDocumentStatesFor,
  selectedFieldStatesFor,
  statesWrittenBy,
  variantStatesFor,
} from "./composed-wiring.js";

export interface DataSourceState {
  readonly status: "idle" | "loading" | "success" | "error";
  readonly rows: readonly ComposedQueryRowDto[];
  readonly error?: string;
  readonly hasNextPage: boolean;
  readonly nextCursor?: string;
}

export interface DetailState {
  readonly status: "empty" | "loading" | "success" | "error";
  readonly document?: ComposedDocumentDto | null;
  readonly error?: string;
}

/** Result of an aggregate Data Source (slG1): grouped {group, value} rows. */
export interface AggregateState {
  readonly status: "idle" | "loading" | "success" | "error";
  readonly groups: readonly { readonly group: string | number | boolean | null; readonly value: number }[];
  readonly truncated: boolean;
  readonly error?: string;
}

export interface ActionState {
  readonly status: "idle" | "running" | "success" | "error";
  readonly message?: string;
}

const IDLE: DataSourceState = { status: "idle", rows: [], hasNextPage: false };
const IDLE_AGGREGATE: AggregateState = { status: "idle", groups: [], truncated: false };

export interface ComposedRuntimeContextValue {
  readonly stateValue: (stateId: string) => unknown;
  readonly setInputValue: (componentId: string, value: unknown) => void;
  readonly runFromComponent: (componentId: string) => void;
  readonly dataSourceForOutput: (componentId: string) => DataSourceState | undefined;
  /** Aggregate result (slG1) of the Data Source feeding a chart/summary output. */
  readonly aggregateForOutput: (componentId: string) => AggregateState | undefined;
  readonly nextPage: (componentId: string) => void;
  /**
   * Records a table row selection into connected state: the document id (master →
   * detail) and any `selectedField:<fieldId>` values (cross-schema lookup).
   */
  readonly selectRow: (componentId: string, row: { readonly id: string; readonly data: Readonly<Record<string, unknown>> }) => void;
  /**
   * Writes an adaptive input's active-variant value and clears every other
   * variant's state, so an inactive variant's value never reaches the query.
   */
  readonly setAdaptiveValue: (componentId: string, variantId: string, value: unknown) => void;
  /** The document id currently selected by a table component, if any. */
  readonly selectedRowId: (componentId: string) => string | undefined;
  /** Detail state (fetched document) for a detail component bound to a state. */
  readonly detailForComponent: (component: ComponentDefinition) => DetailState;
  /** Resolves a stable Field id (fld_*) to the row-data key (Field name). */
  readonly fieldName: (fieldId: string) => string | undefined;
  /** Resolves a stable Field id (fld_*) to its Schema type (for formatting). */
  readonly fieldType: (fieldId: string) => string | undefined;
  /** Runs the effect chain bound to a component's event (e.g. onClick). */
  readonly runComponentEvent: (componentId: string, event: string) => void;
  /** Whether an Action id is permitted for this page (access profile gate). */
  readonly canRunAction: (actionId: string) => boolean;
  /** Current Action feedback state (running/success/error). */
  readonly actionState: ActionState;
  /** Writes one field of a form component's collected data. */
  readonly setFormFieldValue: (componentId: string, fieldName: string, value: unknown) => void;
  /** The current value of a form field (for controlled inputs). */
  readonly formFieldValue: (componentId: string, fieldName: string) => unknown;
  /** Resolves a registered trusted Plugin Component renderer by kind, if any. */
  readonly pluginComponent: (kind: string) => PluginComponentRenderer | undefined;
}

/** A trusted Plugin Component renderer, registered by its namespaced kind. */
export type PluginComponentRenderer = (props: { readonly component: ComponentDefinition }) => React.ReactNode;

/** kind (`<plugin>.output.chart`) -> renderer, supplied by the host at runtime. */
export type PluginComponentRegistry = ReadonlyMap<string, PluginComponentRenderer>;

const ComposedRuntimeContext = createContext<ComposedRuntimeContextValue | null>(null);

export function useComposedRuntime(): ComposedRuntimeContextValue {
  const value = useContext(ComposedRuntimeContext);
  if (value === null) throw new Error("useComposedRuntime must be used within a ComposedRuntimeProvider.");
  return value;
}

/** Drives Page State, connection execution, and Data Source results at runtime. */
export function ComposedRuntimeProvider({ page, client, fieldNames, fieldTypes, navigate, access, plugins, children }: {
  readonly page: ComposedPageDefinition;
  readonly client: Pick<AdminRuntimeDataClient, "queryComposed" | "aggregateComposed" | "getComposedDocument" | "get" | "delete" | "create" | "update">;
  /** fieldId (fld_*) -> Field name, used to read masked row data by column fieldId. */
  readonly fieldNames: ReadonlyMap<string, string>;
  /** fieldId (fld_*) -> Schema type, used to pick a default output format. */
  readonly fieldTypes?: ReadonlyMap<string, string>;
  /** Navigate to another page within the App (for the `navigate` effect). */
  readonly navigate?: (pageId: string) => void;
  /** access.actions map (`<pageId>:<actionId>` -> allowed) for gating actions. */
  readonly access?: Readonly<Record<string, boolean>>;
  /** Trusted Plugin Component renderers, keyed by namespaced kind. */
  readonly plugins?: PluginComponentRegistry;
  readonly children: React.ReactNode;
}) {
  const graph = useMemo(() => buildWiringGraph(page), [page]);
  const [state, setState] = useState<ReadonlyMap<string, unknown>>(
    () => new Map(page.state.map((entry) => [entry.id, entry.initialValue])),
  );
  const [sources, setSources] = useState<ReadonlyMap<string, DataSourceState>>(new Map());
  const [aggregates, setAggregates] = useState<ReadonlyMap<string, AggregateState>>(new Map());
  const [details, setDetails] = useState<ReadonlyMap<string, DetailState>>(new Map());
  const [actionState, setActionState] = useState<ActionState>({ status: "idle" });
  // Form components collect their own field values (componentId -> {fieldName: value}).
  const [forms, setForms] = useState<ReadonlyMap<string, ReadonlyMap<string, unknown>>>(new Map());
  const formsRef = useRef(forms);
  formsRef.current = forms;
  const stateRef = useRef(state);
  stateRef.current = state;
  const runningAction = useRef(false);
  const aborts = useRef(new Map<string, AbortController>());
  const debounces = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const detailAborts = useRef(new Map<string, AbortController>());

  // Data Sources with an `aggregate` return grouped {group,value}, not rows.
  const aggregateSourceIds = useMemo(
    () => new Set(page.dataSources.filter((source) => source.aggregate !== undefined).map((source) => source.id)),
    [page.dataSources],
  );

  const executeAggregate = useCallback((dataSourceId: string): void => {
    aborts.current.get(dataSourceId)?.abort();
    const controller = new AbortController();
    aborts.current.set(dataSourceId, controller);
    const parameters = collectParameters(graph, dataSourceId, stateRef.current);
    setAggregates((prev) => new Map(prev).set(dataSourceId, { ...(prev.get(dataSourceId) ?? IDLE_AGGREGATE), status: "loading" }));
    void client.aggregateComposed(page.id, dataSourceId, {
      parameters: parameters as Readonly<Record<string, never>>,
    }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setAggregates((prev) => new Map(prev).set(dataSourceId, {
        status: "success", groups: result.groups, truncated: result.truncated,
      }));
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setAggregates((prev) => new Map(prev).set(dataSourceId, {
        status: "error", groups: [], truncated: false,
        error: error instanceof Error ? error.message : "집계에 실패했습니다.",
      }));
    });
  }, [client, graph, page.id]);

  const execute = useCallback((dataSourceId: string, cursor?: string): void => {
    if (aggregateSourceIds.has(dataSourceId)) { executeAggregate(dataSourceId); return; }
    aborts.current.get(dataSourceId)?.abort();
    const controller = new AbortController();
    aborts.current.set(dataSourceId, controller);
    const parameters = collectParameters(graph, dataSourceId, stateRef.current);
    setSources((prev) => new Map(prev).set(dataSourceId, { ...(prev.get(dataSourceId) ?? IDLE), status: "loading" }));
    void client.queryComposed(page.id, dataSourceId, {
      parameters: parameters as Readonly<Record<string, never>>,
      ...(cursor === undefined ? {} : { cursor }),
    }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setSources((prev) => new Map(prev).set(dataSourceId, {
        status: "success",
        rows: result.items,
        hasNextPage: result.hasNextPage,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
      }));
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setSources((prev) => new Map(prev).set(dataSourceId, {
        status: "error", rows: [], hasNextPage: false,
        error: error instanceof Error ? error.message : "조회에 실패했습니다.",
      }));
    });
  }, [client, graph, page.id, aggregateSourceIds, executeAggregate]);

  /**
   * Runs a Data Source and resolves with its rows — used by the `await-query`
   * effect so a following condition can branch on the result (CPB-WF). It also
   * stores the result in `sources` (like {@link execute}) so any bound output
   * updates. Errors resolve to an empty result (the chain fails closed).
   */
  const executeAndGet = useCallback(async (dataSourceId: string): Promise<readonly ComposedQueryRowDto[]> => {
    aborts.current.get(dataSourceId)?.abort();
    const controller = new AbortController();
    aborts.current.set(dataSourceId, controller);
    const parameters = collectParameters(graph, dataSourceId, stateRef.current);
    setSources((prev) => new Map(prev).set(dataSourceId, { ...(prev.get(dataSourceId) ?? IDLE), status: "loading" }));
    try {
      const result = await client.queryComposed(page.id, dataSourceId, {
        parameters: parameters as Readonly<Record<string, never>>,
      }, controller.signal);
      if (controller.signal.aborted) return [];
      setSources((prev) => new Map(prev).set(dataSourceId, {
        status: "success", rows: result.items, hasNextPage: result.hasNextPage,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
      }));
      return result.items;
    } catch (error: unknown) {
      if (controller.signal.aborted) return [];
      setSources((prev) => new Map(prev).set(dataSourceId, {
        status: "error", rows: [], hasNextPage: false,
        error: error instanceof Error ? error.message : "조회에 실패했습니다.",
      }));
      return [];
    }
  }, [client, graph, page.id]);

  // on-load Data Sources run once on mount.
  useEffect(() => {
    const timers = debounces.current;
    for (const dataSourceId of onLoadDataSources(page)) execute(dataSourceId);
    const detailControllers = detailAborts.current;
    return () => {
      for (const controller of aborts.current.values()) controller.abort();
      for (const controller of detailControllers.values()) controller.abort();
      for (const timer of timers.values()) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const setInputValue = useCallback((componentId: string, value: unknown): void => {
    const writtenStates = statesWrittenBy(graph, componentId);
    setState((prev) => {
      const next = new Map(prev);
      for (const stateId of writtenStates) next.set(stateId, value);
      return next;
    });
    // Re-run on-change Data Sources bound to the changed states, debounced.
    for (const stateId of writtenStates) {
      for (const { id, debounceMs } of onChangeDataSourcesForState(page, graph, stateId)) {
        const existing = debounces.current.get(id);
        if (existing !== undefined) clearTimeout(existing);
        debounces.current.set(id, setTimeout(() => { debounces.current.delete(id); execute(id); }, debounceMs));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, page, execute]);

  const runFromComponent = useCallback((componentId: string): void => {
    for (const dataSourceId of dataSourcesExecutedBy(graph, componentId)) execute(dataSourceId);
  }, [graph, execute]);

  const selectRow = useCallback((componentId: string, row: { readonly id: string; readonly data: Readonly<Record<string, unknown>> }): void => {
    const docTargets = selectedDocumentStatesFor(graph, componentId);
    const fieldTargets = selectedFieldStatesFor(graph, componentId);
    if (docTargets.length === 0 && fieldTargets.size === 0) return;
    setState((prev) => {
      const next = new Map(prev);
      for (const stateId of docTargets) next.set(stateId, row.id);
      // Cross-schema: write each wired field's value from the selected row.
      for (const [fieldId, stateIds] of fieldTargets) {
        const name = fieldNames.get(fieldId);
        const value = name === undefined ? undefined : row.data[name];
        for (const stateId of stateIds) next.set(stateId, value ?? "");
      }
      return next;
    });
    // A selection that feeds parameters should re-run those on-change data sources.
    for (const stateIds of fieldTargets.values()) {
      for (const stateId of stateIds) {
        for (const { id, debounceMs } of onChangeDataSourcesForState(page, graph, stateId)) {
          const existing = debounces.current.get(id);
          if (existing !== undefined) clearTimeout(existing);
          debounces.current.set(id, setTimeout(() => { debounces.current.delete(id); execute(id); }, debounceMs));
        }
      }
    }
  }, [graph, fieldNames, page, execute]);

  const setAdaptiveValue = useCallback((componentId: string, variantId: string, value: unknown): void => {
    const active = new Set(variantStatesFor(graph, componentId, variantId));
    setState((prev) => {
      const next = new Map(prev);
      // Clear every variant's state first, then set only the active variant's.
      for (const stateId of allVariantStatesFor(graph, componentId)) {
        next.set(stateId, active.has(stateId) ? value : "");
      }
      return next;
    });
  }, [graph]);

  const setFormFieldValue = useCallback((componentId: string, fieldName: string, value: unknown): void => {
    setForms((prev) => {
      const next = new Map(prev);
      const fields = new Map(prev.get(componentId) ?? []);
      fields.set(fieldName, value);
      next.set(componentId, fields);
      return next;
    });
  }, []);

  const formFieldValue = useCallback((componentId: string, fieldName: string): unknown => {
    return forms.get(componentId)?.get(fieldName);
  }, [forms]);

  const canRunAction = useCallback((actionId: string): boolean => {
    return access?.[`${page.id}:${actionId}`] === true;
  }, [access, page.id]);

  /**
   * Runs an ordered effect chain (button onClick, etc.). Stops on the first
   * failure. The `action.execute` effect performs a real mutation via the
   * content API, which re-checks the permission server-side — the Manifest
   * cannot forge authorization; access.actions here is only a UX gate.
   */
  const runEffects = useCallback(async (effects: readonly ComposedEffectDefinition[]): Promise<void> => {
    if (runningAction.current) return;
    const context: EffectContext = {
      stateValue: (stateId) => stateRef.current.get(stateId),
      canRunAction,
      fieldName: (fieldId) => fieldNames.get(fieldId),
    };
    // Row count of the last `await-query` in this chain, for `queryResult` guards.
    let lastQueryRowCount: number | undefined;
    for (const effect of effects) {
      // Declarative guard (CPB-WF): skip the effect when its condition is false.
      if (effect.when !== undefined && !evaluateCondition(effect.when, {
        stateValue: (stateId) => stateRef.current.get(stateId),
        lastQueryRowCount,
      })) continue;
      const plan = planEffect(effect, context);
      switch (plan.kind) {
        case "state.set":
          setState((prev) => new Map(prev).set(plan.stateId, plan.value));
          break;
        case "state.reset":
          setState((prev) => new Map(prev).set(plan.stateId, ""));
          break;
        case "data-source.execute":
          execute(plan.dataSourceId);
          break;
        case "data-source.reset":
          setSources((prev) => new Map(prev).set(plan.dataSourceId, IDLE));
          break;
        case "await-query": {
          // Wait for the result so a following condition can branch on it.
          const rows = await executeAndGet(plan.dataSourceId);
          lastQueryRowCount = rows.length;
          break;
        }
        case "navigate":
          navigate?.(plan.pageId);
          break;
        case "action.denied":
          setActionState({ status: "error", message: "이 작업을 실행할 권한이 없습니다." });
          return; // denied stops the chain.
        case "action.invalid":
          setActionState({ status: "error", message: plan.reason });
          return;
        case "action.delete": {
          const ok = await runDelete(plan.collectionId, plan.documentId, plan.confirm);
          if (!ok) return; // failure/cancel stops the chain.
          break;
        }
        case "action.create": {
          const ok = await runCreate(plan.collectionId, plan.formComponentId);
          if (!ok) return;
          break;
        }
        case "action.update": {
          const ok = await runUpdate(plan.collectionId, plan.documentId, plan.formComponentId);
          if (!ok) return;
          break;
        }
        case "form.setField":
          setFormFieldValue(plan.formComponentId, plan.fieldName, plan.value);
          break;
        case "action.updateFields": {
          const ok = await runUpdateFields(plan.collectionId, plan.documentId, plan.fields);
          if (!ok) return;
          break;
        }
        case "noop":
          break;
      }
    }
  }, [execute, executeAndGet, navigate, canRunAction, fieldNames]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Executes the delete Action through the content API (which re-checks the permission). */
  const runDelete = useCallback(async (collectionId: string, documentId: string, confirmMessage: string): Promise<boolean> => {
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) return false;
    runningAction.current = true;
    setActionState({ status: "running" });
    try {
      // A forged Manifest cannot bypass this — content.delete is enforced server-side.
      const document = await client.get(collectionId, documentId);
      await client.delete(collectionId, documentId, document.version);
      setActionState({ status: "success", message: "삭제되었습니다." });
      return true;
    } catch (error: unknown) {
      setActionState({ status: "error", message: error instanceof Error ? error.message : "작업에 실패했습니다." });
      return false;
    } finally {
      runningAction.current = false;
    }
  }, [client]);

  /** Collected form data as a plain object, dropping empty-string fields. */
  const collectFormData = useCallback((formComponentId: string): Record<string, unknown> => {
    const fields = formsRef.current.get(formComponentId) ?? new Map<string, unknown>();
    const data: Record<string, unknown> = {};
    for (const [name, value] of fields) {
      if (value === "" || value === undefined) continue;
      data[name] = value;
    }
    return data;
  }, []);

  /** Creates a document from a form component's collected data via the content API. */
  const runCreate = useCallback(async (collectionId: string, formComponentId: string): Promise<boolean> => {
    runningAction.current = true;
    setActionState({ status: "running" });
    try {
      // content.create is enforced server-side; the Manifest cannot forge it.
      await client.create(collectionId, collectFormData(formComponentId));
      setForms((prev) => { const next = new Map(prev); next.delete(formComponentId); return next; });
      setActionState({ status: "success", message: "생성되었습니다." });
      return true;
    } catch (error: unknown) {
      setActionState({ status: "error", message: error instanceof Error ? error.message : "작업에 실패했습니다." });
      return false;
    } finally {
      runningAction.current = false;
    }
  }, [client, collectFormData]);

  /** Updates the selected document from a form component's data (re-reads version first). */
  const runUpdate = useCallback(async (collectionId: string, documentId: string, formComponentId: string): Promise<boolean> => {
    runningAction.current = true;
    setActionState({ status: "running" });
    try {
      // content.update is enforced server-side; the current version guards against stale writes.
      const document = await client.get(collectionId, documentId);
      await client.update(collectionId, documentId, collectFormData(formComponentId), document.version);
      setActionState({ status: "success", message: "저장되었습니다." });
      return true;
    } catch (error: unknown) {
      setActionState({ status: "error", message: error instanceof Error ? error.message : "작업에 실패했습니다." });
      return false;
    } finally {
      runningAction.current = false;
    }
  }, [client, collectFormData]);

  /**
   * Partial update (CPB-WF 슬2): re-reads the record, merges only the named fields
   * onto its current data, and writes back. Used for 반납/연장/상태변경 where only a
   * couple of fields change. content.update is enforced server-side.
   */
  const runUpdateFields = useCallback(async (
    collectionId: string,
    documentId: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<boolean> => {
    runningAction.current = true;
    setActionState({ status: "running" });
    try {
      const document = await client.get(collectionId, documentId);
      await client.update(collectionId, documentId, { ...document.data, ...fields }, document.version);
      setActionState({ status: "success", message: "처리되었습니다." });
      return true;
    } catch (error: unknown) {
      setActionState({ status: "error", message: error instanceof Error ? error.message : "작업에 실패했습니다." });
      return false;
    } finally {
      runningAction.current = false;
    }
  }, [client]);

  const runComponentEvent = useCallback((componentId: string, event: string): void => {
    const component = page.components.find(({ id }) => id === componentId);
    const binding = component?.events?.find((entry) => entry.event === event);
    if (binding === undefined) return;
    void runEffects(binding.effects);
  }, [page.components, runEffects]);

  /** Fetches the document a detail Component points at via its bound state. */
  const fetchDetail = useCallback((component: ComponentDefinition): void => {
    const stateId = documentIdStateFor(graph, component.id);
    const documentId = stateId === undefined ? undefined : stateRef.current.get(stateId);
    const collectionId = component.props["collectionId"];
    if (typeof documentId !== "string" || typeof collectionId !== "string") {
      setDetails((prev) => new Map(prev).set(component.id, { status: "empty" }));
      return;
    }
    detailAborts.current.get(component.id)?.abort();
    const controller = new AbortController();
    detailAborts.current.set(component.id, controller);
    setDetails((prev) => new Map(prev).set(component.id, { status: "loading" }));
    void client.getComposedDocument(page.id, component.id, { documentId, collectionId }, controller.signal)
      .then((document) => {
        if (controller.signal.aborted) return;
        setDetails((prev) => new Map(prev).set(component.id, { status: "success", document }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDetails((prev) => new Map(prev).set(component.id, {
          status: "error", error: error instanceof Error ? error.message : "조회에 실패했습니다.",
        }));
      });
  }, [client, graph, page.id]);

  // Re-fetch each detail Component whenever its bound documentId state changes.
  const detailComponents = useMemo(
    () => page.components.filter((component) => component.kind === "core.output.detail"),
    [page.components],
  );
  useEffect(() => {
    for (const component of detailComponents) {
      const stateId = documentIdStateFor(graph, component.id);
      if (stateId === undefined) continue;
      fetchDetail(component);
    }
    // Depend on the bound state values so a new selection re-fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailComponents.map((c) => `${c.id}:${String(state.get(documentIdStateFor(graph, c.id) ?? ""))}`).join("|")]);

  const value = useMemo<ComposedRuntimeContextValue>(() => ({
    stateValue: (stateId) => state.get(stateId),
    setInputValue,
    runFromComponent,
    dataSourceForOutput: (componentId) => {
      const sourceId = rowsSourceFor(graph, componentId);
      return sourceId === undefined ? undefined : (sources.get(sourceId) ?? IDLE);
    },
    aggregateForOutput: (componentId) => {
      const sourceId = rowsSourceFor(graph, componentId);
      return sourceId === undefined ? undefined : (aggregates.get(sourceId) ?? IDLE_AGGREGATE);
    },
    nextPage: (componentId) => {
      const sourceId = rowsSourceFor(graph, componentId);
      if (sourceId === undefined) return;
      const current = sources.get(sourceId);
      if (current?.hasNextPage === true && current.nextCursor !== undefined) execute(sourceId, current.nextCursor);
    },
    selectRow,
    setAdaptiveValue,
    selectedRowId: (componentId) => {
      const stateId = selectedDocumentStatesFor(graph, componentId)[0];
      const selected = stateId === undefined ? undefined : state.get(stateId);
      return typeof selected === "string" ? selected : undefined;
    },
    detailForComponent: (component) => details.get(component.id) ?? { status: "empty" },
    fieldName: (fieldId) => fieldNames.get(fieldId),
    fieldType: (fieldId) => fieldTypes?.get(fieldId),
    runComponentEvent,
    canRunAction,
    actionState,
    setFormFieldValue,
    formFieldValue,
    pluginComponent: (kind) => plugins?.get(kind),
  }), [state, sources, aggregates, details, graph, setInputValue, runFromComponent, execute, selectRow, setAdaptiveValue, fieldNames, fieldTypes, runComponentEvent, canRunAction, actionState, setFormFieldValue, formFieldValue, plugins]);

  return <ComposedRuntimeContext.Provider value={value}>{children}</ComposedRuntimeContext.Provider>;
}
