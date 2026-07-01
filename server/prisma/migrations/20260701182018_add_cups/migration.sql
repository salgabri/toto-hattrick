-- CreateTable
CREATE TABLE "Cup" (
    "cupId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "countryName" TEXT NOT NULL,
    "cupName" TEXT NOT NULL,
    "cupLevel" INTEGER NOT NULL,
    "cupLevelIndex" INTEGER NOT NULL,
    "isMain" BOOLEAN NOT NULL,
    "currentSeason" INTEGER
);

-- CreateTable
CREATE TABLE "CupChampion" (
    "cupId" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "countryName" TEXT NOT NULL,
    "cupName" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL,
    "finalMatchId" INTEGER NOT NULL,
    "championTeamId" INTEGER NOT NULL,
    "championTeamName" TEXT NOT NULL,
    "runnerUpTeamName" TEXT NOT NULL,
    "homeGoals" INTEGER NOT NULL,
    "awayGoals" INTEGER NOT NULL,
    "penalties" BOOLEAN NOT NULL DEFAULT false,
    "championUserId" INTEGER,
    "championUserName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("cupId", "season"),
    CONSTRAINT "CupChampion_cupId_fkey" FOREIGN KEY ("cupId") REFERENCES "Cup" ("cupId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Cup_leagueId_idx" ON "Cup"("leagueId");

-- CreateIndex
CREATE INDEX "CupChampion_season_idx" ON "CupChampion"("season");

-- CreateIndex
CREATE INDEX "CupChampion_championTeamId_idx" ON "CupChampion"("championTeamId");

-- CreateIndex
CREATE INDEX "CupChampion_championUserId_idx" ON "CupChampion"("championUserId");

-- CreateIndex
CREATE INDEX "CupChampion_leagueId_idx" ON "CupChampion"("leagueId");
