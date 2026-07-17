import { describe, expect, it } from "vitest";
import {
  DISPLAY_MODE_STORAGE_KEY,
  displayModeAtLeast,
  readStoredDisplayMode,
} from "./display-mode.js";

describe("Admin display mode", () => {
  it("defaults invalid or unavailable preferences to Basic", () => {
    expect(readStoredDisplayMode()).toBe("basic");
    expect(readStoredDisplayMode({ getItem: () => "unsupported" })).toBe("basic");
  });

  it("reads a persisted mode and applies the visibility hierarchy", () => {
    expect(readStoredDisplayMode({
      getItem: (key) => key === DISPLAY_MODE_STORAGE_KEY ? "standard" : null,
    })).toBe("standard");
    expect(displayModeAtLeast("basic", "standard")).toBe(false);
    expect(displayModeAtLeast("standard", "standard")).toBe(true);
    expect(displayModeAtLeast("advanced", "standard")).toBe(true);
  });
});
