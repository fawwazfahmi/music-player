import { type NextRequest, NextResponse } from "next/server";
import {
  cookieStatus,
  removeCookies,
  saveCookies,
  validateNetscapeCookies,
} from "@/server/services/yt-cookies";
import { NAME_COOKIE_NAME, isValidName, type AppUserName } from "@/server/auth";

// GET/POST/DELETE /api/yt-cookies — manage the caller's YouTube cookie jar.
//
// The jar is what makes a Mix resolve as *that person's* YouTube rather than
// an anonymous cold-start radio. It also contains live Google credentials, so
// the body is never logged and never echoed back.

/** Rough ceiling for a cookies.txt; a real one is a few KB. Guards against
    someone POSTing a huge file into the jar directory. */
const MAX_BYTES = 256 * 1024;

function identityOf(req: NextRequest): AppUserName | null {
  const raw = req.cookies.get(NAME_COOKIE_NAME)?.value;
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  return isValidName(decoded) ? decoded : null;
}

export async function GET(req: NextRequest) {
  const name = identityOf(req);
  if (!name) return NextResponse.json({ error: "no_identity" }, { status: 400 });
  return NextResponse.json(
    { name, status: await cookieStatus(name) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const name = identityOf(req);
  if (!name) return NextResponse.json({ error: "no_identity" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const text = (body as { cookies?: unknown })?.cookies;
  if (typeof text !== "string" || text.length === 0) {
    return NextResponse.json({ error: "missing_cookies" }, { status: 400 });
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const validation = validateNetscapeCookies(text);
  if (!validation.ok) {
    return NextResponse.json({ error: "invalid_jar", message: validation.reason }, { status: 400 });
  }

  try {
    await saveCookies(name, text);
    return NextResponse.json({ name, status: await cookieStatus(name) });
  } catch (err) {
    // Deliberately does not include the error body — it can echo file
    // contents on some failure modes.
    console.error("[mu] /api/yt-cookies save failed for", name);
    void err;
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const name = identityOf(req);
  if (!name) return NextResponse.json({ error: "no_identity" }, { status: 400 });
  await removeCookies(name);
  return NextResponse.json({ name, status: "none" });
}
