import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toAdminApiError, useAdminApi, } from "@xecms/admin";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Page, PageHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";
import styles from "../jobs.module.css";
const statuses = [
    { value: "", label: "모든 상태" },
    { value: "pending", label: "대기" },
    { value: "processing", label: "처리 중" },
    { value: "succeeded", label: "성공" },
    { value: "dead", label: "실패 종료" },
];
export function JobsPage() {
    const api = useAdminApi();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState("");
    const [topic, setTopic] = useState("");
    const [handlerId, setHandlerId] = useState("");
    const [selected, setSelected] = useState(null);
    const jobs = useQuery({
        queryKey: queryKeys.jobs(page, status, topic, handlerId),
        queryFn: () => api.jobs.list({ page, pageSize: 25,
            ...(status === "" ? {} : { status }), ...(topic === "" ? {} : { topic }),
            ...(handlerId === "" ? {} : { handlerId }) }),
        refetchInterval: 5_000,
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["jobs"] });
    const run = useMutation({ mutationFn: () => api.jobs.run(), onSuccess: refresh });
    const retry = useMutation({
        mutationFn: (id) => api.jobs.retry(id),
        onSuccess: async (next) => { setSelected(next); await refresh(); },
    });
    if (jobs.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uC774\uBCA4\uD2B8 \uC791\uC5C5\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (jobs.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: jobs.error, onRetry: () => void jobs.refetch() }) });
    const converted = run.error || retry.error ? toAdminApiError(run.error ?? retry.error) : null;
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Durable event worker", title: "\uC774\uBCA4\uD2B8 \uC791\uC5C5", description: "Transactional Outbox\uC5D0\uC11C fan-out\uB41C Handler delivery\uC640 \uC7AC\uC2DC\uB3C4 \uC0C1\uD0DC\uB97C \uAD00\uB9AC\uD569\uB2C8\uB2E4.", actions: _jsx(Button, { onPress: () => run.mutate(), isDisabled: run.isPending, children: run.isPending ? "실행 중…" : "Worker 한 번 실행" }) }), _jsx("div", { className: styles.summary, children: statuses.filter(({ value }) => value !== "").map(({ value, label }) => _jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: jobs.data.counts[value] })] }, value)) }), run.data ? _jsxs(Callout, { tone: "success", children: ["Claim ", run.data.claimed, " \u00B7 \uC131\uACF5 ", run.data.succeeded, " \u00B7 \uC7AC\uC2DC\uB3C4 ", run.data.failed, " \u00B7 Dead ", run.data.dead] }) : null, converted ? _jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: converted.message }), " ", _jsx("code", { children: converted.code })] }) : null, _jsxs("section", { className: styles.filters, "aria-label": "\uC791\uC5C5 \uD544\uD130", children: [_jsxs("label", { children: [_jsx("span", { children: "\uC0C1\uD0DC" }), _jsx("select", { value: status, onChange: (event) => { setPage(1); setStatus(event.target.value); }, children: statuses.map((item) => _jsx("option", { value: item.value, children: item.label }, item.value)) })] }), _jsxs("label", { children: [_jsx("span", { children: "Topic" }), _jsx("input", { value: topic, placeholder: "document.created", onChange: (event) => { setPage(1); setTopic(event.target.value); } })] }), _jsxs("label", { children: [_jsx("span", { children: "Handler" }), _jsx("input", { value: handlerId, placeholder: "core.search-projection", onChange: (event) => { setPage(1); setHandlerId(event.target.value); } })] })] }), jobs.data.items.length === 0 ? _jsx(EmptyState, { title: "\uD45C\uC2DC\uD560 \uC774\uBCA4\uD2B8 \uC791\uC5C5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uCF58\uD150\uCE20\uB97C \uBCC0\uACBD\uD558\uBA74 commit\uACFC \uD568\uAED8 Outbox Event\uAC00 \uB9CC\uB4E4\uC5B4\uC9D1\uB2C8\uB2E4." }) : (_jsxs("div", { className: styles.layout, children: [_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\uC0C1\uD0DC" }), _jsx("th", { children: "Topic / Handler" }), _jsx("th", { children: "\uC2DC\uB3C4" }), _jsx("th", { children: "\uB2E4\uC74C \uC2E4\uD589" }), _jsx("th", {})] }) }), _jsx("tbody", { children: jobs.data.items.map((job) => _jsxs("tr", { "data-selected": selected?.id === job.id, children: [_jsx("td", { children: _jsx(StatusBadge, { status: job.status }) }), _jsxs("td", { children: [_jsx("strong", { children: job.topic }), _jsx("code", { children: job.handlerId })] }), _jsxs("td", { children: [job.attempts, "/", job.maxAttempts] }), _jsx("td", { children: formatTime(job.availableAt) }), _jsx("td", { children: _jsx(Button, { size: "small", variant: "quiet", onPress: () => setSelected(job), children: "\uC0C1\uC138" }) })] }, job.id)) })] }) }), _jsx(JobDetail, { job: selected, isPending: retry.isPending, onRetry: (id) => retry.mutate(id) })] })), _jsxs("div", { className: styles.pagination, children: [_jsx(Button, { variant: "quiet", isDisabled: page <= 1, onPress: () => setPage((value) => value - 1), children: "\uC774\uC804" }), _jsxs("span", { children: [page, " / ", Math.max(1, Math.ceil(jobs.data.total / jobs.data.pageSize))] }), _jsx(Button, { variant: "quiet", isDisabled: page * jobs.data.pageSize >= jobs.data.total, onPress: () => setPage((value) => value + 1), children: "\uB2E4\uC74C" })] })] }));
}
function JobDetail({ job, onRetry, isPending }) {
    if (job === null)
        return _jsx("section", { className: styles.detail, children: _jsx(EmptyState, { title: "\uC791\uC5C5\uC744 \uC120\uD0DD\uD558\uC138\uC694", description: "Event envelope, lease\uC640 \uC624\uB958 \uC815\uBCF4\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) });
    const retryable = job.status === "dead" || job.status === "pending";
    return _jsxs("section", { className: styles.detail, "aria-label": "\uC774\uBCA4\uD2B8 \uC791\uC5C5 \uC0C1\uC138", children: [_jsxs("div", { className: styles.detailHeader, children: [_jsxs("div", { children: [_jsx(StatusBadge, { status: job.status }), _jsx("h2", { children: job.topic })] }), retryable ? _jsx(Button, { variant: job.status === "dead" ? "danger" : "secondary", isDisabled: isPending, onPress: () => onRetry(job.id), children: "\uC7AC\uC2DC\uB3C4 \uCD08\uAE30\uD654" }) : null] }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "Delivery" }), _jsx("dd", { children: _jsx("code", { children: job.id }) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Event" }), _jsx("dd", { children: _jsx("code", { children: job.eventId }) })] }), _jsxs("div", { children: [_jsx("dt", { children: "Aggregate" }), _jsxs("dd", { children: [job.event.aggregate.type, " \u00B7 ", _jsx("code", { children: job.event.aggregate.id })] })] }), _jsxs("div", { children: [_jsx("dt", { children: "Lease" }), _jsx("dd", { children: job.lockedBy ? `${job.lockedBy} · ${formatTime(job.lockedUntil)}` : "없음" })] })] }), job.lastErrorMessage ? _jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: job.lastErrorCode }), _jsx("div", { children: job.lastErrorMessage })] }) : null, _jsxs("details", { children: [_jsx("summary", { children: "Event payload" }), _jsx("pre", { children: JSON.stringify(job.event.payload, null, 2) })] })] });
}
function StatusBadge({ status }) {
    const tone = status === "succeeded" ? "success" : status === "dead" ? "danger" : status === "processing" ? "info" : "warning";
    return _jsx(Badge, { tone: tone, children: status });
}
function formatTime(value) { return value ? new Date(value).toLocaleString("ko-KR") : "—"; }
//# sourceMappingURL=jobs-page.js.map