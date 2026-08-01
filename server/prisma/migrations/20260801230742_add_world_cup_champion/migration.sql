-- CreateTable
CREATE TABLE "WorldCupChampion" (
    "isYouth" BOOLEAN NOT NULL,
    "edition" INTEGER NOT NULL,
    "ageGroup" TEXT,
    "host" TEXT NOT NULL,
    "finishedDate" TEXT,
    "champion" TEXT,
    "runnerUp" TEXT,
    "thirdFourth" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("isYouth", "edition")
);
