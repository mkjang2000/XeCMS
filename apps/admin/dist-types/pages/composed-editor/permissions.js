/** Maps a built-in Action id to the content permission the server enforces. */
export function builtInActionPermission(actionId) {
    switch (actionId) {
        case "core.action.create": return "content.create";
        case "core.action.update": return "content.update";
        case "core.action.delete": return "content.delete";
        case "core.action.archive": return "content.archive";
        case "core.action.restore": return "content.restore";
        case "core.action.publish": return "content.publish";
        case "core.action.unpublish": return "content.unpublish";
        default: return null;
    }
}
/**
 * The distinct content permissions a Composed Page's Actions require, for the
 * Builder's Role Preview. This mirrors the server's gate derivation so an App
 * author can see, before publishing, which permissions a Role needs — the
 * server remains the authority and re-checks every mutation.
 */
export function requiredPermissions(page) {
    const seen = new Set();
    const result = [];
    const events = [
        ...(page.events ?? []),
        ...page.components.flatMap((component) => component.events ?? []),
    ];
    for (const event of events) {
        for (const effect of event.effects) {
            if (effect.kind !== "action.execute")
                continue;
            const actionId = effect.args?.["actionId"];
            if (typeof actionId !== "string")
                continue;
            const permission = builtInActionPermission(actionId);
            if (permission === null)
                continue;
            const collectionId = effect.args?.["collectionId"];
            const key = `${permission}:${typeof collectionId === "string" ? collectionId : ""}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            result.push({
                permission,
                actionId,
                ...(typeof collectionId === "string" && collectionId !== "" ? { collectionId } : {}),
            });
        }
    }
    return result;
}
//# sourceMappingURL=permissions.js.map