import { ApplicationError } from "./errors.js";

export interface WorkspaceSettings {
  readonly id: string; readonly displayName: string; readonly defaultTimezone: string;
  readonly adminLocale: string; readonly revision: number; readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface WorkspaceSettingsStore {
  get(workspaceId: string): Promise<WorkspaceSettings | null>;
  update(input: {
    readonly workspaceId: string; readonly expectedRevision: number; readonly displayName: string;
    readonly defaultTimezone: string; readonly adminLocale: string; readonly actorIdentityId: string;
    readonly actorSubjectId: string; readonly now: string;
  }): Promise<WorkspaceSettings>;
}

export class WorkspaceSettingsService {
  public constructor(private readonly store: WorkspaceSettingsStore, private readonly now: () => string) {}
  public async get(workspaceId: string): Promise<WorkspaceSettings> {
    const record = await this.store.get(workspaceId);
    if (record === null) throw new ApplicationError("WORKSPACE_NOT_FOUND", 404, "The Workspace does not exist.");
    return record;
  }
  public async update(input: {
    readonly workspaceId: string; readonly expectedRevision: number; readonly displayName: string;
    readonly defaultTimezone: string; readonly adminLocale: string; readonly actorIdentityId: string;
    readonly actorSubjectId: string;
  }): Promise<WorkspaceSettings> {
    const displayName = input.displayName.normalize("NFKC").trim();
    if (displayName.length < 1 || displayName.length > 120) invalid("displayName");
    try { new Intl.DateTimeFormat("en", { timeZone: input.defaultTimezone }).format(); }
    catch { invalid("defaultTimezone"); }
    let adminLocale: string;
    try { adminLocale = Intl.getCanonicalLocales(input.adminLocale)[0] ?? ""; }
    catch { invalid("adminLocale"); }
    if (adminLocale.length === 0) invalid("adminLocale");
    return await this.store.update({ ...input, displayName, adminLocale, now: this.now() });
  }
}

function invalid(field: string): never {
  throw new ApplicationError("WORKSPACE_SETTINGS_INVALID", 422, `Workspace ${field} is invalid.`);
}
