-- M1 single-action lazy settlement state, runs and auditable segments.
CREATE TABLE "settlement_states" (
    "character_id" UUID NOT NULL,
    "last_settled_at" TIMESTAMPTZ(3) NOT NULL,
    "offline_cap_seconds" INTEGER NOT NULL DEFAULT 36000,
    "active_queue_entry_id" UUID,
    "active_cycle_index" BIGINT NOT NULL DEFAULT 0,
    "active_cycle_snapshot" JSONB,
    "progress_time_us" BIGINT NOT NULL DEFAULT 0,
    "continuation_required" BOOLEAN NOT NULL DEFAULT FALSE,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_states_pkey" PRIMARY KEY ("character_id")
);

CREATE TABLE "settlement_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "from_at" TIMESTAMPTZ(3) NOT NULL,
    "effective_until" TIMESTAMPTZ(3) NOT NULL,
    "requested_until" TIMESTAMPTZ(3) NOT NULL,
    "effective_seconds" BIGINT NOT NULL,
    "capped_seconds" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "segment_count" INTEGER NOT NULL,
    "random_seed" BYTEA NOT NULL,
    "formula_version" INTEGER NOT NULL,
    "config_version" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "settlement_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settlement_segments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "settlement_run_id" UUID NOT NULL,
    "segment_index" INTEGER NOT NULL,
    "queue_entry_id" UUID,
    "action_config_id" TEXT NOT NULL,
    "from_at" TIMESTAMPTZ(3) NOT NULL,
    "to_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_cycles" BIGINT NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "xp_changes" JSONB NOT NULL,
    "transition_reason" TEXT,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "settlement_segments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "settlement_runs_character_id_created_at_idx"
  ON "settlement_runs"("character_id", "created_at" DESC);
CREATE UNIQUE INDEX "settlement_segments_settlement_run_id_segment_index_key"
  ON "settlement_segments"("settlement_run_id", "segment_index");

ALTER TABLE "settlement_states"
  ADD CONSTRAINT "settlement_states_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settlement_runs"
  ADD CONSTRAINT "settlement_runs_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "settlement_runs_non_negative_time_check"
  CHECK ("effective_seconds" >= 0 AND "capped_seconds" >= 0),
  ADD CONSTRAINT "settlement_runs_segment_count_non_negative_check"
  CHECK ("segment_count" >= 0);

ALTER TABLE "settlement_segments"
  ADD CONSTRAINT "settlement_segments_settlement_run_id_fkey"
  FOREIGN KEY ("settlement_run_id") REFERENCES "settlement_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "settlement_segments_index_non_negative_check"
  CHECK ("segment_index" >= 0),
  ADD CONSTRAINT "settlement_segments_completed_cycles_non_negative_check"
  CHECK ("completed_cycles" >= 0),
  ADD CONSTRAINT "settlement_segments_time_order_check"
  CHECK ("to_at" >= "from_at");

ALTER TABLE "settlement_states"
  ADD CONSTRAINT "settlement_states_offline_cap_positive_check"
  CHECK ("offline_cap_seconds" > 0),
  ADD CONSTRAINT "settlement_states_active_cycle_index_non_negative_check"
  CHECK ("active_cycle_index" >= 0),
  ADD CONSTRAINT "settlement_states_progress_time_us_non_negative_check"
  CHECK ("progress_time_us" >= 0);

INSERT INTO "settlement_states" ("character_id", "last_settled_at")
SELECT "id", CURRENT_TIMESTAMP
FROM "characters"
ON CONFLICT ("character_id") DO NOTHING;
