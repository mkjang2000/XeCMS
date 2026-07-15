const dateFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
export function formatAdminDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : value;
}
export function documentTitle(document, collection) {
    const titleField = collection.fields.find(({ type }) => type === "text");
    const value = titleField ? document.data[titleField.name] : undefined;
    return typeof value === "string" && value.trim() ? value : `문서 ${document.id}`;
}
export function decideDocumentFormSync(input) {
    if (input.initializedRouteKey !== input.routeKey)
        return "initialize";
    if (input.isNew ||
        input.remoteVersion === undefined ||
        input.loadedVersion === input.remoteVersion) {
        return "keep";
    }
    return input.isDirty ? "conflict" : "reset";
}
//# sourceMappingURL=document-presentation.js.map