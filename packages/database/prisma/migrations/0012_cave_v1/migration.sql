CREATE TABLE "cave_facilities" (
  "character_id" UUID NOT NULL,
  "facility_config_id" TEXT NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cave_facilities_pkey" PRIMARY KEY ("character_id", "facility_config_id")
);

CREATE TABLE "cave_build_tasks" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "character_id" UUID NOT NULL,
  "facility_config_id" TEXT NOT NULL,
  "from_level" INTEGER NOT NULL,
  "target_level" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "complete_at" TIMESTAMPTZ(3) NOT NULL,
  "cost_transaction_id" UUID NOT NULL,
  "complete_transaction_id" UUID,
  "config_version" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cave_build_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cave_build_tasks_cost_transaction_id_key" ON "cave_build_tasks"("cost_transaction_id");
CREATE UNIQUE INDEX "cave_build_tasks_complete_transaction_id_key" ON "cave_build_tasks"("complete_transaction_id");
CREATE INDEX "cave_facilities_character_id_updated_at_idx" ON "cave_facilities"("character_id", "updated_at");
CREATE INDEX "cave_build_tasks_character_id_status_idx" ON "cave_build_tasks"("character_id", "status");
CREATE INDEX "cave_build_tasks_character_id_complete_at_idx" ON "cave_build_tasks"("character_id", "complete_at");
CREATE INDEX "cave_build_tasks_character_id_facility_config_id_status_idx" ON "cave_build_tasks"("character_id", "facility_config_id", "status");
CREATE UNIQUE INDEX "cave_build_tasks_running_unique" ON "cave_build_tasks"("character_id", "facility_config_id") WHERE "status" = 'RUNNING';

ALTER TABLE "cave_facilities"
  ADD CONSTRAINT "cave_facilities_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cave_build_tasks"
  ADD CONSTRAINT "cave_build_tasks_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cave_build_tasks_cost_transaction_id_fkey"
  FOREIGN KEY ("cost_transaction_id") REFERENCES "asset_transactions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cave_build_tasks_complete_transaction_id_fkey"
  FOREIGN KEY ("complete_transaction_id") REFERENCES "asset_transactions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
