ALTER TABLE "dungeon_runs"
  ADD COLUMN "phase" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "revision" BIGINT,
  ADD COLUMN "choice_deadline_at" TIMESTAMPTZ(3),
  ADD COLUMN "selected_choice_id" TEXT,
  ADD COLUMN "selected_route_id" TEXT,
  ADD COLUMN "selected_route_risk" TEXT,
  ADD COLUMN "selected_at" TIMESTAMPTZ(3),
  ADD COLUMN "combat_resolved_at" TIMESTAMPTZ(3),
  ADD COLUMN "finalized_at" TIMESTAMPTZ(3),
  ADD COLUMN "run_state" JSONB,
  ADD COLUMN "reward_intent" JSONB,
  ADD COLUMN "result_snapshot" JSONB;

UPDATE "dungeon_runs"
   SET "phase" = COALESCE("status", 'ENTERED'),
       "outcome" = 'PENDING',
       "revision" = 0,
       "choice_deadline_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
       "run_state" = '{}'::jsonb
 WHERE "phase" IS NULL;

ALTER TABLE "dungeon_runs"
  ALTER COLUMN "phase" SET NOT NULL,
  ALTER COLUMN "phase" SET DEFAULT 'ENTERED',
  ALTER COLUMN "outcome" SET NOT NULL,
  ALTER COLUMN "outcome" SET DEFAULT 'PENDING',
  ALTER COLUMN "revision" SET NOT NULL,
  ALTER COLUMN "revision" SET DEFAULT 0,
  ALTER COLUMN "choice_deadline_at" SET NOT NULL,
  ALTER COLUMN "choice_deadline_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "run_state" SET NOT NULL,
  ALTER COLUMN "run_state" SET DEFAULT '{}'::jsonb;
