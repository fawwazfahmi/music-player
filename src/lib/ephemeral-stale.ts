// An ephemeral "trying it out" pick is stale once it's clearly not wanted: never
// adopted, old enough, and untouched for the whole window. Pure so the sweeper's
// decision is unit-testable.

const DEFAULT_DAYS = 7;

export function isEphemeralStale(i: {
  inLibrary: boolean;
  createdAt: Date;
  lastPlayedAt: Date | null;
  now: Date;
  days?: number;
}): boolean {
  if (i.inLibrary) return false;
  const cutoff = i.now.getTime() - (i.days ?? DEFAULT_DAYS) * 86400_000;
  if (i.createdAt.getTime() > cutoff) return false; // still fresh
  if (i.lastPlayedAt && i.lastPlayedAt.getTime() > cutoff) return false; // recently played
  return true;
}
