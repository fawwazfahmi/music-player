-- DropIndex
DROP INDEX "album_title_trgm";

-- DropIndex
DROP INDEX "artist_name_trgm";

-- DropIndex
DROP INDEX "track_title_trgm";

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "lyricsFetched" TIMESTAMP(3),
ADD COLUMN     "lyricsPlain" TEXT,
ADD COLUMN     "lyricsSynced" TEXT;
