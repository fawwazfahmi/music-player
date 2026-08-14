"use client";

import { useSyncExternalStore } from "react";

const NAMES = ["ainul", "fawwaz"] as const;
export type AppUserName = (typeof NAMES)[number];

function readNameCookie(): AppUserName | null {
  if (typeof document === "undefined") return null;
  const m = /(?:^|;\s*)mu_name=([^;]+)/.exec(document.cookie);
  if (!m) return null;
  const v = decodeURIComponent(m[1]!);
  return (NAMES as readonly string[]).includes(v) ? (v as AppUserName) : null;
}

/** Never resubscribes: the cookie is set at login and cannot change without a
    page load. */
const subscribe = () => () => {};

/** Reads the mu_name cookie set at login. Returns null on the server so the
    first client paint matches the markup, then the real value. */
export function useIdentity(): AppUserName | null {
  return useSyncExternalStore(subscribe, readNameCookie, () => null);
}
