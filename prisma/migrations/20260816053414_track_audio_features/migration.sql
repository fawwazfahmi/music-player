-- CreateTable
CREATE TABLE "TrackAudioFeatures" (
    "trackId" TEXT NOT NULL,
    "moodHappy" DOUBLE PRECISION,
    "moodSad" DOUBLE PRECISION,
    "moodRelaxed" DOUBLE PRECISION,
    "moodAggressive" DOUBLE PRECISION,
    "moodParty" DOUBLE PRECISION,
    "danceability" DOUBLE PRECISION,
    "danceabilityDsp" DOUBLE PRECISION,
    "tempo" DOUBLE PRECISION,
    "musicalKey" TEXT,
    "scale" TEXT,
    "keyStrength" DOUBLE PRECISION,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackAudioFeatures_pkey" PRIMARY KEY ("trackId")
);

-- AddForeignKey
ALTER TABLE "TrackAudioFeatures" ADD CONSTRAINT "TrackAudioFeatures_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
