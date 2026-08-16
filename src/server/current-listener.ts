import { cookies } from "next/headers";
import { NAME_COOKIE_NAME, isValidName } from "@/server/auth";

/** The identity making a request, from the mu_name cookie. Null when missing
    or unrecognised. Shared by the actions that attribute per-listener data. */
export async function currentListener(): Promise<string | null> {
  const c = await cookies();
  const raw = c.get(NAME_COOKIE_NAME)?.value;
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  return isValidName(decoded) ? decoded : null;
}

/** Like currentListener but falls back to a default when unattributed, for
    features that must own their data by a listener (e.g. mood learning). */
export async function currentListenerOr(fallback: string): Promise<string> {
  return (await currentListener()) ?? fallback;
}
