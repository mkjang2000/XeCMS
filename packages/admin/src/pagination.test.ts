import { describe, expect, it } from "vitest";
import { calculateLastPage, parsePageParameter } from "./pagination.js";

describe("Admin pagination", () => {
  it.each([[null], [""], ["0"], ["-1"], ["1.5"], ["next"], ["999999999999999999999"]])(
    "normalizes an invalid page '%s' to page 1",
    (value) => expect(parsePageParameter(value)).toBe(1),
  );

  it("keeps a valid positive page", () => {
    expect(parsePageParameter("42")).toBe(42);
  });

  it("calculates a safe last page, including an empty collection", () => {
    expect(calculateLastPage(0, 25)).toBe(1);
    expect(calculateLastPage(26, 25)).toBe(2);
  });
});
