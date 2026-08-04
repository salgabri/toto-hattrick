-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NationalCoachElection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "countryName" TEXT NOT NULL,
    "edition" INTEGER NOT NULL,
    "host" TEXT NOT NULL,
    "isYouth" BOOLEAN NOT NULL DEFAULT false,
    "winnerUserId" INTEGER,
    "winnerUserName" TEXT,
    "votes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_NationalCoachElection" ("countryName", "createdAt", "edition", "host", "id", "leagueId", "updatedAt", "votes", "winnerUserId", "winnerUserName") SELECT "countryName", "createdAt", "edition", "host", "id", "leagueId", "updatedAt", "votes", "winnerUserId", "winnerUserName" FROM "NationalCoachElection";
DROP TABLE "NationalCoachElection";
ALTER TABLE "new_NationalCoachElection" RENAME TO "NationalCoachElection";
CREATE INDEX "NationalCoachElection_leagueId_idx" ON "NationalCoachElection"("leagueId");
CREATE INDEX "NationalCoachElection_winnerUserId_idx" ON "NationalCoachElection"("winnerUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
