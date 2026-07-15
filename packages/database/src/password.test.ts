import { describe, expect, it } from "vitest";
import { ScryptPasswordHasher } from "./password.js";

describe("ScryptPasswordHasher", () => {
  const hasher = new ScryptPasswordHasher();

  it("uses the configured OWASP-strength cost and verifies only the original password", async () => {
    const encoded = await hasher.hash("a strong password for testing");

    expect(encoded).toContain("$xecms$scrypt$131072$8$1$");
    await expect(hasher.verify("a strong password for testing", encoded)).resolves.toBe(true);
    await expect(hasher.verify("the wrong password", encoded)).resolves.toBe(false);
  });

  it("performs dummy work and rejects malformed encoded hashes", async () => {
    await expect(hasher.verify("any password", "not-a-password-hash")).resolves.toBe(false);
    await expect(hasher.verifyDummy("any password")).resolves.toBeUndefined();
  });
});
