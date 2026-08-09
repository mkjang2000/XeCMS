import { useMemo, useState } from "react";
import { Button } from "@xecms/ui";
import { ComposedPage } from "@xecms/admin-runtime";
import type { AdminAppManifestV2, ComposedPageDefinition } from "@xecms/admin-apps";
import type { AdminAppRuntimeDto, CollectionSummaryDto } from "@xecms/client";

import { createPreviewDataClient } from "./preview-client.js";
import styles from "../composed-screen-editor.module.css";

export interface PreviewModalProps {
  readonly manifest: AdminAppManifestV2;
  readonly collections: readonly CollectionSummaryDto[];
  /** The page to open first (usually the one being edited). */
  readonly initialPageId: string;
  readonly schemaRevisionId: string | null;
  readonly onClose: () => void;
}

/**
 * Runs the EDITING (unsaved) manifest against real data in a modal, using a
 * synthesized runtime DTO + a client-side query resolver. Reads are live; every
 * mutation is blocked (Preview never writes). This lets a "전산 사용자" verify a
 * screen's wiring — search → list → detail, cross-schema lookups — before saving.
 */
export function PreviewModal({ manifest, collections, initialPageId, schemaRevisionId, onClose }: PreviewModalProps) {
  const composedPages = useMemo(
    () => manifest.pages.filter((page): page is ComposedPageDefinition => page.type === "composed-page"),
    [manifest.pages],
  );
  const [pageId, setPageId] = useState(
    composedPages.some((page) => page.id === initialPageId) ? initialPageId : (composedPages[0]?.id ?? ""),
  );
  const activePage = composedPages.find((page) => page.id === pageId) ?? composedPages[0];

  const fieldNameById = useMemo(
    () => new Map(collections.flatMap((collection) => collection.fields.map((field) => [field.id, field.name] as const))),
    [collections],
  );
  const client = useMemo(() => createPreviewDataClient(composedPages, fieldNameById), [composedPages, fieldNameById]);
  const runtime = useMemo(
    () => synthesizeRuntime(manifest, collections, schemaRevisionId),
    [manifest, collections, schemaRevisionId],
  );

  return (
    <div className={styles.previewBackdrop} role="presentation" onClick={onClose}>
      <section
        className={styles.previewDialog}
        role="dialog"
        aria-modal="true"
        aria-label="화면 미리보기"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.previewHeader}>
          <div>
            <span>미리보기 · 저장하지 않은 상태</span>
            <strong>{manifest.name}</strong>
          </div>
          <div className={styles.previewHeaderActions}>
            {composedPages.length > 1 ? (
              <select
                className={styles.previewPageSelect}
                aria-label="미리볼 화면"
                value={activePage?.id ?? ""}
                onChange={(event) => setPageId(event.target.value)}
              >
                {composedPages.map((page) => (
                  <option key={page.id} value={page.id}>{page.title || page.menuLabel || page.id}</option>
                ))}
              </select>
            ) : null}
            <Button size="small" variant="secondary" onPress={onClose}>닫기</Button>
          </div>
        </header>
        <p className={styles.previewHint}>실제 데이터로 조회·선택을 시험합니다. 저장·삭제 등 변경은 미리보기에서 실행되지 않습니다.</p>
        <div className={styles.previewBody}>
          {activePage === undefined ? (
            <p className={styles.inspectorEmpty} style={{ padding: "2rem" }}>미리볼 화면이 없습니다.</p>
          ) : (
            <ComposedPage
              key={activePage.id}
              runtime={runtime}
              page={activePage}
              client={client}
              navigate={(target) => setPageId(target)}
            />
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Builds a minimal {@link AdminAppRuntimeDto} from the editing manifest. Access is
 * permissive (Preview is a UX gate only; the content API still enforces masking &
 * permissions on every read, and mutations are blocked by the Preview client).
 */
function synthesizeRuntime(
  manifest: AdminAppManifestV2,
  collections: readonly CollectionSummaryDto[],
  schemaRevisionId: string | null,
): AdminAppRuntimeDto {
  const now = new Date().toISOString();
  const pageAccess: Record<string, boolean> = {};
  const pageUnmasked: Record<string, boolean> = {};
  const actions: Record<string, boolean> = {};
  for (const page of manifest.pages) {
    pageAccess[page.id] = true;
    pageUnmasked[page.id] = true;
    if (page.type === "composed-page") {
      for (const component of page.components) {
        const actionId = typeof component.props?.actionId === "string" ? component.props.actionId : undefined;
        if (actionId !== undefined) actions[`${page.id}:${actionId}`] = true;
      }
    }
  }
  const readableFields: Record<string, readonly string[] | null> = {};
  const writableFields: Record<string, readonly string[] | null> = {};
  for (const collection of collections) {
    readableFields[collection.id] = null;
    writableFields[collection.id] = null;
  }

  return {
    app: {
      id: manifest.id, workspaceId: "preview", manifestId: manifest.id,
      key: manifest.key, name: manifest.name,
      audience: manifest.audience.type === "content-realm"
        ? { type: "content-realm", realmId: manifest.audience.realmId }
        : { type: "system" },
      status: "active", activeRevisionId: null, routeVersion: 0, createdAt: now,
      createdByIdentityId: "preview", createdBySubjectId: "preview",
      updatedAt: now, updatedByIdentityId: "preview", updatedBySubjectId: "preview",
    },
    revisionId: "preview",
    manifest,
    schema: { revisionId: schemaRevisionId ?? "preview", collections },
    user: {
      identityId: "preview", subjectId: "preview", displayName: "미리보기",
      realmId: manifest.audience.type === "content-realm" ? manifest.audience.realmId : "system",
    },
    access: {
      appAllowed: true, pages: pageAccess, pageUnmasked, actions,
      permissions: {}, readableFields, writableFields, policyRevision: 0,
    },
    dependencyHealth: { healthy: true, checkedAt: now, blockers: [] },
  };
}
