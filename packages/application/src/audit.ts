import { ApplicationError } from "./errors.js";

export type UnifiedAuditSource = "system" | "document" | "authorization" | "delivery";
export type UnifiedAuditCategory = "security" | "identity" | "content" | "schema"
  | "authorization" | "settings" | "site" | "worker" | "media" | "retention" | "plugin";
export type UnifiedAuditOutcome = "succeeded" | "failed" | "denied" | "informational";

export interface UnifiedAuditEntry {
  readonly id: string;
  readonly source: UnifiedAuditSource;
  readonly sourceId: string;
  readonly category: UnifiedAuditCategory;
  readonly action: string;
  readonly outcome: UnifiedAuditOutcome;
  readonly workspaceId: string;
  readonly realmId?: string;
  readonly siteId?: string;
  readonly actorIdentityId?: string;
  readonly actorSubjectId?: string;
  readonly actorLabel?: string;
  readonly targetType: string;
  readonly targetId?: string;
  readonly summary: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly requestId?: string;
  readonly occurredAt: string;
}

export interface UnifiedAuditFilter {
  readonly category?: UnifiedAuditCategory;
  readonly source?: UnifiedAuditSource;
  readonly action?: string;
  readonly actorId?: string;
  readonly targetId?: string;
  readonly realmId?: string;
  readonly siteId?: string;
  readonly outcome?: UnifiedAuditOutcome;
  readonly from?: string;
  readonly to?: string;
}

export interface UnifiedAuditCursorPosition {
  readonly occurredAt: string;
  readonly sourceRank: number;
  readonly sortId: string;
}

export interface StoredUnifiedAuditEntry extends Omit<UnifiedAuditEntry, "id" | "before" | "after" | "metadata"> {
  readonly sourceRank: number;
  readonly sortId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UnifiedAuditStore {
  list(input: UnifiedAuditFilter & {
    readonly workspaceId: string;
    readonly cursor?: UnifiedAuditCursorPosition;
    readonly limit: number;
  }): Promise<{ readonly items: readonly StoredUnifiedAuditEntry[]; readonly hasMore: boolean }>;
  get(input: { readonly workspaceId: string; readonly source: UnifiedAuditSource;
    readonly sourceId: string }): Promise<StoredUnifiedAuditEntry | null>;
}

export interface UnifiedAuditPage {
  readonly items: readonly UnifiedAuditEntry[];
  readonly nextCursor?: string;
}

export class UnifiedAuditService {
  public constructor(private readonly store: UnifiedAuditStore) {}

  public async list(input: UnifiedAuditFilter & {
    readonly workspaceId: string; readonly cursor?: string; readonly limit?: number;
  }): Promise<UnifiedAuditPage> {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) invalid("Audit limit must be between 1 and 200.");
    validateFilter(input, 366);
    const { cursor: rawCursor, limit: _requestedLimit, ...filter } = input;
    const cursor = rawCursor === undefined ? undefined : decodeAuditCursor(rawCursor);
    const page = await this.store.list({ ...filter, limit, ...(cursor === undefined ? {} : { cursor }) });
    const items = page.items.map(publicEntry);
    const last = page.items.at(-1);
    return {
      items,
      ...(page.hasMore && last !== undefined ? { nextCursor: encodeAuditCursor({
        occurredAt: last.occurredAt,
        sourceRank: last.sourceRank,
        sortId: last.sortId,
      }) } : {}),
    };
  }

  public async get(workspaceId: string, entryId: string): Promise<UnifiedAuditEntry> {
    const separator = entryId.indexOf(":");
    if (separator < 1) invalid("Audit entry ID is invalid.");
    const source = entryId.slice(0, separator);
    const sourceId = entryId.slice(separator + 1);
    if (!isSource(source) || sourceId.length < 1 || sourceId.length > 300) invalid("Audit entry ID is invalid.");
    const entry = await this.store.get({ workspaceId, source, sourceId });
    if (entry === null) throw new ApplicationError("AUDIT_ENTRY_NOT_FOUND", 404, "The Audit entry does not exist.");
    return publicEntry(entry);
  }

  public async export(input: UnifiedAuditFilter & { readonly workspaceId: string }): Promise<string> {
    validateFilter(input, 90, true);
    const lines: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...input, ...(cursor === undefined ? {} : { cursor }), limit: 200 });
      for (const entry of page.items) {
        lines.push(JSON.stringify(entry));
        if (lines.length > 50_000) {
          throw new ApplicationError("AUDIT_EXPORT_TOO_LARGE", 413, "Audit export exceeds 50,000 entries.");
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  }
}

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value as Readonly<Record<string, unknown>>)) {
    if (sensitiveKey(key)) output[key] = "[REDACTED]";
    else if (normalizeKey(key) === "errormessage" && typeof member === "string") {
      output[key] = member.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
    } else output[key] = redactAuditValue(member);
  }
  return output;
}

function publicEntry(entry: StoredUnifiedAuditEntry): UnifiedAuditEntry {
  return {
    id: `${entry.source}:${entry.sourceId}`,
    source: entry.source,
    sourceId: entry.sourceId,
    category: entry.category,
    action: entry.action,
    outcome: entry.outcome,
    workspaceId: entry.workspaceId,
    ...(entry.realmId === undefined ? {} : { realmId: entry.realmId }),
    ...(entry.siteId === undefined ? {} : { siteId: entry.siteId }),
    ...(entry.actorIdentityId === undefined ? {} : { actorIdentityId: entry.actorIdentityId }),
    ...(entry.actorSubjectId === undefined ? {} : { actorSubjectId: entry.actorSubjectId }),
    ...(entry.actorLabel === undefined ? {} : { actorLabel: entry.actorLabel }),
    targetType: entry.targetType,
    ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
    summary: entry.summary,
    ...(entry.before === undefined || entry.before === null ? {} : { before: redactAuditValue(entry.before) }),
    ...(entry.after === undefined || entry.after === null ? {} : { after: redactAuditValue(entry.after) }),
    ...(entry.metadata === undefined ? {} : {
      metadata: redactAuditValue(entry.metadata) as Readonly<Record<string, unknown>>,
    }),
    ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
    occurredAt: entry.occurredAt,
  };
}

function validateFilter(input: UnifiedAuditFilter, maxDays: number, requireRange = false): void {
  const from = input.from === undefined ? undefined : validInstant(input.from);
  const to = input.to === undefined ? undefined : validInstant(input.to);
  if (requireRange && (from === undefined || to === undefined)) {
    invalid("Audit export requires from and to timestamps.");
  }
  if (from !== undefined && to !== undefined) {
    if (from >= to) invalid("Audit from must be earlier than to.");
    if (to - from > maxDays * 86_400_000) invalid(`Audit range cannot exceed ${maxDays} days.`);
  }
  for (const value of [input.action, input.actorId, input.targetId, input.realmId, input.siteId]) {
    if (value !== undefined && (value.trim() === "" || value.length > 300)) invalid("Audit filter is invalid.");
  }
}

function validInstant(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalid("Audit timestamp is invalid.");
  return time;
}

function encodeAuditCursor(value: UnifiedAuditCursorPosition): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeAuditCursor(value: string): UnifiedAuditCursorPosition {
  if (value.length < 4 || value.length > 1000) invalid("Audit cursor is invalid.");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (Object.keys(parsed).some((key) => !["occurredAt", "sourceRank", "sortId"].includes(key)) ||
      typeof parsed["occurredAt"] !== "string" || typeof parsed["sourceRank"] !== "number" ||
      !Number.isInteger(parsed["sourceRank"]) || parsed["sourceRank"] < 1 || parsed["sourceRank"] > 4 ||
      typeof parsed["sortId"] !== "string" || parsed["sortId"].length < 1 || parsed["sortId"].length > 300) {
      invalid("Audit cursor is invalid.");
    }
    validInstant(parsed["occurredAt"]);
    return { occurredAt: parsed["occurredAt"], sourceRank: parsed["sourceRank"], sortId: parsed["sortId"] };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    invalid("Audit cursor is invalid.");
  }
}

function sensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return new Set([
    "password", "passwordhash", "currentpassword", "newpassword", "temporarypassword",
    "secret", "token", "tokenhash", "tokendigest", "session", "cookie", "authorization",
    "apikey", "apikeyhash", "credential", "privatekey", "databaseurl",
  ]).has(normalized) || /(?:password|passwordhash|secret|tokenhash|tokendigest|cookie|privatekey|databaseurl)$/.test(normalized);
}

function normalizeKey(key: string): string { return key.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function isSource(value: string): value is UnifiedAuditSource { return ["system", "document", "authorization", "delivery"].includes(value); }
function invalid(message: string): never { throw new ApplicationError("AUDIT_QUERY_INVALID", 400, message); }
