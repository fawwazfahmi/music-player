import { db } from "@/server/db";
import { BUILTIN_MOODS, normalizeMoodName } from "@/lib/moods";

export interface MoodRow {
  id: string;
  name: string;
  label: string;
  emoji: string | null;
  kind: "BUILTIN" | "CUSTOM";
  position: number;
}

// Memoized per-process so we don't re-upsert the built-ins on every call. The
// flag lives on globalThis so tests can reset it. Idempotent regardless.
function ensured(): boolean {
  return (globalThis as Record<string, unknown>).__mu_moods_ensured === true;
}
function markEnsured(): void {
  (globalThis as Record<string, unknown>).__mu_moods_ensured = true;
}

export async function ensureBuiltinMoods(): Promise<void> {
  if (ensured()) return;
  for (const m of BUILTIN_MOODS) {
    await db.mood.upsert({
      where: { name: m.name },
      create: { name: m.name, label: m.label, emoji: m.emoji, kind: "BUILTIN", position: m.position },
      // Keep label/emoji/position in sync if we tweak the vocabulary later.
      update: { label: m.label, emoji: m.emoji, position: m.position },
    });
  }
  markEnsured();
}

export async function getAllMoods(): Promise<MoodRow[]> {
  await ensureBuiltinMoods();
  const rows = await db.mood.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
    emoji: r.emoji,
    kind: r.kind,
    position: r.position,
  }));
}

export async function moodByName(rawName: string): Promise<MoodRow | null> {
  await ensureBuiltinMoods();
  const r = await db.mood.findUnique({ where: { name: normalizeMoodName(rawName) } });
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    label: r.label,
    emoji: r.emoji,
    kind: r.kind,
    position: r.position,
  };
}
