-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CupChampion" (
    "cupId" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "countryName" TEXT NOT NULL,
    "cupName" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL,
    "finalMatchId" INTEGER NOT NULL,
    "championTeamId" INTEGER,
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
INSERT INTO "new_CupChampion" ("awayGoals", "championTeamId", "championTeamName", "championUserId", "championUserName", "countryName", "createdAt", "cupId", "cupName", "finalMatchId", "homeGoals", "isMain", "leagueId", "penalties", "runnerUpTeamName", "season", "updatedAt") SELECT "awayGoals", "championTeamId", "championTeamName", "championUserId", "championUserName", "countryName", "createdAt", "cupId", "cupName", "finalMatchId", "homeGoals", "isMain", "leagueId", "penalties", "runnerUpTeamName", "season", "updatedAt" FROM "CupChampion";
DROP TABLE "CupChampion";
ALTER TABLE "new_CupChampion" RENAME TO "CupChampion";
CREATE INDEX "CupChampion_season_idx" ON "CupChampion"("season");
CREATE INDEX "CupChampion_championTeamId_idx" ON "CupChampion"("championTeamId");
CREATE INDEX "CupChampion_championUserId_idx" ON "CupChampion"("championUserId");
CREATE INDEX "CupChampion_leagueId_idx" ON "CupChampion"("leagueId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
