-- Enable trigram extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN indexes for fuzzy search on titles/names
CREATE INDEX IF NOT EXISTS track_title_trgm  ON "Track"  USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS artist_name_trgm  ON "Artist" USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS album_title_trgm  ON "Album"  USING gin (title gin_trgm_ops);

-- Expression index for daily aggregates (Wrapped, stats)
CREATE INDEX IF NOT EXISTS history_played_day ON "ListeningHistory" (date_trunc('day', "playedAt"));
