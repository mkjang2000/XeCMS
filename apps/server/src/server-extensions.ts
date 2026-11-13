import { createReadStream, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  ActorContext, AuthorizationApplicationService, DocumentQueryInput,
} from "@xecms/application";
import type {
  DocumentTreeDto, MediaListDto, MediaRecordDto, MoveDocumentPreviewDto, MoveDocumentResultDto,
} from "@xecms/contracts";
import type { PostgresDatabase } from "@xecms/database";
import type { SchemaIrV1 } from "@xecms/schema";

export type ExtensionAudience = { readonly type: "system" }
  | { readonly type: "content-realm"; readonly realmId: string };

export interface AuthenticatedExtensionAudience {
  readonly actor: ActorContext;
  readonly user: {
    readonly identityId: string; readonly subjectId: string; readonly displayName: string;
    readonly realmId: string; readonly realmKey?: string;
  };
  readonly audienceHint: { readonly type: "system" }
    | { readonly type: "content-realm"; readonly realmId: string; readonly realmKey: string; readonly name: string };
}

/** Authorized content operations shared with trusted server extensions. */
export interface ExtensionContentOperations {
  tree(actor: ActorContext, collectionId: string): Promise<DocumentTreeDto>;
  query(actor: ActorContext, collectionId: string, input: DocumentQueryInput): Promise<{
    readonly items: readonly { readonly id: string; readonly data: Readonly<Record<string, unknown>> }[];
    readonly hasNextPage: boolean; readonly nextCursor?: string;
  }>;
  aggregate(actor: ActorContext, collectionId: string, input: DocumentQueryInput): Promise<{
    readonly groups: readonly { readonly group: string | number | boolean | null; readonly value: number }[];
    readonly truncated: boolean;
  }>;
  getDocument(actor: ActorContext, collectionId: string, documentId: string): Promise<{
    readonly id: string; readonly version: number; readonly data: Readonly<Record<string, unknown>>;
  } | null>;
  previewMove(actor: ActorContext, collectionId: string, documentId: string, body: unknown): Promise<MoveDocumentPreviewDto>;
  move(actor: ActorContext, collectionId: string, documentId: string, body: unknown): Promise<MoveDocumentResultDto>;
  listMedia(actor: ActorContext): Promise<MediaListDto>;
  uploadMedia(actor: ActorContext, input: {
    readonly encodedFileName: string | string[] | undefined;
    readonly contentType: string | undefined; readonly declaredMimeType: string | undefined;
    readonly contentLength: string | undefined; readonly body: unknown;
  }): Promise<MediaRecordDto>;
}

export interface ExtensionPluginSnapshot {
  readonly id: string; readonly version: string; readonly manifestDigest: string;
  readonly installedManifestDigest?: string; readonly installed: boolean;
  readonly enabled: boolean; readonly runtimeLoaded: boolean; readonly extensionIds: ReadonlySet<string>;
}

/** Engine-owned public host contract; no screen models or builder types belong here. */
export interface ServerExtensionContext {
  readonly app: FastifyInstance;
  readonly workspaceId: string;
  readonly database: PostgresDatabase;
  readonly authorization: AuthorizationApplicationService;
  readonly content: ExtensionContentOperations;
  requireActor(request: FastifyRequest, requireCsrf: boolean): Promise<ActorContext>;
  reauthenticate(request: FastifyRequest, actor: ActorContext, password: string): Promise<void>;
  authenticateAudience(request: FastifyRequest, audience: ExtensionAudience, requireCsrf: boolean): Promise<AuthenticatedExtensionAudience>;
  getActiveSchema(): Promise<{ readonly revisionId: string; readonly hash: string; readonly schema: SchemaIrV1 } | null>;
  getPlugin(workspaceId: string, pluginId: string): Promise<ExtensionPluginSnapshot | null>;
}

/** Explicit startup extension. Like existing Plugins, extensions execute trusted server code. */
export interface ServerExtension {
  readonly id: string;
  readonly name: string;
  register(context: ServerExtensionContext): void | Promise<void>;
  readonly rawBodyRoutes?: readonly { readonly method: "POST" | "PUT" | "PATCH"; readonly path: string }[];
  readonly admin?: {
    readonly distDirectory: string; readonly assetPrefix: string; readonly spaRoutes: readonly string[];
    readonly href: string; readonly label: string;
  };
}

export function validateServerExtensions(extensions: readonly ServerExtension[]): void {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const extension of extensions) {
    if (!/^[a-z][a-z0-9-]*$/.test(extension.id) || ids.has(extension.id)) {
      throw new TypeError(`Invalid or duplicate server extension ID '${extension.id}'.`);
    }
    ids.add(extension.id);
    if (!extension.name?.trim() || typeof extension.register !== "function") {
      throw new TypeError(`Server extension '${extension.id}' needs a name and register function.`);
    }
    for (const route of extension.rawBodyRoutes ?? []) {
      const path = decodedLocalPath(route.path);
      if (!["POST", "PUT", "PATCH"].includes(route.method) || path === null || !path.startsWith("/api/")) {
        throw new TypeError(`Invalid raw body route for extension '${extension.id}'.`);
      }
    }
    const admin = extension.admin;
    if (admin === undefined) continue;
    const assetPrefix = decodedLocalPath(admin.assetPrefix);
    if (assetPrefix === null || !assetPrefix.startsWith(`/extensions/${extension.id}/`) || !assetPrefix.endsWith("/")) {
      throw new TypeError(`Assets for '${extension.id}' must use its /extensions/ namespace.`);
    }
    if (!isAbsolute(admin.distDirectory) || !admin.label.trim() || !safeAdminHref(admin.href)) {
      throw new TypeError(`Invalid admin link for extension '${extension.id}'.`);
    }
    for (const route of admin.spaRoutes) {
      const path = decodedLocalPath(route);
      if (path === null || reservedEnginePath(path) || paths.has(path)) {
        throw new TypeError(`Invalid or duplicate extension SPA route '${route}'.`);
      }
      paths.add(path);
    }
  }
}

export function extensionAcceptsRawBody(extensions: readonly ServerExtension[], method: string, url: string): boolean {
  const path = url.split("?", 1)[0]!;
  return extensions.some((extension) => (extension.rawBodyRoutes ?? []).some((route) => {
    if (route.method !== method) return false;
    const expected = route.path.split("/");
    const actual = path.split("/");
    return expected.length === actual.length && expected.every((part, index) => part.startsWith(":")
      ? actual[index] !== "" : part === actual[index]);
  }));
}

export async function registerServerExtensions(extensions: readonly ServerExtension[], context: ServerExtensionContext): Promise<void> {
  context.app.get("/api/extensions", async (request) => {
    await context.requireActor(request, false);
    return { items: extensions.map(({ id, name, admin }) => ({
      id, name, ...(admin === undefined ? {} : { admin: { href: admin.href, label: admin.label } }),
    })) };
  });
  for (const extension of extensions) {
    const admin = extension.admin;
    if (admin !== undefined && !existsSync(join(admin.distDirectory, "index.html"))) {
      throw new Error(`Admin assets for extension '${extension.id}' are missing. Build or install its Admin package, or omit admin metadata for an API-only extension.`);
    }
    await extension.register(context);
    if (admin === undefined) continue;
    await context.app.register(fastifyStatic, {
      root: admin.distDirectory, prefix: admin.assetPrefix, decorateReply: false, wildcard: false,
    });
    for (const route of admin.spaRoutes) {
      context.app.get(route, async (_request, reply) => {
        reply.header("cache-control", "no-cache").type("text/html");
        return reply.send(createReadStream(join(admin.distDirectory, "index.html")));
      });
    }
  }
}

function decodedLocalPath(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith("/") && !decoded.includes("//") && !/[?#\\]/.test(decoded)
      && !decoded.split("/").some((part) => part === "." || part === "..") ? decoded : null;
  } catch { return null; }
}

// Catch accidental SPA takeover; trusted register() code is not sandboxed.
function reservedEnginePath(path: string): boolean {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  if (["", "/", "/*", "/api", "/admin", "/admin/*"].includes(normalized)) return true;
  if (normalized.startsWith("/api/")) return true;
  return ["/admin/setup", "/admin/login", "/admin/password-change"].some((reserved) =>
    normalized === reserved || normalized.startsWith(`${reserved}/`));
}

function safeAdminHref(value: string): boolean {
  if (value.startsWith("/")) return decodedLocalPath(value) !== null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && decodedLocalPath(url.pathname) !== null;
  } catch { return false; }
}
