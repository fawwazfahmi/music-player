import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  endParty,
  getActiveParty,
  startParty,
  updateParty,
} from "@/server/services/party-service";
import { NAME_COOKIE_NAME, isValidName } from "@/server/auth";

// GET — receiver polls this every ~2s to mirror the broadcaster's player.
// Returns null when no party is active.
export async function GET() {
  const party = await getActiveParty();
  return NextResponse.json(party, { headers: { "cache-control": "no-store" } });
}

// POST — starter creates a party. Only ainul is allowed.
//
// Body:
//   { trackId, trackTitle, trackArtist, position, isPlaying }
export async function POST(req: NextRequest) {
  const name = (await cookies()).get(NAME_COOKIE_NAME)?.value ?? "";
  if (!isValidName(name) || name !== "ainul") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const party = await startParty({
    startedBy: name,
    trackId: typeof b.trackId === "string" ? b.trackId : null,
    trackTitle: typeof b.trackTitle === "string" ? b.trackTitle : null,
    trackArtist: typeof b.trackArtist === "string" ? b.trackArtist : null,
    position: typeof b.position === "number" ? b.position : 0,
    isPlaying: typeof b.isPlaying === "boolean" ? b.isPlaying : false,
  });
  return NextResponse.json(party);
}

// PATCH — broadcaster streams updates (track / position / isPlaying).
//
// Body: { id, trackId, position, isPlaying }
export async function PATCH(req: NextRequest) {
  const name = (await cookies()).get(NAME_COOKIE_NAME)?.value ?? "";
  if (!isValidName(name) || name !== "ainul") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.id !== "string") {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  const active = await updateParty({
    id: b.id,
    trackId: typeof b.trackId === "string" ? b.trackId : null,
    position: typeof b.position === "number" ? b.position : 0,
    isPlaying: typeof b.isPlaying === "boolean" ? b.isPlaying : false,
  });
  return NextResponse.json({ ok: true, active });
}

// DELETE — broadcaster ends the party.
//
// Query: ?id=<partyId>
export async function DELETE(req: NextRequest) {
  const name = (await cookies()).get(NAME_COOKIE_NAME)?.value ?? "";
  if (!isValidName(name) || name !== "ainul") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  await endParty(id);
  return NextResponse.json({ ok: true });
}
