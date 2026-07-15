import { describe, expect, it, vi } from "vitest";
import {
  UnifiedAuditService,
  redactAuditValue,
  type StoredUnifiedAuditEntry,
  type UnifiedAuditStore,
} from "./audit.js";

const entry: StoredUnifiedAuditEntry = {
  source: "system",
  sourceRank: 1,
  sortId: "00000000000000000042",
  sourceId: "42",
  category: "security",
  action: "login.failed",
  outcome: "failed",
  workspaceId: "wrk_default",
  actorLabel: "admin",
  targetType: "identity",
  targetId: "usr_admin",
  summary: "login.failed",
  metadata: {
    username: "admin",
    currentPassword: "must-not-leak",
    nested: { token_digest: "digest", errorMessage: `bad\u0000${"x".repeat(600)}` },
  },
  occurredAt: "2026-07-15T12:00:00.000Z",
};

describe("UnifiedAuditService", () => {
  it("redacts sensitive values recursively while retaining public identifiers", () => {
    expect(redactAuditValue(entry.metadata)).toEqual({
      username: "admin",
      currentPassword: "[REDACTED]",
      nested: { token_digest: "[REDACTED]", errorMessage: expect.not.stringContaining("\u0000") },
    });
    const message = (redactAuditValue(entry.metadata) as any).nested.errorMessage as string;
    expect(message).toHaveLength(500);
  });

  it("returns an opaque keyset cursor and decodes it for the next page", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [entry], hasMore: true })
      .mockResolvedValueOnce({ items: [], hasMore: false });
    const service = new UnifiedAuditService({ list, get: vi.fn() } as unknown as UnifiedAuditStore);
    const first = await service.list({ workspaceId: "wrk_default", limit: 1 });
    expect(first.items[0]).toMatchObject({ id: "system:42", metadata: { currentPassword: "[REDACTED]" } });
    expect(first.nextCursor).toBeDefined();
    await service.list({ workspaceId: "wrk_default", cursor: first.nextCursor!, limit: 1 });
    expect(list.mock.calls[1]?.[0]).toMatchObject({ cursor: {
      occurredAt: entry.occurredAt, sourceRank: 1, sortId: entry.sortId,
    } });
  });

  it("requires a bounded 90-day range for export", async () => {
    const service = new UnifiedAuditService({
      list: vi.fn().mockResolvedValue({ items: [], hasMore: false }), get: vi.fn(),
    });
    await expect(service.export({ workspaceId: "wrk_default" }))
      .rejects.toMatchObject({ code: "AUDIT_QUERY_INVALID" });
    await expect(service.export({ workspaceId: "wrk_default",
      from: "2026-01-01T00:00:00.000Z", to: "2026-05-01T00:00:00.000Z" }))
      .rejects.toMatchObject({ code: "AUDIT_QUERY_INVALID" });
  });
});
