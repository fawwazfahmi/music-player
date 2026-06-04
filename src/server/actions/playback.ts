"use server";

import { db } from "@/server/db";

export async function startPlay(trackId: string): Promise<string> {
  const history = await db.listeningHistory.create({
    data: {
      trackId,
      source: "LOCAL_FILE",
      durationListened: 0,
      completed: false,
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
