-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('INCIDENT_OPENED', 'INCIDENT_RESOLVED', 'TEST');

-- AlterTable
ALTER TABLE "alert_rules" DROP COLUMN "consecutive_failures",
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "monitor_checks" ALTER COLUMN "expires_at" SET DEFAULT (now() + interval '30 days');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "event" "NotificationEvent" NOT NULL DEFAULT 'INCIDENT_OPENED';

-- CreateIndex
CREATE UNIQUE INDEX "notifications_incident_id_alert_rule_id_event_key" ON "notifications"("incident_id", "alert_rule_id", "event");
