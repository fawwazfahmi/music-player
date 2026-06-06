import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { followParty, unfollowParty } from "@/server/services/party-service";
import { NAME_COOKIE_NAME, isValidName } from "@/server/auth";

// POST → mark current user as a follower (ainul sees them in the roster)
// DELETE → remove from roster
//
// Called by the client when fawwaz taps Join / Leave so the broadcaster's
// banner updates in real time. ainul can also POST (e.g. she opened her
// own party in another tab to test) — server doesn't gate by name, just
// by valid identity.

export async function POST() {
  const name = (await cookies()).get(NAME_COOKIE_NAME)?.value ?? "";
  if (!isValidName(name)) {
    return NextResponse.json({ error: "no_identity" }, { status: 403 });
  }
  await followParty(name);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const name = (await cookies()).get(NAME_COOKIE_NAME)?.value ?? "";
  if (!isValidName(name)) {
    return NextResponse.json({ error: "no_identity" }, { status: 403 });
  }
  await unfollowParty(name);
  return NextResponse.json({ ok: true });
}
