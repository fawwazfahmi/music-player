// Next.js 16 runs this on app boot (server only).
// We start the chokidar watcher here so files dropped into MUSIC_LIBRARY_PATH
// get auto-ingested without a manual rescan. We also start the metadata
// enrichment worker that drains MetadataJob queue rows.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ startWatcher }, { startMetadataWorker }, { env }] = await Promise.all([
    import("@/server/services/library-scanner"),
    import("@/server/services/metadata-worker"),
    import("@/lib/env"),
  ]);
  startWatcher(env.MUSIC_LIBRARY_PATH);
  console.log(`[mu] chokidar watching ${env.MUSIC_LIBRARY_PATH}`);
  startMetadataWorker();
  console.log(`[mu] metadata worker started`);
}
