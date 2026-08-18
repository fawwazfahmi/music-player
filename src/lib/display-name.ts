// Display-only name mapping. The underlying identity keys — auth cookies,
// VALID_NAMES, the party broadcaster, per-listener mood learning, cookie-jar
// filenames — all stay "ainul"/"fawwaz". This ONLY changes the label shown in
// the UI, so nothing in the backend/auth path is affected.
const DISPLAY_NAMES: Record<string, string> = {
  ainul: "Kyo",
  fawwaz: "Fawwaz",
};

/** The user-facing label for an identity name. The underlying identity stays
    lowercase (ainul/fawwaz) for auth/party/etc; this is display only. */
export function displayName(name: string): string {
  return DISPLAY_NAMES[name] ?? (name ? name.charAt(0).toUpperCase() + name.slice(1) : name);
}
