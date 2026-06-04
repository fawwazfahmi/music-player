"use server";

import { env } from "@/lib/env";
import { scanOnce, type ScanReport } from "@/server/services/library-scanner";

export async function rescanLibrary(): Promise<ScanReport> {
  return scanOnce(env.MUSIC_LIBRARY_PATH);
}
