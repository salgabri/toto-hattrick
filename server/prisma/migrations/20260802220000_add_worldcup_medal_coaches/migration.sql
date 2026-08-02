-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorldCupChampion" (
    "isYouth" BOOLEAN NOT NULL,
    "edition" INTEGER NOT NULL,
    "ageGroup" TEXT,
    "host" TEXT NOT NULL,
    "finishedDate" TEXT,
    "champion" TEXT,
    "runnerUp" TEXT,
    "thirdFourth" TEXT NOT NULL DEFAULT '',
    "championUserId" INTEGER,
    "championUserName" TEXT,
    "runnerUpUserId" INTEGER,
    "thirdFourthUserIds" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("isYouth", "edition")
);
INSERT INTO "new_WorldCupChampion" ("ageGroup", "champion", "championUserId", "championUserName", "createdAt", "edition", "finishedDate", "host", "isYouth", "runnerUp", "thirdFourth", "updatedAt") SELECT "ageGroup", "champion", "championUserId", "championUserName", "createdAt", "edition", "finishedDate", "host", "isYouth", "runnerUp", "thirdFourth", "updatedAt" FROM "WorldCupChampion";
DROP TABLE "WorldCupChampion";
ALTER TABLE "new_WorldCupChampion" RENAME TO "WorldCupChampion";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

