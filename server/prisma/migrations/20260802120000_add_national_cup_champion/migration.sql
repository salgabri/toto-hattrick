-- CreateTable
CREATE TABLE "NationalCupChampion" (
    "cupId" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "cupName" TEXT NOT NULL,
    "isYouth" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT NOT NULL DEFAULT '',
    "finalDate" TEXT,
    "startedDate" TEXT,
    "status" TEXT,
    "champion" TEXT,
    "runnerUp" TEXT,
    "thirdFourth" TEXT NOT NULL DEFAULT '',
    "championTeamId" INTEGER,
    "championLeagueId" INTEGER,
    "championUserId" INTEGER,
    "championUserName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("cupId", "season")
);

-- CreateIndex
CREATE INDEX "NationalCupChampion_season_idx" ON "NationalCupChampion"("season");

-- CreateIndex
CREATE INDEX "NationalCupChampion_championUserId_idx" ON "NationalCupChampion"("championUserId");

