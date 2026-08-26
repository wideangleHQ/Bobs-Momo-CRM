-- AlterTable
ALTER TABLE "ChecklistTemplateItem" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
-- CreateIndex
CREATE UNIQUE INDEX "Task_recurrenceId_outletId_businessDate_key" ON "Task"("recurrenceId", "outletId", "businessDate");
