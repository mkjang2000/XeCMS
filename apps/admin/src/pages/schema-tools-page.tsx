import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, TextAreaField } from "@xecms/ui";
import { toAdminApiError, useAdminApi } from "@xecms/admin";
import styles from "../app.module.css";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import { queryKeys } from "../queries.js";

function downloadText(fileName: string, source: string, mimeType: string) {
  const href = URL.createObjectURL(new Blob([source], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function SchemaToolsPage() {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const manifest = useQuery({
    queryKey: queryKeys.schemaManifest,
    queryFn: () => api.schemaArtifacts.exportManifest(),
  });
  const generated = useQuery({
    queryKey: queryKeys.schemaTypes,
    queryFn: () => api.schemaArtifacts.generateTypes(),
  });
  const diagnostics = useQuery({
    queryKey: queryKeys.diagnostics,
    queryFn: () => api.settings.diagnostics(),
  });
  const manifestImportAllowed = diagnostics.data?.schemaMode !== "locked"
    && diagnostics.data !== undefined;
  const [source, setSource] = useState("");
  const [localError, setLocalError] = useState<string>();
  useEffect(() => {
    if (manifest.data) setSource(manifest.data.serialized);
  }, [manifest.data]);
  const importMutation = useMutation({
    mutationFn: async () => {
      let schema: unknown;
      try {
        schema = JSON.parse(source);
      } catch {
        throw new Error("Manifest JSON 형식을 확인해 주세요.");
      }
      await api.schemaArtifacts.importManifest({ schema });
    },
    onSuccess: async () => {
      setLocalError(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.collections }),
        queryClient.invalidateQueries({ queryKey: queryKeys.schemaManifest }),
        queryClient.invalidateQueries({ queryKey: queryKeys.schemaTypes }),
      ]);
    },
    onError: (error) => setLocalError(toAdminApiError(error).message),
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Schema portability"
        title="Manifest · TypeScript"
        description="전체 Schema IR을 canonical JSON으로 이동하고 동일한 스키마에서 결정론적인 TypeScript 타입을 생성합니다."
      />
      {diagnostics.data?.schemaMode === "locked" ? (
        <Callout tone="warning">Schema mode가 <strong>locked</strong>이므로 Manifest 가져오기가 잠겨 있습니다.</Callout>
      ) : diagnostics.data?.schemaMode === "manifest-only" ? (
        <Callout tone="info">Manifest-only mode입니다. Manifest 가져오기는 허용되지만 시각 편집과 적용은 잠겨 있습니다.</Callout>
      ) : null}
      {manifest.isPending ? <PageLoading label="Schema manifest를 불러오는 중" /> : null}
      {manifest.isError ? <LoadError error={manifest.error} onRetry={() => void manifest.refetch()} /> : null}
      {manifest.data ? (
        <section className={styles.card}>
          <SectionHeader
            title="Canonical manifest"
            description={`SHA-256 ${manifest.data.hash}`}
            actions={(
              <Button variant="secondary" onPress={() => downloadText("xecms.schema.json", source, "application/json")}>JSON 저장</Button>
            )}
          />
          <TextAreaField
            label="Schema JSON"
            description="중첩 object/array, 재사용 component와 blocks를 포함한 Schema IR 전체를 편집할 수 있습니다."
            value={source}
            onChange={(next) => { setSource(next); setLocalError(undefined); }}
            rows={24}
            errorMessage={localError}
          />
          {importMutation.isSuccess ? <Callout tone="success">Manifest를 Schema draft로 가져왔습니다. 변경 사항 검토 후 적용해 주세요.</Callout> : null}
          <div className={styles.actions}>
            <Button onPress={() => importMutation.mutate()} isDisabled={!manifestImportAllowed || importMutation.isPending || !source.trim()}>
              {importMutation.isPending ? "가져오는 중…" : "Manifest를 초안으로 가져오기"}
            </Button>
            <Button variant="quiet" onPress={() => setSource(manifest.data.serialized)} isDisabled={importMutation.isPending}>서버 원본으로 되돌리기</Button>
          </div>
        </section>
      ) : null}
      {generated.isPending ? <PageLoading label="TypeScript 타입을 생성하는 중" /> : null}
      {generated.isError ? <LoadError error={generated.error} onRetry={() => void generated.refetch()} /> : null}
      {generated.data ? (
        <section className={styles.snapshotCard}>
          <div className={styles.snapshotHeader}>
            <div>
              <h2>Generated TypeScript</h2>
              <p>동일한 manifest는 항상 동일한 타입과 hash를 만듭니다.</p>
            </div>
            <code>{generated.data.fileName} · {generated.data.hash.slice(0, 12)}</code>
          </div>
          <pre className={styles.snapshot}>{generated.data.source}</pre>
          <div className={styles.actions}>
            <Button variant="secondary" onPress={() => downloadText(generated.data.fileName, generated.data.source, "text/typescript")}>TypeScript 저장</Button>
            <Button variant="quiet" onPress={() => void navigator.clipboard?.writeText(generated.data.source)}>클립보드 복사</Button>
          </div>
        </section>
      ) : null}
      <UnsavedChangesGuard when={manifest.data !== undefined && source !== manifest.data.serialized && !importMutation.isPending} />
    </Page>
  );
}
