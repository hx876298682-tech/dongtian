CREATE TYPE "QueueMode" AS ENUM ('COUNT', 'DURATION', 'UNTIL_INVENTORY', 'INFINITE');
CREATE TYPE "QueueEntryStatus" AS ENUM (
  'QUEUED', 'RUNNING', 'BLOCKED', 'DONE', 'DONE_INCOMPLETE', 'DONE_CONDITION_MET', 'CANCELLED'
);
CREATE TYPE "BlockedPolicy" AS ENUM ('SKIP', 'FALLBACK');

CREATE TABLE "action_queues" (
    "character_id" UUID NOT NULL,
    "queue_version" BIGINT NOT NULL DEFAULT 0,
    "pending_replace_after_cycle" BOOLEAN NOT NULL DEFAULT FALSE,
    "paused" BOOLEAN NOT NULL DEFAULT FALSE,
    "fallback_action_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_queues_pkey" PRIMARY KEY ("character_id")
);

CREATE TABLE "action_queue_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "action_config_id" TEXT NOT NULL,
    "mode" "QueueMode" NOT NULL,
    "target_value" DECIMAL(30,6),
    "condition_item_id" TEXT,
    "condition_operator" TEXT,
    "on_blocked" "BlockedPolicy" NOT NULL,
    "status" "QueueEntryStatus" NOT NULL,
    "completed_cycles" BIGINT NOT NULL DEFAULT 0,
    "progress_time_us" BIGINT NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "snapshot_config_version" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_queue_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "action_queue_entries_character_id_position_idx"
  ON "action_queue_entries"("character_id", "position");
CREATE INDEX "action_queue_entries_character_id_status_idx"
  ON "action_queue_entries"("character_id", "status");
CREATE UNIQUE INDEX "action_queue_entries_active_position_key"
  ON "action_queue_entries"("character_id", "position")
  WHERE "status" IN ('QUEUED', 'RUNNING', 'BLOCKED');

ALTER TABLE "action_queues"
  ADD CONSTRAINT "action_queues_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "action_queues_queue_version_non_negative_check"
  CHECK ("queue_version" >= 0),
  ADD CONSTRAINT "action_queues_fallback_action_id_non_empty_check"
  CHECK (char_length("fallback_action_id") > 0);

ALTER TABLE "action_queue_entries"
  ADD CONSTRAINT "action_queue_entries_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "action_queue_entries_position_non_negative_check"
  CHECK ("position" >= 0),
  ADD CONSTRAINT "action_queue_entries_target_non_negative_check"
  CHECK ("target_value" IS NULL OR "target_value" >= 0),
  ADD CONSTRAINT "action_queue_entries_completed_cycles_non_negative_check"
  CHECK ("completed_cycles" >= 0),
  ADD CONSTRAINT "action_queue_entries_progress_time_non_negative_check"
  CHECK ("progress_time_us" >= 0);
