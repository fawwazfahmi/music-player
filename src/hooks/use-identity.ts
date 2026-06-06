"use client";

import { useEffect, useState } from "react";

const NAMES = ["ainul", "fawwaz"] as const;
export type AppUserName = (typeof NAMES)[number];

function readNameCookie(): AppUserName | null {
  if (typeof document === "undefined") return null;
  const m = /(?:^|;\s*)mu_name=([^;]+)/.exec(document.cookie);
  if (!m) return null;
  const v = decodeURIComponent(m[1]!);
  return (NAMES as readonly string[]).includes(v) ? (v as AppUserName) : null;
}

/** Reads the mu_name cookie set at login. Returns null until hydration so
    server and client agree on the first paint. */
export function useIdentity(): AppUserName | null {
  const [name, setName] = useState<AppUserName | null>(null);
  useEffect(() => {
    setName(readNameCookie());
  }, []);
  return name;
}
