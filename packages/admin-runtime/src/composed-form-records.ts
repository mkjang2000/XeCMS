import { useEffect, useRef, useState } from "react";
import type { AdminRuntimeDataClient } from "./api.js";

export interface FormRecordTarget {
  readonly componentId: string;
  readonly collectionId: string;
  readonly documentId: string | null;
}
interface FormRecord {
  readonly documentId: string;
  readonly status: "loading" | "ready" | "error";
  readonly version?: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly changes: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

/** A form edits the snapshot it loaded; only explicitly changed fields are sent. */
export function useComposedFormRecords(pageId: string, targets: readonly FormRecordTarget[], client: Pick<AdminRuntimeDataClient, "getComposedDocument" | "update">) {
  const [records, setRecords] = useState<ReadonlyMap<string, FormRecord>>(new Map());
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const requests = useRef(new Map<string, { readonly key: string; readonly abort: AbortController }>());
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const targetKey = JSON.stringify(targets);
  useEffect(() => {
    const current = targetsRef.current;
    for (const [id, request] of requests.current) {
      if (!current.some((target) => target.componentId === id && `${target.collectionId}:${target.documentId}` === request.key)) {
        request.abort.abort(); requests.current.delete(id);
        setRecords((prev) => { const next = new Map(prev); next.delete(id); return next; });
      }
    }
    for (const target of current) {
      if (target.documentId === null) continue;
      const key = `${target.collectionId}:${target.documentId}`;
      if (requests.current.get(target.componentId)?.key === key) continue;
      const abort = new AbortController();
      requests.current.set(target.componentId, { key, abort });
      const empty: FormRecord = { documentId: target.documentId, status: "loading", data: {}, changes: {} };
      setRecords((prev) => new Map(prev).set(target.componentId, empty));
      void client.getComposedDocument(pageId, target.componentId, { documentId: target.documentId, collectionId: target.collectionId }, abort.signal)
        .then((document) => {
          if (abort.signal.aborted) return;
          if (document === null || document.version === undefined) throw new Error("수정할 항목을 읽을 수 없습니다.");
          setRecords((prev) => new Map(prev).set(target.componentId, { ...empty, status: "ready", version: document.version, data: document.data }));
        }).catch((error: unknown) => {
          if (!abort.signal.aborted) setRecords((prev) => new Map(prev).set(target.componentId, { ...empty, status: "error", error: error instanceof Error ? error.message : "조회에 실패했습니다." }));
        });
    }
  }, [targetKey, client, pageId]);
  useEffect(() => () => { for (const request of requests.current.values()) request.abort.abort(); requests.current.clear(); }, [client, pageId]);

  const recordFor = (id: string): FormRecord | undefined => {
    const target = targets.find((t) => t.componentId === id);
    const record = recordsRef.current.get(id);
    return target?.documentId === record?.documentId ? record : undefined;
  };
  return {
    status: (id: string) => recordFor(id)?.status ?? "empty",
    error: (id: string) => recordFor(id)?.error,
    value: (id: string, field: string): unknown => {
      const record = recordFor(id);
      return record !== undefined && Object.hasOwn(record.changes, field) ? record.changes[field] : record?.data[field];
    },
    setValue: (id: string, field: string, value: unknown): void => {
      const record = recordFor(id);
      if (record?.status !== "ready") return;
      const next = new Map(recordsRef.current).set(id, { ...record, changes: { ...record.changes, [field]: value } });
      recordsRef.current = next; setRecords(next);
    },
    save: async (id: string, collectionId: string, documentId: string): Promise<void> => {
      const record = recordFor(id);
      if (record?.status !== "ready" || record.documentId !== documentId || record.version === undefined) throw new Error("선택 항목을 먼저 불러오세요.");
      if (Object.keys(record.changes).length === 0) return;
      const result = await client.update(collectionId, documentId, record.changes, record.version);
      // Selection may change while the mutation is in flight.
      if (recordsRef.current.get(id) !== record || !targetsRef.current.some((target) => target.componentId === id && target.documentId === documentId && target.collectionId === collectionId)) return;
      const next = new Map(recordsRef.current).set(id, { ...record, version: result.version,
        data: { ...record.data, ...record.changes }, changes: {} });
      recordsRef.current = next; setRecords(next);
    },
  };
}
