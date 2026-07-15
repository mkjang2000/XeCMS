import { describe, expect, it, vi } from "vitest";
import { WorkspaceSettingsService, type WorkspaceSettingsStore } from "./site-settings.js";

describe("WorkspaceSettingsService", () => {
  it("canonicalizes locale and validates timezone before CAS persistence", async () => {
    const update = vi.fn(async (input) => ({ id: input.workspaceId, displayName: input.displayName,
      defaultTimezone: input.defaultTimezone, adminLocale: input.adminLocale, revision: 2,
      updatedAt: input.now, updatedBy: input.actorIdentityId }));
    const store = { get: vi.fn(), update } as unknown as WorkspaceSettingsStore;
    const service = new WorkspaceSettingsService(store, () => "2026-07-15T15:00:00.000Z");
    await expect(service.update({ workspaceId: "wrk_default", expectedRevision: 1,
      displayName: "  Editorial  ", defaultTimezone: "Asia/Seoul", adminLocale: "ko-kr",
      actorIdentityId: "owner", actorSubjectId: "subject-owner" })).resolves.toMatchObject({ displayName: "Editorial", adminLocale: "ko-KR" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Editorial", adminLocale: "ko-KR" }));
  });

  it("rejects invalid timezone without writing", async () => {
    const update = vi.fn();
    const service = new WorkspaceSettingsService({ get: vi.fn(), update } as unknown as WorkspaceSettingsStore, () => new Date().toISOString());
    await expect(service.update({ workspaceId: "wrk_default", expectedRevision: 1,
      displayName: "Workspace", defaultTimezone: "Mars/Olympus", adminLocale: "ko-KR",
      actorIdentityId: "owner", actorSubjectId: "subject-owner" })).rejects.toMatchObject({ code: "WORKSPACE_SETTINGS_INVALID" });
    expect(update).not.toHaveBeenCalled();
  });
});
