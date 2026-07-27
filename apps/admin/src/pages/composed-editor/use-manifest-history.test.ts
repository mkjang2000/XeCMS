// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdminAppManifestV2 } from "@xecms/admin-apps";

import { useManifestHistory } from "./use-manifest-history.js";

function manifest(name: string): AdminAppManifestV2 {
  return {
    format: "xecms.admin-app", formatVersion: 2, id: "app-x", name, key: "app-x",
    audience: { type: "system" },
    presentation: { layoutProfile: "16:9", menuPosition: "left", canvasAlignment: "top-center" },
    navigation: [], pages: [], startPageId: "pg",
  };
}

describe("useManifestHistory", () => {
  it("undoes and redoes edits", () => {
    const { result } = renderHook(() => useManifestHistory());
    act(() => result.current.reset(manifest("A")));
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.set(manifest("B")));
    act(() => result.current.set(manifest("C")));
    expect(result.current.manifest?.name).toBe("C");
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.manifest?.name).toBe("B");
    act(() => result.current.undo());
    expect(result.current.manifest?.name).toBe("A");
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.redo());
    expect(result.current.manifest?.name).toBe("B");
    expect(result.current.canRedo).toBe(true);
  });

  it("a new edit after undo clears the redo tail", () => {
    const { result } = renderHook(() => useManifestHistory());
    act(() => result.current.reset(manifest("A")));
    act(() => result.current.set(manifest("B")));
    act(() => result.current.undo()); // back to A
    act(() => result.current.set(manifest("D"))); // new branch
    expect(result.current.manifest?.name).toBe("D");
    expect(result.current.canRedo).toBe(false);
  });

  it("reset clears history (load / save baseline is not undoable)", () => {
    const { result } = renderHook(() => useManifestHistory());
    act(() => result.current.reset(manifest("A")));
    act(() => result.current.set(manifest("B")));
    act(() => result.current.reset(manifest("SAVED")));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.manifest?.name).toBe("SAVED");
  });
});
