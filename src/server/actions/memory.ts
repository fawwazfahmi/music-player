"use server";

import { db } from "@/server/db";

export async function getNotesForTrack(trackId: string) {
  return db.songNote.findMany({
    where: { trackId },
    orderBy: { createdAt: "desc" },
    select: { id: true, body: true, createdAt: true, updatedAt: true },
  });
}

export async function addNote(trackId: string, body: string): Promise<{ id: string }> {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error("Note body is empty");
  const note = await db.songNote.create({
    data: { trackId, body: trimmed },
    select: { id: true },
  });
  return note;
}

export async function updateNote(noteId: string, body: string): Promise<void> {
  await db.songNote.update({ where: { id: noteId }, data: { body: body.trim() } });
}

export async function deleteNote(noteId: string): Promise<void> {
  await db.songNote.delete({ where: { id: noteId } });
}
