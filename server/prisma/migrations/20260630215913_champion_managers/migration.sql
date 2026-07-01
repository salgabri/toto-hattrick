-- AlterTable
ALTER TABLE "LeagueChampion" ADD COLUMN "championUserName" TEXT;

-- CreateTable
CREATE TABLE "HattrickUser" (
    "userId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "loginName" TEXT NOT NULL,
    "countryId" INTEGER,
    "nationality" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "HattrickUser_nationality_idx" ON "HattrickUser"("nationality");

-- CreateIndex
CREATE INDEX "LeagueChampion_championUserId_idx" ON "LeagueChampion"("championUserId");
