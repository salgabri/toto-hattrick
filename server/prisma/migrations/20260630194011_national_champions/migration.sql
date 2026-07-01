-- CreateTable
CREATE TABLE "NationalLeague" (
    "leagueId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "countryName" TEXT NOT NULL,
    "topSeriesId" INTEGER NOT NULL,
    "currentSeason" INTEGER,
    "isCountry" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "LeagueChampion" (
    "leagueId" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "topSeriesId" INTEGER NOT NULL,
    "countryName" TEXT NOT NULL,
    "championTeamId" INTEGER NOT NULL,
    "championTeamName" TEXT NOT NULL,
    "championUserId" INTEGER,
    "played" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("leagueId", "season"),
    CONSTRAINT "LeagueChampion_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "NationalLeague" ("leagueId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LeagueChampion_season_idx" ON "LeagueChampion"("season");

-- CreateIndex
CREATE INDEX "LeagueChampion_championTeamId_idx" ON "LeagueChampion"("championTeamId");
