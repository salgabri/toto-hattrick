-- CreateTable
CREATE TABLE "NationalCoachElection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "countryName" TEXT NOT NULL,
    "edition" INTEGER NOT NULL,
    "host" TEXT NOT NULL,
    "winnerUserId" INTEGER,
    "winnerUserName" TEXT,
    "votes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "NationalCoachElection_leagueId_idx" ON "NationalCoachElection"("leagueId");

-- CreateIndex
CREATE INDEX "NationalCoachElection_winnerUserId_idx" ON "NationalCoachElection"("winnerUserId");
