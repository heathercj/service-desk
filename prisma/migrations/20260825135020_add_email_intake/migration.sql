-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('WEB', 'EMAIL');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "source" "TicketSource" NOT NULL DEFAULT 'WEB';

-- CreateTable
CREATE TABLE "EmailIntakeMessage" (
    "id" TEXT NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailIntakeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailIntakeMessage_graphMessageId_key" ON "EmailIntakeMessage"("graphMessageId");

-- CreateIndex
CREATE INDEX "EmailIntakeMessage_ticketId_idx" ON "EmailIntakeMessage"("ticketId");

-- AddForeignKey
ALTER TABLE "EmailIntakeMessage" ADD CONSTRAINT "EmailIntakeMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
