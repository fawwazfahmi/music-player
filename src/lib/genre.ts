/** Canonical stored form: trimmed, internal whitespace collapsed, lowercased.
    Genre.name is @unique, so this is what dedupes "Indie  Rock" and "indie rock". */
export function normalizeGenre(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Presentation form for the UI: title-case each word. Stored names are
    lowercase; capitalize only when rendering. */
export function displayGenre(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}
