import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("notes (memory) actions", () => {
  let trackId = "";

  beforeEach(async () => {
    const { db } = await import("@/server/db");
    const artist = await db.artist.upsert({
      where: { name: "NoteTest" },
      create: { name: "NoteTest" },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: "NoteAlbum" } },
      create: { title: "NoteAlbum", artistId: artist.id },
      update: {},
    });
    const t = await db.track.create({
      data: {
        title: "NoteTrack",
        duration: 100,
        filePath: `/tmp/note-${Date.now()}.m4a`,
        sha256: `note-${Date.now()}-${Math.random()}`,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "LOCAL_SCAN",
      },
      select: { id: true },
    });
    trackId = t.id;
  });

  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.songNote.deleteMany({ where: { trackId } });
    await db.track.deleteMany({ where: { id: trackId } });
    await db.album.deleteMany({ where: { title: "NoteAlbum" } });
    await db.artist.deleteMany({ where: { name: "NoteTest" } });
  });

  it("addNote + getNotesForTrack returns the new note", async () => {
    const { addNote, getNotesForTrack } = await import("@/server/actions/memory");
    await addNote(trackId, "Recommended by Sarah at coffee");
    const notes = await getNotesForTrack(trackId);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toBe("Recommended by Sarah at coffee");
  });

  it("addNote rejects empty body", async () => {
    const { addNote } = await import("@/server/actions/memory");
    await expect(addNote(trackId, "   ")).rejects.toThrow(/empty/i);
  });

  it("notes are ordered newest-first", async () => {
    const { addNote, getNotesForTrack } = await import("@/server/actions/memory");
    await addNote(trackId, "first");
    await new Promise((r) => setTimeout(r, 15));
    await addNote(trackId, "second");
    const notes = await getNotesForTrack(trackId);
    expect(notes.map((n) => n.body)).toEqual(["second", "first"]);
  });

  it("updateNote changes body, deleteNote removes it", async () => {
    const { addNote, updateNote, deleteNote, getNotesForTrack } = await import("@/server/actions/memory");
    const { id } = await addNote(trackId, "original");
    await updateNote(id, "edited");
    let notes = await getNotesForTrack(trackId);
    expect(notes[0]?.body).toBe("edited");
    await deleteNote(id);
    notes = await getNotesForTrack(trackId);
    expect(notes).toHaveLength(0);
  });
});
