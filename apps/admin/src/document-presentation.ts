import type { CollectionDetail, DocumentRecord } from "@xecms/admin";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });

export function formatAdminDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : value;
}

export function documentTitle(document: DocumentRecord, collection: CollectionDetail): string {
  const titleField = collection.fields.find(({ type }) => type === "text");
  const value = titleField ? document.data[titleField.name] : undefined;
  return typeof value === "string" && value.trim() ? value : `문서 ${document.id}`;
}

export type DocumentFormSyncDecision = "initialize" | "keep" | "reset" | "conflict";

export function decideDocumentFormSync(input: {
  readonly routeKey: string;
  readonly initializedRouteKey: string | null;
  readonly isNew: boolean;
  readonly loadedVersion: number | null;
  readonly remoteVersion?: number;
  readonly isDirty: boolean;
}): DocumentFormSyncDecision {
  if (input.initializedRouteKey !== input.routeKey) return "initialize";
  if (
    input.isNew ||
    input.remoteVersion === undefined ||
    input.loadedVersion === input.remoteVersion
  ) {
    return "keep";
  }
  return input.isDirty ? "conflict" : "reset";
}
