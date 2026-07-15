import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuthRuntime } from "@xecms/application";

export function createSecurityRuntime(secret: string): AuthRuntime {
  const digest = (purpose: string, value: string): string =>
    createHmac("sha256", secret).update(purpose).update("\0").update(value).digest("base64url");
  const deriveCsrfToken = (sessionToken: string): string => digest("csrf", sessionToken);
  return {
    now: () => new Date().toISOString(),
    newIdentityId: () => `usr_${randomUUID()}`,
    randomToken: () => randomBytes(32).toString("base64url"),
    hashToken: (token) => digest("session", token),
    deriveCsrfToken,
    verifyCsrfToken: (sessionToken, csrfToken) =>
      constantTimeEqual(deriveCsrfToken(sessionToken), csrfToken),
  };
}

export function createApplicationRuntime(): {
  readonly now: () => string;
  readonly newId: (prefix: "doc" | "rev") => string;
} {
  return {
    now: () => new Date().toISOString(),
    newId: (prefix) => `${prefix}_${randomUUID()}`,
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    // Still execute one comparison to avoid making length mismatches a special fast path.
    timingSafeEqual(leftBytes, leftBytes);
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}
