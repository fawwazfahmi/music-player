/**
 * Lines for empty states.
 *
 * Deliberately kept to the product voice, not the personal one — an empty
 * screen is encountered often and at random, including with someone else
 * looking. The personal line lives on the login screen alone.
 *
 * Chosen per render from the caller's key so a given screen keeps its line
 * instead of flickering between renders.
 */
const LINES = [
  "Every mood has a frequency.",
  "Tune out the world. Tune into yours.",
  "Songs that move at your frequency.",
  "Your universe has a sound.",
  "Find yourself between the waves.",
];

export function emptyLineFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return LINES[Math.abs(h) % LINES.length]!;
}

export const EMPTY_LINES = LINES;
