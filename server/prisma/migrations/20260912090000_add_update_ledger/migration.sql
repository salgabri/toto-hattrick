CREATE TABLE "UpdateSource" (
  "sourceKey" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "externalId" INTEGER,
  "numberingSystem" TEXT NOT NULL,
  "baseline" INTEGER,
  "observedThrough" INTEGER,
  "lastAttemptAt" DATETIME,
  "lastSuccessAt" DATETIME,
  "nextCheckAt" DATETIME,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "UpdateItem" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "sourceKey" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "task" TEXT NOT NULL,
  "edition" INTEGER,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" DATETIME,
  "lastError" TEXT,
  "errorCategory" TEXT,
  "evidenceRef" TEXT,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "UpdateItem_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "UpdateSource" ("sourceKey") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UpdateItem_sourceKey_itemKey_task_key" ON "UpdateItem"("sourceKey", "itemKey", "task");
CREATE INDEX "UpdateItem_state_nextAttemptAt_idx" ON "UpdateItem"("state", "nextAttemptAt");
CREATE INDEX "UpdateItem_sourceKey_edition_idx" ON "UpdateItem"("sourceKey", "edition");
