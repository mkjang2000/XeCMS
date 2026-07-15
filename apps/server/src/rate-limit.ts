import { ApplicationError } from "@xecms/application";

interface Entry {
  count: number;
  resetAt: number;
}

export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly maximumTrackedKeys = 10_000;

  public constructor(
    private readonly maximumAttempts = 5,
    private readonly windowMs = 60_000,
  ) {}

  public assertAllowed(key: string, now = Date.now()): void {
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.resetAt > now && entry.count >= this.maximumAttempts) {
      throw new ApplicationError(
        "LOGIN_RATE_LIMITED",
        429,
        "Too many login attempts. Try again later.",
        { details: { retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) } },
      );
    }
  }

  public recordFailure(key: string, now = Date.now()): void {
    const current = this.entries.get(key);
    if (current === undefined || current.resetAt <= now) {
      this.makeSpace(now);
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    current.count += 1;
  }

  public clear(key: string): void {
    this.entries.delete(key);
  }

  private makeSpace(now: number): void {
    if (this.entries.size < this.maximumTrackedKeys) {
      return;
    }
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
      }
    }
    while (this.entries.size >= this.maximumTrackedKeys) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }
}
