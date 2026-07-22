export type AdminAppAudience =
  | { readonly type: "system" }
  | { readonly type: "content-realm"; readonly realmId: string };

export interface PermissionReference {
  readonly action: string;
  readonly resourceId: string;
}

export interface VisibilityCondition {
  readonly allPermissions?: readonly PermissionReference[];
  readonly anyPermissions?: readonly PermissionReference[];
  readonly documentStatuses?: readonly string[];
}

export interface AdminNavigationItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly pageId?: string;
  readonly children?: readonly AdminNavigationItem[];
  readonly visibility?: VisibilityCondition;
}

export type AdminAppScalar = null | boolean | number | string;
export type AdminAppSystemField = "id" | "createdAt" | "updatedAt" | "version";
export type AdminAppFieldReference =
  | { readonly kind: "data"; readonly fieldId: string }
  | { readonly kind: "system"; readonly field: AdminAppSystemField };

export type AdminAppFilterOperator =
  | "eq" | "ne" | "lt" | "lte" | "gt" | "gte"
  | "contains" | "startsWith" | "in" | "isNull" | "isNotNull";

export type AdminAppFilterExpression =
  | {
      readonly type: "condition";
      readonly field: AdminAppFieldReference;
      readonly operator: AdminAppFilterOperator;
      readonly value?: AdminAppScalar | readonly AdminAppScalar[];
    }
  | {
      readonly type: "group";
      readonly operator: "and" | "or";
      readonly filters: readonly AdminAppFilterExpression[];
    };

export interface AdminAppSortDefinition {
  readonly field: AdminAppFieldReference;
  readonly direction: "asc" | "desc";
}

export interface AdminAppFilterDefinition {
  readonly id: string;
  readonly label: string;
  readonly field: AdminAppFieldReference;
  readonly operators?: readonly AdminAppFilterOperator[];
}

export interface AdminAppColumnDefinition {
  readonly id: string;
  readonly field: AdminAppFieldReference;
  readonly label?: string;
  readonly width?: number;
  /** Built-in `core.renderer.*` or namespaced `<plugin>.renderer.*`. */
  readonly rendererId?: string;
}

export interface ActionConfirmationDefinition {
  readonly title: string;
  readonly message: string;
  readonly danger?: boolean;
}

export interface AdminAppActionReference {
  /** Built-in `core.action.*` or namespaced `<plugin>.action.*`. */
  readonly id: string;
  readonly label?: string;
  readonly visibility?: VisibilityCondition;
  readonly confirmation?: ActionConfirmationDefinition;
}

export interface AdminAppPageLinkDefinition {
  readonly pageId: string;
  readonly documentIdFrom?: "row";
}

export interface AdminAppDocumentQuery {
  readonly collectionId: string;
  readonly limit: number;
  readonly fields?: readonly string[];
  readonly filter?: AdminAppFilterExpression;
  readonly sort?: readonly AdminAppSortDefinition[];
  readonly state?: "active" | "deleted";
}

export interface FormFieldDefinition {
  readonly id: string;
  readonly type: "field";
  readonly fieldId: string;
  readonly label?: string;
  readonly description?: string;
  readonly width?: "full" | "half" | "third";
  readonly hidden?: boolean;
  readonly readOnly?: boolean;
  /** Built-in `core.widget.*` or namespaced `<plugin>.widget.*`. */
  readonly widgetId?: string;
  readonly when?: AdminAppFilterExpression;
}

export interface FormSectionDefinition {
  readonly id: string;
  readonly type: "section";
  readonly title?: string;
  readonly description?: string;
  readonly columns?: 1 | 2 | 3;
  readonly children: readonly FormLayoutNode[];
}

export interface FormTabDefinition {
  readonly id: string;
  readonly label: string;
  readonly children: readonly FormLayoutNode[];
}

export interface FormTabsDefinition {
  readonly id: string;
  readonly type: "tabs";
  readonly tabs: readonly FormTabDefinition[];
}

export interface FormCollapseDefinition {
  readonly id: string;
  readonly type: "collapse";
  readonly title: string;
  readonly initiallyOpen?: boolean;
  readonly children: readonly FormLayoutNode[];
}

export type FormLayoutNode =
  | FormFieldDefinition
  | FormSectionDefinition
  | FormTabsDefinition
  | FormCollapseDefinition;

export interface FormLayoutDefinition {
  readonly nodes: readonly FormLayoutNode[];
}

export type DetailPanelDefinition =
  | { readonly id: string; readonly type: "summary"; readonly fieldIds: readonly string[] }
  | { readonly id: string; readonly type: "field-group"; readonly title?: string; readonly fieldIds: readonly string[] }
  | { readonly id: string; readonly type: "relation"; readonly relationId: string; readonly title?: string }
  | { readonly id: string; readonly type: "revisions" }
  | { readonly id: string; readonly type: "audit" }
  | { readonly id: string; readonly type: "plugin"; readonly extensionId: string };

export interface DetailLayoutDefinition {
  readonly panels: readonly DetailPanelDefinition[];
}

export interface DashboardWidgetDefinition {
  readonly id: string;
  /** Built-in `core.widget.*` or namespaced `<plugin>.widget.*`. */
  readonly widgetId: string;
  readonly title?: string;
  readonly width?: 1 | 2 | 3 | 4 | 6 | 8 | 12;
  readonly query?: AdminAppDocumentQuery;
  readonly action?: AdminAppActionReference;
  readonly visibility?: VisibilityCondition;
}

export interface CollectionListPageDefinition {
  readonly id: string;
  readonly type: "collection-list";
  readonly collectionId: string;
  readonly title?: string;
  /** Selects the active workspace or the recoverable trash workspace. */
  readonly state?: "active" | "deleted";
  readonly columns: readonly AdminAppColumnDefinition[];
  readonly fixedFilter?: AdminAppFilterExpression;
  readonly availableFilters?: readonly AdminAppFilterDefinition[];
  readonly defaultSort?: readonly AdminAppSortDefinition[];
  readonly rowActions?: readonly AdminAppActionReference[];
  readonly bulkActions?: readonly AdminAppActionReference[];
  readonly rowClick?: AdminAppPageLinkDefinition;
}

export interface DocumentFormPageDefinition {
  readonly id: string;
  readonly type: "document-form";
  readonly collectionId: string;
  readonly mode: "create" | "edit" | "create-or-edit";
  readonly layout: FormLayoutDefinition;
  readonly actions?: readonly AdminAppActionReference[];
}

export interface DocumentDetailPageDefinition {
  readonly id: string;
  readonly type: "document-detail";
  readonly collectionId: string;
  readonly title?: string;
  readonly layout: DetailLayoutDefinition;
  readonly actions?: readonly AdminAppActionReference[];
}

export interface SingletonPageDefinition {
  readonly id: string;
  readonly type: "singleton";
  readonly collectionId: string;
  readonly title?: string;
  readonly layout: FormLayoutDefinition;
  readonly actions?: readonly AdminAppActionReference[];
}

export interface DashboardPageDefinition {
  readonly id: string;
  readonly type: "dashboard";
  readonly title?: string;
  readonly widgets: readonly DashboardWidgetDefinition[];
}

export interface PluginPageDefinition {
  readonly id: string;
  readonly type: "plugin-page";
  readonly title?: string;
  readonly extensionId: string;
}

export type AdminPageDefinition =
  | CollectionListPageDefinition
  | DocumentFormPageDefinition
  | DocumentDetailPageDefinition
  | SingletonPageDefinition
  | DashboardPageDefinition
  | PluginPageDefinition;

export interface AdminAppManifestV1 {
  readonly format: "xecms.admin-app";
  readonly formatVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly description?: string;
  readonly icon?: string;
  readonly audience: AdminAppAudience;
  readonly navigation: readonly AdminNavigationItem[];
  readonly pages: readonly AdminPageDefinition[];
  readonly startPageId: string;
}
