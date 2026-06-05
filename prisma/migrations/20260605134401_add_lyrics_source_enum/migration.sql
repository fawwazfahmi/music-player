-- CreateEnum
CREATE TYPE "LyricsSource" AS ENUM ('LRCLIB_SYNCED', 'LRCLIB_PLAIN', 'WHISPER', 'MANUAL');

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "lyricsSource" "LyricsSource";
