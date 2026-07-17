import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Callout, ConfirmDialog, EmptyState } from "@xecms/ui";
import { accessAllowed, toAdminApiError, useAdminApi, } from "@xecms/admin";
import { permissionCheck, systemResources, useAccessProfile, } from "../access-profile.js";
import styles from "../app.module.css";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";
const mediaActionChecks = [
    permissionCheck("media.action.upload", "media.upload", systemResources.workspace),
    permissionCheck("media.action.delete", "media.delete", systemResources.workspace),
];
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 ** 2)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
export function MediaPage() {
    const api = useAdminApi();
    const queryClient = useQueryClient();
    const inputRef = useRef(null);
    const [selectedFile, setSelectedFile] = useState();
    const [deleteTarget, setDeleteTarget] = useState();
    const list = useQuery({ queryKey: queryKeys.media, queryFn: () => api.media.list() });
    const accessProfile = useAccessProfile("media-actions", mediaActionChecks);
    const canUpload = accessAllowed(accessProfile.data, "media.action.upload");
    const canDelete = accessAllowed(accessProfile.data, "media.action.delete");
    const consistency = useMutation({ mutationFn: () => api.media.checkConsistency() });
    const upload = useMutation({
        mutationFn: (file) => api.media.upload(file),
        onSuccess: async () => {
            setSelectedFile(undefined);
            if (inputRef.current)
                inputRef.current.value = "";
            await queryClient.invalidateQueries({ queryKey: queryKeys.media });
        },
    });
    const remove = useMutation({
        mutationFn: (mediaId) => api.media.delete(mediaId),
        onSuccess: async () => {
            setDeleteTarget(undefined);
            await queryClient.invalidateQueries({ queryKey: queryKeys.media });
        },
        onError: () => setDeleteTarget(undefined),
    });
    const uploadError = upload.isError ? toAdminApiError(upload.error) : null;
    const removeError = remove.isError ? toAdminApiError(remove.error) : null;
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Asset workspace", title: "\uBBF8\uB514\uC5B4 \uB77C\uC774\uBE0C\uB7EC\uB9AC", description: "\uB85C\uCEEC \uC2A4\uD1A0\uB9AC\uC9C0\uC5D0 \uD30C\uC77C\uC744 \uC2A4\uD2B8\uB9AC\uBC0D \uC5C5\uB85C\uB4DC\uD558\uACE0 \uCF58\uD150\uCE20\uC758 upload \uD544\uB4DC\uC5D0\uC11C stable ID\uB85C \uC5F0\uACB0\uD569\uB2C8\uB2E4.", actions: _jsx(Button, { variant: "secondary", onPress: () => consistency.mutate(), isDisabled: consistency.isPending, children: consistency.isPending ? "검사 중…" : "일관성 검사" }) }), canUpload ? _jsxs("section", { className: styles.mediaUploadCard, "aria-label": "\uBBF8\uB514\uC5B4 \uC5C5\uB85C\uB4DC", children: [_jsxs("label", { className: styles.filePicker, children: [_jsx("span", { className: styles.mediaUploadIcon, children: _jsx(Icon, { name: "media", size: 22 }) }), _jsxs("span", { children: [_jsx("strong", { children: selectedFile?.name ?? "업로드할 파일 선택" }), _jsx("small", { children: selectedFile ? `${selectedFile.type || "application/octet-stream"} · ${formatBytes(selectedFile.size)}` : "크기와 MIME 정책은 서버에서 다시 검증합니다." })] }), _jsx("input", { ref: inputRef, type: "file", onChange: (event) => setSelectedFile(event.target.files?.[0]) })] }), _jsx(Button, { onPress: () => selectedFile && upload.mutate(selectedFile), isDisabled: !selectedFile || upload.isPending, children: upload.isPending ? "업로드 중…" : "파일 업로드" })] }) : null, uploadError ? _jsx(LoadError, { error: uploadError }) : null, removeError ? _jsx(LoadError, { error: removeError }) : null, consistency.isError ? _jsx(LoadError, { error: consistency.error }) : null, consistency.data ? (_jsxs(Callout, { tone: consistency.data.missing.length || consistency.data.orphanStorageKeys.length || consistency.data.incomplete.length ? "warning" : "success", children: ["\uC815\uC0C1 ", consistency.data.healthyCount, "\uAC1C \u00B7 \uB204\uB77D \uD30C\uC77C ", consistency.data.missing.length, "\uAC1C \u00B7 \uACE0\uC544 \uD30C\uC77C ", consistency.data.orphanStorageKeys.length, "\uAC1C \u00B7 \uBBF8\uC644\uB8CC \uBA54\uD0C0\uB370\uC774\uD130 ", consistency.data.incomplete.length, "\uAC1C", consistency.data.missing.length ? ` · 누락 ID: ${consistency.data.missing.map(({ id }) => id).join(", ")}` : "", consistency.data.orphanStorageKeys.length ? ` · 고아 key: ${consistency.data.orphanStorageKeys.join(", ")}` : "", consistency.data.incomplete.length ? ` · 미완료 ID: ${consistency.data.incomplete.map(({ id }) => id).join(", ")}` : ""] })) : null, list.isPending ? _jsx(PageLoading, { label: "\uBBF8\uB514\uC5B4\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, list.isError ? _jsx(LoadError, { error: list.error, onRetry: () => void list.refetch() }) : null, list.data?.items.length === 0 ? _jsx(EmptyState, { title: "\uC544\uC9C1 \uC5C5\uB85C\uB4DC\uD55C \uD30C\uC77C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uCCAB \uD30C\uC77C\uC744 \uC5C5\uB85C\uB4DC\uD558\uBA74 \uCF58\uD150\uCE20 \uD3B8\uC9D1\uAE30\uC5D0\uC11C \uBC14\uB85C \uC120\uD0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) : null, list.data?.items.length ? (_jsx("div", { className: styles.mediaGrid, children: list.data.items.map((item) => (_jsxs("article", { className: styles.mediaCard, children: [_jsx("div", { className: styles.mediaPreview, children: item.mimeType.startsWith("image/") && item.status === "available"
                                ? _jsx("img", { src: item.contentUrl, alt: "", loading: "lazy" })
                                : _jsx(Icon, { name: "media", size: 30 }) }), _jsxs("div", { className: styles.mediaInfo, children: [_jsxs("div", { className: styles.mediaTitle, children: [_jsx("strong", { title: item.fileName, children: item.fileName }), _jsx(Badge, { tone: item.status === "available" ? "success" : "warning", children: item.status === "available" ? "사용 가능" : "파일 누락" })] }), _jsxs("span", { children: [item.mimeType, " \u00B7 ", formatBytes(item.size)] }), _jsx("code", { children: item.id })] }), _jsxs("div", { className: styles.mediaActions, children: [_jsx("a", { href: item.contentUrl, target: "_blank", rel: "noreferrer", children: "\uC6D0\uBCF8 \uC5F4\uAE30" }), canDelete ? _jsx(Button, { variant: "quiet", size: "small", onPress: () => setDeleteTarget(item), children: "\uC0AD\uC81C" }) : null] })] }, item.id))) })) : null, deleteTarget ? (_jsxs(ConfirmDialog, { title: "\uBBF8\uB514\uC5B4 \uC0AD\uC81C", confirmLabel: "\uC0AD\uC81C", danger: true, isPending: remove.isPending, onCancel: () => setDeleteTarget(undefined), onConfirm: () => remove.mutate(deleteTarget.id), children: [_jsx("strong", { children: deleteTarget.fileName }), " \uD30C\uC77C\uC744 \uC0AD\uC81C\uD569\uB2C8\uB2E4. \uCF58\uD150\uCE20\uC5D0\uC11C \uCC38\uC870 \uC911\uC774\uBA74 \uC11C\uBC84 \uC815\uCC45\uC5D0 \uB530\uB77C \uC0AD\uC81C\uAC00 \uCC28\uB2E8\uB429\uB2C8\uB2E4."] })) : null] }));
}
//# sourceMappingURL=media-page.js.map