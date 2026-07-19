export declare function IdentityRealmListPage(): import("react").JSX.Element;
export declare function IdentityRealmDetailPage(): import("react").JSX.Element;
/**
 * Cross-space access matrix: rows are collections, columns are Content Realms,
 * each cell shows the ceiling (allowed actions) for that (collection, realm)
 * pair. The reverse endpoint (`listEntitlementsForCollection`) fills one row per
 * collection with a single request. Read-only overview; editing stays on the
 * per-space "권한" tab, reachable by clicking a cell.
 */
export declare function RealmEntitlementMatrixPage(): import("react").JSX.Element;
//# sourceMappingURL=identity-realm-pages.d.ts.map