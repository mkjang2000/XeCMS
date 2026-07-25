import type { AdminAppManifestV1 } from "../types.js";
import { assertValidAdminAppManifestV2 } from "./validate.js";
import type { AdminAppManifestV2, AppPresentationDefinition, ComposedPageDefinition } from "./types.js";

const DEFAULT_PRESENTATION: AppPresentationDefinition = {
  layoutProfile: "16:9",
  menuPosition: "left",
  canvasAlignment: "top-center",
};

export interface UpgradeToV2Options {
  /** Presentation for the upgraded App; defaults to 16:9 / left / top-center. */
  readonly presentation?: AppPresentationDefinition;
  /**
   * Seeds an empty Composed Page so the Builder can start editing immediately.
   * Skipped automatically if the id would collide with an existing page.
   */
  readonly seedComposedPage?: boolean;
}

/**
 * Upgrades a V1 manifest to V2, preserving every existing Generated Page and
 * reference (D-07: V1 Revisions stay immutable; the upgrade only rewrites a
 * Draft). V2 page union already accepts Generated Pages, so pages carry over
 * unchanged. Optionally seeds one empty Composed Page to start editing.
 */
export function upgradeManifestToV2(
  manifest: AdminAppManifestV1,
  options: UpgradeToV2Options = {},
): AdminAppManifestV2 {
  const seed = options.seedComposedPage ?? true;
  const pageIds = new Set(manifest.pages.map((page) => page.id));
  const composedPage = seed && !pageIds.has(SEED_PAGE_ID) ? [seedPage()] : [];
  const navigationIds = new Set(manifest.navigation.map((item) => item.id));
  const seededNav = composedPage.length > 0 && !navigationIds.has(SEED_NAV_ID)
    ? [{ id: SEED_NAV_ID, label: seedPage().menuLabel, pageId: SEED_PAGE_ID }]
    : [];

  const upgraded: AdminAppManifestV2 = {
    format: "xecms.admin-app",
    formatVersion: 2,
    id: manifest.id,
    name: manifest.name,
    key: manifest.key,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(manifest.icon === undefined ? {} : { icon: manifest.icon }),
    audience: manifest.audience,
    presentation: options.presentation ?? DEFAULT_PRESENTATION,
    navigation: [...manifest.navigation, ...seededNav],
    pages: [...manifest.pages, ...composedPage],
    startPageId: manifest.startPageId,
  };
  assertValidAdminAppManifestV2(upgraded);
  return upgraded;
}

const SEED_PAGE_ID = "pg-composed-1";
const SEED_NAV_ID = "nav-composed-1";

function seedPage(): ComposedPageDefinition {
  return {
    id: SEED_PAGE_ID,
    type: "composed-page",
    screenNo: "SCR-001",
    title: "새 화면",
    menuLabel: "새 화면",
    layout: { columns: 48, rowHeight: 8 },
    state: [],
    dataSources: [],
    components: [],
    connections: [],
  };
}
