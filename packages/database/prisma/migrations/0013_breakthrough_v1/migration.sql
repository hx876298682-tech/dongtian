CREATE TYPE "BreakthroughStatus" AS ENUM (
  'READY',
  'TRIAL_ACTIVE',
  'TRIAL_WAITING_CHOICE',
  'COMPLETED',
  'FAILED_RECOVERABLE',
  'ABANDONED'
);

CREATE TABLE "breakthrough_runs" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "character_id" UUID NOT NULL,
  "breakthrough_config_id" TEXT NOT NULL,
  "config_version" TEXT NOT NULL,
  "formula_version" INTEGER NOT NULL,
  "status" "BreakthroughStatus" NOT NULL,
  "run_version" BIGINT NOT NULL DEFAULT 0,
  "current_node_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trial_deadline_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "selected_choice_id" TEXT,
  "selected_route_id" TEXT,
  "selected_route_risk" TEXT,
  "selected_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "abandoned_at" TIMESTAMPTZ(3),
  "released_at" TIMESTAMPTZ(3),
  "reservation_snapshot" JSONB NOT NULL,
  "preview_snapshot" JSONB NOT NULL,
  "result" JSONB,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "breakthrough_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "breakthrough_runs_character_id_created_at_idx" ON "breakthrough_runs"("character_id", "created_at" DESC);
CREATE INDEX "breakthrough_runs_status_expires_at_idx" ON "breakthrough_runs"("status", "expires_at");
CREATE INDEX "breakthrough_runs_character_id_status_idx" ON "breakthrough_runs"("character_id", "status");
CREATE UNIQUE INDEX "breakthrough_runs_active_unique" ON "breakthrough_runs"("character_id") WHERE "status" IN ('TRIAL_ACTIVE', 'TRIAL_WAITING_CHOICE');

ALTER TABLE "breakthrough_runs"
  ADD CONSTRAINT "breakthrough_runs_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
