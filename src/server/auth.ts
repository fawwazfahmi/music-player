import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";

const SEP = ".";

export function signCookie(payload: string): string {
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const mac = crypto
    .createHmac("sha256", env.COOKIE_SECRET)
    .update(b64)
    .digest("base64url");
  return `${b64}${SEP}${mac}`;
}

export function verifyCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  const [b64, mac] = value.split(SEP);
  if (!b64 || !mac) return null;
  const expected = crypto
    .createHmac("sha256", env.COOKIE_SECRET)
    .update(b64)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export async function verifyPassword(plain: string): Promise<boolean> {
  return bcrypt.compare(plain, env.APP_PASSWORD_HASH);
}

export const SESSION_COOKIE_NAME = "mu_session";
export const SESSION_COOKIE_VALUE = "ok"; // single-user; presence + signature is what counts

// Identity cookie — not security-relevant (anyone with the password can
// claim either name), purely UX: which side of the listening-party flow to
// show. Stored as a plain cookie because we don't need to detect tampering.
export const NAME_COOKIE_NAME = "mu_name";
export const VALID_NAMES = ["ainul", "fawwaz"] as const;
export type AppUserName = (typeof VALID_NAMES)[number];
export function isValidName(s: string): s is AppUserName {
  return (VALID_NAMES as readonly string[]).includes(s);
}
