import type { CollectionDetail, DocumentRecord } from "@xecms/admin";
export declare function formatAdminDate(value: string): string;
export declare function documentTitle(document: DocumentRecord, collection: CollectionDetail): string;
export type DocumentFormSyncDecision = "initialize" | "keep" | "reset" | "conflict";
export declare function decideDocumentFormSync(input: {
    readonly routeKey: string;
    readonly initializedRouteKey: string | null;
    readonly isNew: boolean;
    readonly loadedVersion: number | null;
    readonly remoteVersion?: number;
    readonly isDirty: boolean;
}): DocumentFormSyncDecision;
//# sourceMappingURL=document-presentation.d.ts.map