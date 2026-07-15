import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, TextAreaField } from "@xecms/ui";
import { toAdminApiError, useAdminApi } from "@xecms/admin";
import styles from "../app.module.css";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import { queryKeys } from "../queries.js";
function downloadText(fileName, source, mimeType) {
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
    const [localError, setLocalError] = useState();
    useEffect(() => {
        if (manifest.data)
            setSource(manifest.data.serialized);
    }, [manifest.data]);
    const importMutation = useMutation({
        mutationFn: async () => {
            let schema;
            try {
                schema = JSON.parse(source);
            }
            catch {
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
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Schema portability", title: "Manifest \u00B7 TypeScript", description: "\uC804\uCCB4 Schema IR\uC744 canonical JSON\uC73C\uB85C \uC774\uB3D9\uD558\uACE0 \uB3D9\uC77C\uD55C \uC2A4\uD0A4\uB9C8\uC5D0\uC11C \uACB0\uC815\uB860\uC801\uC778 TypeScript \uD0C0\uC785\uC744 \uC0DD\uC131\uD569\uB2C8\uB2E4." }), diagnostics.data?.schemaMode === "locked" ? (_jsxs(Callout, { tone: "warning", children: ["Schema mode\uAC00 ", _jsx("strong", { children: "locked" }), "\uC774\uBBC0\uB85C Manifest \uAC00\uC838\uC624\uAE30\uAC00 \uC7A0\uACA8 \uC788\uC2B5\uB2C8\uB2E4."] })) : diagnostics.data?.schemaMode === "manifest-only" ? (_jsx(Callout, { tone: "info", children: "Manifest-only mode\uC785\uB2C8\uB2E4. Manifest \uAC00\uC838\uC624\uAE30\uB294 \uD5C8\uC6A9\uB418\uC9C0\uB9CC \uC2DC\uAC01 \uD3B8\uC9D1\uACFC \uC801\uC6A9\uC740 \uC7A0\uACA8 \uC788\uC2B5\uB2C8\uB2E4." })) : null, manifest.isPending ? _jsx(PageLoading, { label: "Schema manifest\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, manifest.isError ? _jsx(LoadError, { error: manifest.error, onRetry: () => void manifest.refetch() }) : null, manifest.data ? (_jsxs("section", { className: styles.card, children: [_jsx(SectionHeader, { title: "Canonical manifest", description: `SHA-256 ${manifest.data.hash}`, actions: (_jsx(Button, { variant: "secondary", onPress: () => downloadText("xecms.schema.json", source, "application/json"), children: "JSON \uC800\uC7A5" })) }), _jsx(TextAreaField, { label: "Schema JSON", description: "\uC911\uCCA9 object/array, \uC7AC\uC0AC\uC6A9 component\uC640 blocks\uB97C \uD3EC\uD568\uD55C Schema IR \uC804\uCCB4\uB97C \uD3B8\uC9D1\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", value: source, onChange: (next) => { setSource(next); setLocalError(undefined); }, rows: 24, errorMessage: localError }), importMutation.isSuccess ? _jsx(Callout, { tone: "success", children: "Manifest\uB97C Schema draft\uB85C \uAC00\uC838\uC654\uC2B5\uB2C8\uB2E4. \uBCC0\uACBD \uC0AC\uD56D \uAC80\uD1A0 \uD6C4 \uC801\uC6A9\uD574 \uC8FC\uC138\uC694." }) : null, _jsxs("div", { className: styles.actions, children: [_jsx(Button, { onPress: () => importMutation.mutate(), isDisabled: !manifestImportAllowed || importMutation.isPending || !source.trim(), children: importMutation.isPending ? "가져오는 중…" : "Manifest를 초안으로 가져오기" }), _jsx(Button, { variant: "quiet", onPress: () => setSource(manifest.data.serialized), isDisabled: importMutation.isPending, children: "\uC11C\uBC84 \uC6D0\uBCF8\uC73C\uB85C \uB418\uB3CC\uB9AC\uAE30" })] })] })) : null, generated.isPending ? _jsx(PageLoading, { label: "TypeScript \uD0C0\uC785\uC744 \uC0DD\uC131\uD558\uB294 \uC911" }) : null, generated.isError ? _jsx(LoadError, { error: generated.error, onRetry: () => void generated.refetch() }) : null, generated.data ? (_jsxs("section", { className: styles.snapshotCard, children: [_jsxs("div", { className: styles.snapshotHeader, children: [_jsxs("div", { children: [_jsx("h2", { children: "Generated TypeScript" }), _jsx("p", { children: "\uB3D9\uC77C\uD55C manifest\uB294 \uD56D\uC0C1 \uB3D9\uC77C\uD55C \uD0C0\uC785\uACFC hash\uB97C \uB9CC\uB4ED\uB2C8\uB2E4." })] }), _jsxs("code", { children: [generated.data.fileName, " \u00B7 ", generated.data.hash.slice(0, 12)] })] }), _jsx("pre", { className: styles.snapshot, children: generated.data.source }), _jsxs("div", { className: styles.actions, children: [_jsx(Button, { variant: "secondary", onPress: () => downloadText(generated.data.fileName, generated.data.source, "text/typescript"), children: "TypeScript \uC800\uC7A5" }), _jsx(Button, { variant: "quiet", onPress: () => void navigator.clipboard?.writeText(generated.data.source), children: "\uD074\uB9BD\uBCF4\uB4DC \uBCF5\uC0AC" })] })] })) : null, _jsx(UnsavedChangesGuard, { when: manifest.data !== undefined && source !== manifest.data.serialized && !importMutation.isPending })] }));
}
//# sourceMappingURL=schema-tools-page.js.map