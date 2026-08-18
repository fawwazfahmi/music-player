// Romanize CJK lyrics to Latin. The app displays lyrics in romaji/romanization
// or English ONLY (never raw Hangul/Kana/Hanzi), but LRCLIB and uploader
// captions frequently return native script — so we transliterate here, at the
// point lyrics enter storage, regardless of source.
//
//   Korean  → Revised Romanization via es-hangul (handles the phonology).
//   Japanese→ kana → romaji via wanakana. Kanji has no reading without a
//             morphological dictionary, so it's left as-is (rare here).
import { romanize } from "es-hangul";
import { toRomaji } from "wanakana";

const HANGUL = /[가-힣ᄀ-ᇿ]/;
const JAPANESE = /[぀-ゟ゠-ヿ]/; // Hiragana + Katakana (Han handled below)
const HAN = /[一-鿿㐀-䶿]/;

export const CJK_RE = /[가-힣ᄀ-ᇿ぀-ゟ゠-ヿ㄰-㆏一-鿿㐀-䶿]/;

export function containsCJK(text: string): boolean {
  return CJK_RE.test(text);
}

/** Romanize the linguistic content of one line (no timestamp handling). */
function romanizeSegment(text: string): string {
  if (HANGUL.test(text)) return romanize(text);
  if (JAPANESE.test(text) || HAN.test(text)) return toRomaji(text);
  return text;
}

// A line may carry one or more leading LRC timestamp tags: "[00:07.47] text".
const LRC_PREFIX = /^((?:\[[^\]]*\]\s*)*)([\s\S]*)$/;

export function romanizeLine(line: string): string {
  const m = LRC_PREFIX.exec(line);
  if (!m) return romanizeSegment(line);
  return m[1]! + romanizeSegment(m[2]!);
}

/** Romanize a whole lyrics block (LRC or plain), preserving line structure.
    No-op when the text is already Latin-only. */
export function romanizeLyrics(text: string): string {
  if (!text || !containsCJK(text)) return text;
  return text.split("\n").map(romanizeLine).join("\n");
}

export interface LyricsPair {
  synced: string | null;
  plain: string | null;
}

/** Romanize both members of a synced/plain lyrics pair. */
export function romanizePair(pair: LyricsPair): LyricsPair {
  return {
    synced: pair.synced ? romanizeLyrics(pair.synced) : pair.synced,
    plain: pair.plain ? romanizeLyrics(pair.plain) : pair.plain,
  };
}
