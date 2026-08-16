-- CreateEnum
CREATE TYPE "MoodKind" AS ENUM ('BUILTIN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AffinitySource" AS ENUM ('LLM_SEED', 'HEURISTIC');

-- CreateEnum
CREATE TYPE "FeedbackVerdict" AS ENUM ('FIT', 'MISS');

-- CreateTable
CREATE TABLE "Mood" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT,
    "kind" "MoodKind" NOT NULL DEFAULT 'BUILTIN',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackMoodSeed" (
    "trackId" TEXT NOT NULL,
    "moodId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" "AffinitySource" NOT NULL DEFAULT 'LLM_SEED',

    CONSTRAINT "TrackMoodSeed_pkey" PRIMARY KEY ("trackId","moodId")
);

-- CreateTable
CREATE TABLE "TrackMoodAffinity" (
    "listener" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "moodId" TEXT NOT NULL,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "skips" INTEGER NOT NULL DEFAULT 0,
    "replays" INTEGER NOT NULL DEFAULT 0,
    "thumbsUp" INTEGER NOT NULL DEFAULT 0,
    "thumbsDown" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackMoodAffinity_pkey" PRIMARY KEY ("listener","trackId","moodId")
);

-- CreateTable
CREATE TABLE "MoodSession" (
    "id" TEXT NOT NULL,
    "listener" TEXT NOT NULL,
    "moodId" TEXT,
    "freeText" TEXT,
    "interpretation" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodFeedback" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "verdict" "FeedbackVerdict" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mood_name_key" ON "Mood"("name");

-- CreateIndex
CREATE INDEX "TrackMoodSeed_moodId_idx" ON "TrackMoodSeed"("moodId");

-- CreateIndex
CREATE INDEX "TrackMoodAffinity_listener_moodId_idx" ON "TrackMoodAffinity"("listener", "moodId");

-- CreateIndex
CREATE INDEX "TrackMoodAffinity_moodId_idx" ON "TrackMoodAffinity"("moodId");

-- CreateIndex
CREATE INDEX "MoodSession_listener_createdAt_idx" ON "MoodSession"("listener", "createdAt");

-- CreateIndex
CREATE INDEX "MoodFeedback_sessionId_idx" ON "MoodFeedback"("sessionId");

-- CreateIndex
CREATE INDEX "MoodFeedback_trackId_idx" ON "MoodFeedback"("trackId");

-- AddForeignKey
ALTER TABLE "TrackMoodSeed" ADD CONSTRAINT "TrackMoodSeed_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackMoodSeed" ADD CONSTRAINT "TrackMoodSeed_moodId_fkey" FOREIGN KEY ("moodId") REFERENCES "Mood"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackMoodAffinity" ADD CONSTRAINT "TrackMoodAffinity_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackMoodAffinity" ADD CONSTRAINT "TrackMoodAffinity_moodId_fkey" FOREIGN KEY ("moodId") REFERENCES "Mood"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodSession" ADD CONSTRAINT "MoodSession_moodId_fkey" FOREIGN KEY ("moodId") REFERENCES "Mood"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodFeedback" ADD CONSTRAINT "MoodFeedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MoodSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodFeedback" ADD CONSTRAINT "MoodFeedback_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
