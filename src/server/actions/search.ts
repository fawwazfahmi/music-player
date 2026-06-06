"use server";

import { searchLibrary as serviceSearch } from "@/server/services/search";
import {
  searchYt as ytServiceSearch,
  type YtSearchResult,
} from "@/server/services/yt-service";

export async function searchLibrary(query: string) {
  return serviceSearch(query);
}

export async function searchYt(query: string): Promise<YtSearchResult[]> {
  return ytServiceSearch(query, 5);
}

// YT download orchestration moved to POST /api/yt-download (see route.ts).
// React Server Actions are serialized per-client, so awaiting a 30-100s
// download in a Server Action blocked every other server action (Songs,
// Albums, etc.) until it finished. The API route bypasses that queue.
