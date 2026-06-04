import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  signCookie,
  verifyPassword,
} from "@/server/auth";

const Body = z.object({ password: z.string().min(1) });

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const ok = await verifyPassword(parsed.data.password);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "invalid_password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: signCookie(SESSION_COOKIE_VALUE),
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  return res;
}
