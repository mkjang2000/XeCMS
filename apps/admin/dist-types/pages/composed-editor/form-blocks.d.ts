import type { ComponentDefinition, ComposedPageDefinition, ConnectionDefinition, DataSourceDefinition, PageStateDefinition } from "@xecms/admin-apps";
/**
 * Form blocks are the editor's first-class editing unit for the "전산 사용자"
 * (data-literate, non-coder). A block is a *logical bundle* of the low-level
 * Manifest atoms (component(s) + state + data source + internal connections) that
 * share one `blockId` prefix. The user places and connects whole blocks — the
 * ports/state/parameters underneath are generated automatically. The Manifest and
 * runtime contract are unchanged: a block is purely an editor projection over the
 * same atoms a hand-built page would have.
 *
 * This layer promotes the CPB-8 preset pattern (id-prefixed atom bundles) into an
 * add/parse/connect model the canvas edits directly.
 */
export type FormBlockKind = "search" | "date-search" | "select-search" | "number-search" | "multi-search" | "list" | "cards" | "detail" | "field" | "input-form" | "item-actions";
export interface FormBlockField {
    readonly fieldId: string;
    readonly label?: string;
    readonly maskPolicyId?: string;
}
/** An editor-side view of a block: which atoms it owns and its user-facing config. */
export interface FormBlock {
    readonly id: string;
    readonly kind: FormBlockKind;
    /** The block's primary Collection (search/input target, or list/detail source). */
    readonly collectionId?: string;
    /** Ids of the components this block owns (for selection/removal/preview). */
    readonly componentIds: readonly string[];
    /** The "anchor" component whose placement represents the block on the canvas. */
    readonly anchorComponentId: string;
}
export declare function blockKindLabel(kind: FormBlockKind): string;
/** Allocates the next free block id (`blk1`, `blk2`, …) on a page. */
export declare function nextBlockId(page: ComposedPageDefinition): string;
/** The block id that owns an atom id, by the `blk<n>_...` prefix convention. */
export declare function blockIdOf(atomId: string): string | null;
export interface AddBlockInput {
    readonly kind: FormBlockKind;
    readonly collectionId: string;
    readonly fields: readonly FormBlockField[];
    /** Field a search block filters on; defaults to the first field. */
    readonly searchFieldId?: string;
    /** Top-left grid cell to place the block at. */
    readonly at?: {
        readonly x: number;
        readonly y: number;
    };
}
/**
 * Produces the atoms for a new block. Each atom id is `<blockId>_...`, so the
 * block can later be re-identified, moved, reconfigured, or removed as a unit.
 */
export declare function buildBlock(blockId: string, input: AddBlockInput): {
    readonly components: readonly ComponentDefinition[];
    readonly state: readonly PageStateDefinition[];
    readonly dataSources: readonly DataSourceDefinition[];
    readonly connections: readonly ConnectionDefinition[];
};
/**
 * Groups a page's components into blocks by their `blk<n>_` prefix and infers the
 * kind from the components present. Atoms without the prefix (hand-placed legacy
 * components) are ignored here — the canvas still renders them, they just aren't
 * treated as blocks.
 */
export declare function describeBlocks(page: ComposedPageDefinition): readonly FormBlock[];
/** The fields a block currently shows/collects, read back from its atoms. */
export declare function blockFields(page: ComposedPageDefinition, block: FormBlock): readonly FormBlockField[];
/** The (first) filter field a search block filters on, if any. */
export declare function blockSearchField(page: ComposedPageDefinition, block: FormBlock): string | undefined;
/** Whether a block is a search (produces query results to feed outputs). */
export declare function isSearchBlock(kind: FormBlockKind): boolean;
/** Whether a block is a row/list output (feeds detail/field/actions via selection). */
export declare function isListBlock(kind: FormBlockKind): boolean;
/** Adds a block's atoms to a page below the existing content (no overlap). */
export declare function addBlockToPage(page: ComposedPageDefinition, input: AddBlockInput): {
    readonly page: ComposedPageDefinition;
    readonly blockId: string;
};
/** Removes a block and every atom (component/state/data source/connection) it owns. */
export declare function removeBlockFromPage(page: ComposedPageDefinition, blockId: string): ComposedPageDefinition;
/**
 * Rebuilds a block's atoms in place from new config (collection/fields/search
 * field), preserving the block id and the anchor component's placement. Other
 * blocks and their connections to this block survive because ids are stable.
 */
export declare function reconfigureBlock(page: ComposedPageDefinition, block: FormBlock, config: {
    readonly collectionId: string;
    readonly fields: readonly FormBlockField[];
    readonly searchFieldId?: string;
}): ComposedPageDefinition;
/** The editable text labels of a block's components (buttons, form title, inputs). */
export interface BlockLabel {
    readonly componentId: string;
    readonly role: string;
    readonly value: string;
}
export declare function blockLabels(page: ComposedPageDefinition, block: FormBlock): readonly BlockLabel[];
/** Sets one component's label text directly (no rebuild), keeping everything else. */
export declare function setComponentLabel(page: ComposedPageDefinition, componentId: string, label: string): ComposedPageDefinition;
/** A form-to-form link, as the user sees it (one line between two blocks). */
export interface BlockLink {
    readonly fromBlockId: string;
    readonly toBlockId: string;
}
/**
 * Which output block kinds a source block kind can feed. Same-schema flow only
 * (slice 3-1): a search feeds a list (its rows) or a detail (its selected row);
 * a list feeds a detail (row selection). Cross-schema lookup is a later slice.
 */
export declare function canLinkBlocks(from: FormBlock, to: FormBlock): boolean;
/**
 * Creates the internal atoms/connections that realize a form-to-form link.
 * search→list/cards: the search query's rows feed the output.
 * *→detail/field/actions: the source's selected row feeds the consumer via a
 * shared `<toBlockId>_state_target` document-id state (list writes it on select).
 */
export declare function linkBlocks(page: ComposedPageDefinition, from: FormBlock, to: FormBlock): ComposedPageDefinition;
/** Removes the atoms/connections a form-to-form link created (by its id prefix). */
export declare function unlinkBlocks(page: ComposedPageDefinition, from: FormBlock, to: FormBlock): ComposedPageDefinition;
/** The form-to-form links currently on a page, derived from `_link_` connections. */
export declare function blockLinks(page: ComposedPageDefinition): readonly BlockLink[];
//# sourceMappingURL=form-blocks.d.ts.map