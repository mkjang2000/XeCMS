import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedProject } from "./config.js";
import { runPluginCommand } from "./plugin-commands.js";

const state = vi.hoisted(() => ({
  close: vi.fn(), inspect: vi.fn(), disable: vi.fn(), connect: vi.fn(),
}));
vi.mock("@xecms/server", () => { throw new Error("broken Plugin package prevents server import"); });
vi.mock("@xecms/database", () => ({
  PostgresDatabase: class {
    pool = {};
    schema = "recovery";
    constructor() { state.connect(); }
    close = state.close;
  },
  PostgresPluginRecoveryStore: class { inspect = state.inspect; disable = state.disable; },
}));
const project: LoadedProject = {
  root: "/unused", databaseUrl: "postgresql://unused",
  config: { projectName: "recovery", starter: "minimal", databaseSchema: "recovery", schemaFile: "schema.json", typesFile: "types.ts", mediaStorageRoot: "media", adminDist: "admin" },
};

beforeEach(() => vi.clearAllMocks());
describe("Plugin CLI without a loadable server", () => {
  it("inspects and disables without importing server or Plugin code", async () => {
    const lines: string[] = [];
    const io = { log: (line: string) => lines.push(line), error: vi.fn() };
    state.inspect.mockResolvedValue([{ pluginId: "missing", revision: 4, manifestIntegrity: true, migrationIntegrity: true }]);
    state.disable.mockResolvedValue({ changed: true, revision: 5, restartRequired: true, enabledDependents: [] });
    expect(await runPluginCommand(project, ["inspect", "--json"], io)).toBe(0);
    expect(JSON.parse(lines[0]!)).toMatchObject({ entries: [{ pluginId: "missing", revision: 4 }] });
    expect(await runPluginCommand(project, ["disable", "missing", "--offline", "--expected-revision", "4"], io)).toBe(0);
    expect(state.disable).toHaveBeenCalledWith("wrk_default", "missing", 4);
    expect(state.close).toHaveBeenCalledTimes(2);
  });
  it.each([
    [["disable", "missing"], "PLUGIN_OFFLINE_REQUIRED"],
    [["disable", "--offline"], "PLUGIN_ID_REQUIRED"],
    [["disable", "missing", "--offline", "--expected-revision", "1.5"], "PLUGIN_REVISION_INVALID"],
    [["disable", "missing", "--offline", "--expected-revision", "9007199254740992"], "PLUGIN_REVISION_INVALID"],
    [["inspect", "--apply"], "ARGUMENT_UNEXPECTED"],
  ])("rejects invalid recovery arguments %j before connecting", async (args, code) => {
    await expect(runPluginCommand(project, args as string[], { log: vi.fn(), error: vi.fn() })).rejects.toMatchObject({ code });
    expect(state.connect).not.toHaveBeenCalled();
  });
  it("closes its database if recovery fails", async () => {
    state.disable.mockRejectedValue(Object.assign(new Error("changed"), { code: "PLUGIN_REVISION_CONFLICT" }));
    await expect(runPluginCommand(project, ["disable", "missing", "--offline"], { log: vi.fn(), error: vi.fn() })).rejects.toMatchObject({ code: "PLUGIN_REVISION_CONFLICT" });
    expect(state.close).toHaveBeenCalledOnce();
  });
});
