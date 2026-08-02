-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NationalCupChampion" (
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
    "runnerUpTeamId" INTEGER,
    "runnerUpLeagueId" INTEGER,
    "thirdFourthTeamIds" TEXT NOT NULL DEFAULT '',
    "thirdFourthLeagueIds" TEXT NOT NULL DEFAULT '',
    "championUserId" INTEGER,
    "championUserName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("cupId", "season")
);
INSERT INTO "new_NationalCupChampion" ("champion", "championLeagueId", "championTeamId", "championUserId", "championUserName", "createdAt", "cupId", "cupName", "finalDate", "host", "isYouth", "runnerUp", "season", "startedDate", "status", "thirdFourth", "updatedAt") SELECT "champion", "championLeagueId", "championTeamId", "championUserId", "championUserName", "createdAt", "cupId", "cupName", "finalDate", "host", "isYouth", "runnerUp", "season", "startedDate", "status", "thirdFourth", "updatedAt" FROM "NationalCupChampion";
DROP TABLE "NationalCupChampion";
ALTER TABLE "new_NationalCupChampion" RENAME TO "NationalCupChampion";
CREATE INDEX "NationalCupChampion_season_idx" ON "NationalCupChampion"("season");
CREATE INDEX "NationalCupChampion_championUserId_idx" ON "NationalCupChampion"("championUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

