import { describe, expect, it } from "vitest";
import { isTransientConnectError } from "./migrate.js";

/**
 * A clean install used to fail its first `xecms migrate` and succeed on the
 * second: the container reports healthy on its unix socket while TCP is still
 * closed, and the migration gave up on the first refused connection. These
 * cases pin down which failures are worth waiting out.
 */
describe("transient connection detection", () => {
  it("waits out a database that is not accepting connections yet", () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET", "EPIPE"]) {
      expect(isTransientConnectError(Object.assign(new Error("connect failed"), { code })), code).toBe(true);
    }
    // Postgres reports this while it finishes starting up.
    expect(isTransientConnectError(Object.assign(new Error("cannot connect now"), { code: "57P03" }))).toBe(true);
  });

  it("waits out the connection drop when an initialising container restarts", () => {
    // The official image runs a temporary server for init scripts and then
    // restarts it, dropping sockets with no error code attached.
    expect(isTransientConnectError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isTransientConnectError(new Error("socket hang up"))).toBe(true);
    expect(isTransientConnectError(new Error("the database system is starting up"))).toBe(true);
  });

  it("fails fast on faults that retrying cannot fix", () => {
    // Bad credentials, a missing database or a broken migration must surface
    // immediately rather than after a backoff window.
    expect(isTransientConnectError(Object.assign(new Error("password authentication failed"), { code: "28P01" }))).toBe(false);
    expect(isTransientConnectError(Object.assign(new Error("database does not exist"), { code: "3D000" }))).toBe(false);
    expect(isTransientConnectError(Object.assign(new Error("syntax error"), { code: "42601" }))).toBe(false);
    expect(isTransientConnectError(new Error("relation already exists"))).toBe(false);
    expect(isTransientConnectError(null)).toBe(false);
    expect(isTransientConnectError("ECONNREFUSED")).toBe(false);
  });
});
