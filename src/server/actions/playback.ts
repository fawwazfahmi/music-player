"use server";

import { cookies } from "next/headers";
import { db } from "@/server/db";
import { NAME_COOKIE_NAME, isValidName } from "@/server/auth";

/**
 * Which identity is playing, from the mu_name cookie. Null when it's missing
 * or unrecognised — a play still gets recorded, just unattributed, rather
 * than being dropped or guessed at.
 */
async function currentListener(): Promise<string | null> {
  const c = await cookies();
  const raw = c.get(NAME_COOKIE_NAME)?.value;
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  return isValidName(decoded) ? decoded : null;
}

export async function startPlay(trackId: string): Promise<string> {
  const history = await db.listeningHistory.create({
    data: {
      trackId,
      source: "LOCAL_FILE",
      durationListened: 0,
      completed: false,
      listener: await currentListener(),
    },
    select: { id: true },
  });
  return history.id;
}

export async function updatePlayProgress(historyId: string, secondsListened: number, completed: boolean): Promise<void> {
  await db.listeningHistory.update({
    where: { id: historyId },
    data: { durationListened: Math.round(secondsListened), completed },
  });
}
