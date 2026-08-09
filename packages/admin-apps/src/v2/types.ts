import type {
  AdminAppAudience,
  AdminAppScalar,
  AdminNavigationItem,
  AdminPageDefinition,
} from "../types.js";

/** App-level presentation owned by V2 (16:9 default, 4:3 selectable). */
export interface AppPresentationDefinition {
  readonly layoutProfile: "16:9" | "4:3";
  readonly menuPosition: "left" | "right";
  readonly canvasAlignment: "top-center" | "top-left";
}

/** Logical grid, fixed at 48 columns with an 8px base row (§4.2). */
export interface ComposedPageLayout {
  readonly columns: 48;
  readonly rowHeight: 8;
}

/** Integer grid coordinates; overlap is forbidden and validated (D-02). */
export interface GridPlacement {
  readonly x: number; // 0..47
  readonly y: number; // >= 0
  readonly width: number; // 1..48
  readonly height: number; // >= 1
}

export type PageStateValueType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "string[]"
  | "document-id";

export interface PageStateDefinition {
  readonly id: string;
  readonly valueType: PageStateValueType;
  readonly initialValue: AdminAppScalar | readonly string[];
}

export type DataSourceTrigger = "on-load" | "manual" | "on-change";

export interface DataSourceParameterDefinition {
  readonly id: string;
  readonly valueType: PageStateValueType;
}

export type ComposedFieldReference =
  | { readonly kind: "data"; readonly fieldId: string }
  | { readonly kind: "system"; readonly field: "id" | "createdAt" | "updatedAt" | "version" };

export type ComposedFilterOperator =
  | "eq" | "ne" | "lt" | "lte" | "gt" | "gte"
  | "contains" | "startsWith" | "in" | "isNull" | "isNotNull";

/** A filter value is either a literal scalar or a bound Page State parameter. */
export type ParameterizedFilterValue =
  | { readonly type: "literal"; readonly value: AdminAppScalar | readonly AdminAppScalar[] }
  | { readonly type: "parameter"; readonly parameterId: string };

export type ParameterizedFilterExpression =
  | {
      readonly type: "condition";
      readonly field: ComposedFieldReference;
      readonly operator: ComposedFilterOperator;
      readonly value?: ParameterizedFilterValue;
    }
  | {
      readonly type: "group";
      readonly operator: "and" | "or";
      readonly filters: readonly ParameterizedFilterExpression[];
    };

export interface ComposedSortDefinition {
  readonly field: ComposedFieldReference;
  readonly direction: "asc" | "desc";
}

/** A group-by aggregation on a Data Source (slG1) — powers chart/summary output. */
export type ComposedAggregateMeasure =
  | { readonly op: "count" }
  | { readonly op: "sum" | "avg"; readonly field: ComposedFieldReference };

export interface ComposedAggregateDefinition {
  readonly groupBy: ComposedFieldReference;
  readonly measure: ComposedAggregateMeasure;
}

export interface DocumentQueryDataSource {
  readonly id: string;
  readonly type: "document-query";
  readonly collectionId: string;
  readonly trigger: DataSourceTrigger;
  readonly debounceMs?: number;
  readonly fields: readonly string[];
  readonly parameters?: readonly DataSourceParameterDefinition[];
  readonly filter?: ParameterizedFilterExpression;
  readonly sort?: readonly ComposedSortDefinition[];
  readonly limit: number;
  /** When present, this Data Source returns aggregated groups instead of rows. */
  readonly aggregate?: ComposedAggregateDefinition;
}

export type DataSourceDefinition = DocumentQueryDataSource;

/** Output protection carried on output component props (§4.10, CPB-0M). */
export interface OutputProtectionDefinition {
  readonly mode: "normal" | "mask-when-required" | "always-mask";
  readonly maskPolicyId?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface ComposedPageEventBinding {
  readonly id: string;
  readonly event: "onLoad" | "onClick" | "onChange" | "onRowSelect" | "onSubmit" | "onScan";
  readonly effects: readonly ComposedEffectDefinition[];
}

export interface ComposedEffectDefinition {
  readonly id: string;
  readonly kind:
    | "state.set"
    | "state.reset"
    | "data-source.execute"
    | "data-source.reset"
    | "await-query"
    | "form.setField"
    | "action.updateFields"
    | "navigate"
    | "action.execute";
  readonly args?: Readonly<Record<string, unknown>>;
  /**
   * Optional declarative guard (CPB-WF): the effect runs only when this evaluates
   * true against the current Page State and the last `await-query` result. Absent
   * ⇒ always runs. Declarative-only — never arbitrary code (§3, D-20).
   */
  readonly when?: RuleCondition;
}

/**
 * A pure, declarative condition guarding an effect (CPB-WF). Evaluated at runtime
 * against Page State and the most recent `await-query` result — no arbitrary JS.
 */
export type RuleCondition =
  | {
      readonly type: "state";
      readonly stateId: string;
      readonly op: "eq" | "ne" | "empty" | "notEmpty" | "gt" | "lt";
      readonly value?: AdminAppScalar;
    }
  | {
      readonly type: "queryResult";
      /** The result of the last `await-query` effect in this chain. */
      readonly source: "lastQuery";
      readonly op: "hasRows" | "noRows" | "countGt";
      readonly value?: number;
    }
  | {
      /**
       * Reads a Field of the row being rendered (CPB-WF 슬4 `highlightWhen`). Only
       * meaningful in a per-row context (output columns/rows); elsewhere it reads
       * as empty and fails closed.
       */
      readonly type: "field";
      readonly fieldId: string;
      readonly op: "eq" | "ne" | "empty" | "notEmpty" | "gt" | "lt";
      readonly value?: AdminAppScalar;
    }
  | { readonly type: "and"; readonly conditions: readonly RuleCondition[] }
  | { readonly type: "or"; readonly conditions: readonly RuleCondition[] };

export interface ComponentBindings {
  readonly [portId: string]: unknown;
}

export interface ComponentDefinition {
  readonly id: string;
  readonly kind: string;
  readonly placement: GridPlacement;
  readonly props: Readonly<Record<string, unknown>>;
  readonly bindings?: ComponentBindings;
  readonly events?: readonly ComposedPageEventBinding[];
}

export type PortNodeType = "component" | "state" | "data-source";

export interface PortReference {
  readonly nodeType: PortNodeType;
  readonly nodeId: string;
  readonly portId: string;
}

export interface ConnectionDefinition {
  readonly id: string;
  readonly from: PortReference;
  readonly to: PortReference;
}

export interface ComposedPageDefinition {
  readonly id: string;
  readonly type: "composed-page";
  readonly screenNo: string;
  readonly title: string;
  readonly menuLabel: string;
  readonly layout: ComposedPageLayout;
  readonly state: readonly PageStateDefinition[];
  readonly dataSources: readonly DataSourceDefinition[];
  readonly components: readonly ComponentDefinition[];
  readonly connections: readonly ConnectionDefinition[];
  readonly events?: readonly ComposedPageEventBinding[];
}

/** V2 pages mix Generated Pages and Composed Pages (§4.1). */
export type AdminPageDefinitionV2 = AdminPageDefinition | ComposedPageDefinition;

export interface AdminAppManifestV2 {
  readonly format: "xecms.admin-app";
  readonly formatVersion: 2;
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly description?: string;
  readonly icon?: string;
  readonly audience: AdminAppAudience;
  readonly presentation: AppPresentationDefinition;
  readonly navigation: readonly AdminNavigationItem[];
  readonly pages: readonly AdminPageDefinitionV2[];
  readonly startPageId: string;
}
