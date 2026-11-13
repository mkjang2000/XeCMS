import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ApplicationError } from "@xecms/application";
import { describe, expect, it } from "vitest";
import {
  extensionAcceptsRawBody, registerServerExtensions, validateServerExtensions,
  type ServerExtension, type ServerExtensionContext,
} from "./server-extensions.js";
import { problemDetails } from "./response-presenters.js";

function context(app: ServerExtensionContext["app"]): ServerExtensionContext {
  return { app, requireActor: async () => ({}) } as unknown as ServerExtensionContext;
}

describe("optional server extension host", () => {
  it("has no builder routes or menu entries without extensions", async () => {
    const app = Fastify();
    try {
      await registerServerExtensions([], context(app));
      expect((await app.inject("/api/extensions")).json()).toEqual({ items: [] });
      expect((await app.inject("/api/admin-apps")).statusCode).toBe(404);
      expect((await app.inject("/apps/example")).statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it("mounts selected API and SPA assets and exposes only public menu metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xecms-extension-assets-"));
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<h1>Optional app</h1>");
    await writeFile(join(directory, "assets", "probe.js"), "export const optional = true;");
    const app = Fastify();
    const extension: ServerExtension = {
      id: "probe", name: "Probe", register: ({ app }) => { app.get("/api/probe", async () => ({ available: true })); },
      admin: { distDirectory: directory, assetPrefix: "/extensions/probe/", spaRoutes: ["/probe", "/probe/*"], href: "/probe", label: "Probe app" },
    };
    try {
      validateServerExtensions([extension]);
      await registerServerExtensions([extension], context(app));
      expect((await app.inject("/api/probe")).json()).toEqual({ available: true });
      expect((await app.inject("/probe/deep-link")).body).toBe("<h1>Optional app</h1>");
      expect((await app.inject("/extensions/probe/assets/probe.js")).body).toContain("optional = true");
      expect((await app.inject("/api/extensions")).json()).toEqual({ items: [
        { id: "probe", name: "Probe", admin: { href: "/probe", label: "Probe app" } },
      ] });
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("preserves the engine problem response and audience details after mounting Admin assets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xecms-extension-errors-"));
    await writeFile(join(directory, "index.html"), "<h1>Optional app</h1>");
    const app = Fastify();
    const audience = { type: "content-realm", realmId: "realm-probe", realmKey: "probe", name: "Probe" };
    app.setErrorHandler((error, request, reply) => {
      const problem = problemDetails(error instanceof Error ? error : new Error("Unknown error"), request.id);
      reply.type("application/problem+json").code(problem.status).send(problem);
    });
    try {
      await registerServerExtensions([{ id: "probe", name: "Probe", register({ app }) {
        app.get("/api/probe", () => {
          throw new ApplicationError("EXTENSION_ACCESS_DENIED", 403, "Access denied.", { details: { audience } });
        });
      }, admin: { distDirectory: directory, assetPrefix: "/extensions/probe/", spaRoutes: ["/probe"], href: "/probe", label: "Probe" } }], context(app));
      const response = await app.inject("/api/probe");
      expect(response.statusCode).toBe(403);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json()).toMatchObject({ code: "EXTENSION_ACCESS_DENIED", details: { audience }, requestId: expect.any(String) });
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects duplicate extension IDs and API takeover by SPA metadata", () => {
    const extension: ServerExtension = { id: "probe", name: "Probe", register() {} };
    expect(() => validateServerExtensions([extension, extension])).toThrow("duplicate");
    for (const assetPrefix of ["/extensions/probe/../", "/extensions/probe/%2e%2e/", "//extensions/probe/"]) {
      expect(() => validateServerExtensions([{ ...extension, admin: {
        distDirectory: "/unused", assetPrefix, spaRoutes: ["/probe"], href: "/probe", label: "Probe",
      } }])).toThrow("Assets");
    }
    for (const path of [
      "/api", "/api/", "/api/users", "/api%2fusers", "/%61pi/users", "/api/*",
      "/", "/*", "/admin", "/admin/", "/admin/*", "/admin%2f*",
      "/admin/setup", "/admin/setup/", "/admin/login", "/admin/login/*",
      "/admin/password-change", "/admin%2fpassword-change", "/admin/password-change/step",
    ]) {
      expect(() => validateServerExtensions([{ ...extension, admin: {
        distDirectory: "/unused", assetPrefix: "/extensions/probe/", spaRoutes: [path], href: "/probe", label: "Probe",
      } }]), path).toThrow("SPA route");
    }
    expect(() => validateServerExtensions([{ ...extension, admin: {
      distDirectory: "/unused", assetPrefix: "/extensions/probe/",
      spaRoutes: ["/admin/apps", "/admin/apps/*", "/admin-apps/:appId/screens", "/apps/:appKey/*"],
      href: "/admin/apps", label: "Probe",
    } }])).not.toThrow();
  });

  it("reports missing configured Admin assets instead of silently hiding the extension", async () => {
    const app = Fastify();
    try {
      await expect(registerServerExtensions([{ id: "missing", name: "Missing", register() {}, admin: {
        distDirectory: "/missing-extension-assets", assetPrefix: "/extensions/missing/",
        spaRoutes: ["/missing"], href: "/missing", label: "Missing",
      } }], context(app))).rejects.toThrow("Admin assets");
    } finally { await app.close(); }
  });

  it("accepts streamed bodies only on explicitly declared method and route", () => {
    const extension: ServerExtension = { id: "probe", name: "Probe", register() {},
      rawBodyRoutes: [{ method: "POST", path: "/api/probe/:key/media" }] };
    expect(extensionAcceptsRawBody([extension], "POST", "/api/probe/example/media?part=1")).toBe(true);
    expect(extensionAcceptsRawBody([], "POST", "/api/probe/example/media")).toBe(false);
    expect(extensionAcceptsRawBody([extension], "GET", "/api/probe/example/media")).toBe(false);
    expect(extensionAcceptsRawBody([extension], "POST", "/api/probe//media")).toBe(false);
    expect(extensionAcceptsRawBody([extension], "POST", "/api/probe/example/media/extra")).toBe(false);
  });
});
