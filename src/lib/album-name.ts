// Tracks downloaded from YouTube without a matched release land in a per-artist
// album literally titled "YouTube". Show it as "Singles" instead — cleaner, and
// what it actually is (loose singles, not an album called YouTube).
export function displayAlbum(title: string | null | undefined): string {
  if (!title) return "";
  return title === "YouTube" ? "Singles" : title;
}
