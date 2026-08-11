-- AlterTable
-- Per-track cover override. Nullable and with no default, so this is an
-- additive, non-locking change: existing rows keep resolving to album art.
ALTER TABLE "Track" ADD COLUMN     "coverArtHash" TEXT;
