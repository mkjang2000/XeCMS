import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { PasswordHasher } from "@xecms/application";

const KEY_LENGTH = 64;
const N = 131_072;
const R = 8;
const P = 1;
const DUMMY_SALT = Buffer.from("aec3d5d5b7f46a6b2aa6e617f552a81e", "hex");

export class ScryptPasswordHasher implements PasswordHasher {
  public async hash(password: string): Promise<string> {
    const { randomBytes } = await import("node:crypto");
    const salt = randomBytes(16);
    const derived = await derive(password, salt);
    return `$xecms$scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
  }

  public async verify(password: string, encodedHash: string): Promise<boolean> {
    const parts = encodedHash.split("$");
    if (
      parts.length !== 8 ||
      parts[1] !== "xecms" ||
      parts[2] !== "scrypt" ||
      Number(parts[3]) !== N ||
      Number(parts[4]) !== R ||
      Number(parts[5]) !== P
    ) {
      await this.verifyDummy(password);
      return false;
    }
    try {
      const salt = Buffer.from(parts[6] ?? "", "base64url");
      const expected = Buffer.from(parts[7] ?? "", "base64url");
      if (salt.length !== 16 || expected.length !== KEY_LENGTH) {
        await this.verifyDummy(password);
        return false;
      }
      const actual = await derive(password, salt);
      return timingSafeEqual(actual, expected);
    } catch {
      await this.verifyDummy(password);
      return false;
    }
  }

  public async verifyDummy(password: string): Promise<void> {
    await derive(password, DUMMY_SALT);
  }
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N, r: R, p: P, maxmem: 256 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
        } else {
          resolve(derivedKey);
        }
      },
    );
  });
}
