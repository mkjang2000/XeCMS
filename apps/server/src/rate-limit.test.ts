import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "./rate-limit.js";

describe("LoginRateLimiter", () => {
  it("rejects after five failures and allows the key after its window expires", () => {
    const limiter = new LoginRateLimiter(5, 60_000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.assertAllowed("ip:127.0.0.1", 1_000);
      limiter.recordFailure("ip:127.0.0.1", 1_000);
    }
    expect(() => limiter.assertAllowed("ip:127.0.0.1", 1_001)).toThrowError(
      expect.objectContaining({ code: "LOGIN_RATE_LIMITED", status: 429 }),
    );
    expect(() => limiter.assertAllowed("ip:127.0.0.1", 61_001)).not.toThrow();
  });

  it("clears failures after successful authentication", () => {
    const limiter = new LoginRateLimiter(1, 60_000);
    limiter.recordFailure("identity:admin", 1_000);
    limiter.clear("identity:admin");
    expect(() => limiter.assertAllowed("identity:admin", 1_001)).not.toThrow();
  });
});
