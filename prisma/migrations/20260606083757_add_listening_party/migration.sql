-- CreateTable
CREATE TABLE "ListeningParty" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startedBy" TEXT NOT NULL,
    "trackId" TEXT,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isPlaying" BOOLEAN NOT NULL DEFAULT false,
    "pulse" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListeningParty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListeningParty_active_updatedAt_idx" ON "ListeningParty"("active", "updatedAt");
