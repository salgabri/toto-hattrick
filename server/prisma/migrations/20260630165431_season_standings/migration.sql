-- CreateTable
CREATE TABLE "SeasonStanding" (
    "teamId" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "leagueLevelUnitId" INTEGER NOT NULL,
    "leagueLevelUnitName" TEXT NOT NULL,
    "championTeamId" INTEGER NOT NULL,
    "championTeamName" TEXT NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "standingsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("teamId", "season")
);
