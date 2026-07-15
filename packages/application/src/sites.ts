import { ApplicationError } from "./errors.js";

export type SiteStatus = "active" | "archived";
export interface SiteRecord {
  readonly id: string; readonly workspaceId: string; readonly key: string; readonly name: string;
  readonly canonicalUrl?: string; readonly status: SiteStatus; readonly isDefault: boolean;
  readonly revision: number; readonly createdAt: string; readonly createdBy: string;
  readonly updatedAt: string; readonly updatedBy: string; readonly archivedAt?: string;
  readonly collectionIds: readonly string[];
}
export interface SiteStore {
  list(workspaceId: string): Promise<readonly SiteRecord[]>;
  get(siteId: string, workspaceId: string): Promise<SiteRecord | null>;
  create(input: { readonly id: string; readonly workspaceId: string; readonly key: string;
    readonly name: string; readonly canonicalUrl?: string; readonly actorIdentityId: string;
    readonly actorSubjectId: string; readonly now: string; }): Promise<SiteRecord>;
  update(input: { readonly siteId: string; readonly workspaceId: string; readonly expectedRevision: number;
    readonly name: string; readonly canonicalUrl?: string; readonly actorIdentityId: string;
    readonly actorSubjectId: string; readonly now: string; }): Promise<SiteRecord>;
  setArchived(input: { readonly siteId: string; readonly workspaceId: string; readonly expectedRevision: number;
    readonly archived: boolean; readonly replacementDefaultSiteId?: string;
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string; }): Promise<SiteRecord>;
  setDefault(input: { readonly siteId: string; readonly workspaceId: string; readonly expectedRevision: number;
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string; }): Promise<SiteRecord>;
  bindCollection(input: { readonly siteId: string; readonly workspaceId: string; readonly collectionId: string;
    readonly expectedSiteRevision: number; readonly expectedPolicyRevision: number;
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string; }): Promise<SiteRecord>;
  unbindCollection(input: { readonly siteId: string; readonly workspaceId: string; readonly collectionId: string;
    readonly expectedSiteRevision: number; readonly expectedPolicyRevision: number;
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string; }): Promise<SiteRecord>;
  assertCollectionWritable(workspaceId: string, collectionId: string): Promise<void>;
  reconcileCollections(input: { readonly workspaceId: string; readonly activeCollectionIds: readonly string[];
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string }): Promise<void>;
}
export interface SiteRuntime { readonly now: () => string; readonly newSiteId: () => string; }

export class SiteService {
  public constructor(private readonly store: SiteStore, private readonly runtime: SiteRuntime) {}
  public list(workspaceId: string) { return this.store.list(workspaceId); }
  public async get(siteId: string, workspaceId: string): Promise<SiteRecord> {
    const site = await this.store.get(siteId, workspaceId);
    if (site === null) throw new ApplicationError("SITE_NOT_FOUND", 404, "The Site does not exist.");
    return site;
  }
  public create(input: { readonly workspaceId: string; readonly key: string; readonly name: string;
    readonly canonicalUrl?: string; readonly actorIdentityId: string; readonly actorSubjectId: string }) {
    const key = input.key.normalize("NFKC").trim();
    if (!/^[a-z](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(key)) invalid("key");
    const name = validName(input.name); const canonicalUrl = validUrl(input.canonicalUrl);
    return this.store.create({ ...input, id: this.runtime.newSiteId(), key, name,
      ...(canonicalUrl === undefined ? {} : { canonicalUrl }), now: this.runtime.now() });
  }
  public update(input: { readonly siteId: string; readonly workspaceId: string; readonly expectedRevision: number;
    readonly name: string; readonly canonicalUrl?: string; readonly actorIdentityId: string;
    readonly actorSubjectId: string }) {
    const name = validName(input.name); const canonicalUrl = validUrl(input.canonicalUrl);
    return this.store.update({ ...input, name, ...(canonicalUrl === undefined ? {} : { canonicalUrl }), now: this.runtime.now() });
  }
  public setArchived(input: Omit<Parameters<SiteStore["setArchived"]>[0], "now">) {
    return this.store.setArchived({ ...input, now: this.runtime.now() });
  }
  public setDefault(input: Omit<Parameters<SiteStore["setDefault"]>[0], "now">) {
    return this.store.setDefault({ ...input, now: this.runtime.now() });
  }
  public bindCollection(input: Omit<Parameters<SiteStore["bindCollection"]>[0], "now">) {
    return this.store.bindCollection({ ...input, now: this.runtime.now() });
  }
  public unbindCollection(input: Omit<Parameters<SiteStore["unbindCollection"]>[0], "now">) {
    return this.store.unbindCollection({ ...input, now: this.runtime.now() });
  }
  public assertCollectionWritable(workspaceId: string, collectionId: string) {
    return this.store.assertCollectionWritable(workspaceId, collectionId);
  }
  public reconcileCollections(input: Omit<Parameters<SiteStore["reconcileCollections"]>[0], "now">) {
    return this.store.reconcileCollections({ ...input, now: this.runtime.now() });
  }
}
function validName(value: string): string { const name = value.normalize("NFKC").trim(); if (name.length < 1 || name.length > 120) invalid("name"); return name; }
function validUrl(value?: string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  let url: URL; try { url = new URL(value.trim()); } catch { invalid("canonicalUrl"); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) invalid("canonicalUrl");
  return url.origin;
}
function invalid(field: string): never { throw new ApplicationError("SITE_INPUT_INVALID", 422, `Site ${field} is invalid.`); }
