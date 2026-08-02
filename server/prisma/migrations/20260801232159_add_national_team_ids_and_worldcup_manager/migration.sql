-- AlterTable
ALTER TABLE "NationalLeague" ADD COLUMN "nationalTeamId" INTEGER;
ALTER TABLE "NationalLeague" ADD COLUMN "u20TeamId" INTEGER;

-- AlterTable
ALTER TABLE "WorldCupChampion" ADD COLUMN "championUserId" INTEGER;
ALTER TABLE "WorldCupChampion" ADD COLUMN "championUserName" TEXT;
