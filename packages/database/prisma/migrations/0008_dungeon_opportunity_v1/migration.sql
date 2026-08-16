CREATE TABLE "dungeon_opportunity_states" (
    "character_id" UUID NOT NULL,
    "opportunity_count" INTEGER NOT NULL DEFAULT 0,
    "opportunity_cap" INTEGER NOT NULL DEFAULT 6,
    "recovery_anchor_at" TIMESTAMPTZ(3) NOT NULL,
    "next_recovery_at" TIMESTAMPTZ(3),
    "teaching_grant_tutorial_id" TEXT,
    "teaching_grant_claimed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dungeon_opportunity_states_pkey" PRIMARY KEY ("character_id")
);

CREATE TABLE "dungeon_opportunity_ledger" (
    "entry_id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "config_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dungeon_opportunity_ledger_pkey" PRIMARY KEY ("entry_id")
);

CREATE TABLE "dungeon_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "dungeon_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "current_node_id" TEXT NOT NULL,
    "initial_route_id" TEXT NOT NULL,
    "loadout_preset_id" UUID,
    "strategy_preset_id" TEXT,
    "opportunity_cost" INTEGER NOT NULL,
    "state_version" TEXT NOT NULL,
    "config_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dungeon_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dungeon_opportunity_ledger_character_id_created_at_idx"
  ON "dungeon_opportunity_ledger"("character_id", "created_at");

CREATE INDEX "dungeon_opportunity_ledger_reference_type_reference_id_idx"
  ON "dungeon_opportunity_ledger"("reference_type", "reference_id");

CREATE INDEX "dungeon_runs_character_id_created_at_idx"
  ON "dungeon_runs"("character_id", "created_at" DESC);

ALTER TABLE "dungeon_opportunity_states"
  ADD CONSTRAINT "dungeon_opportunity_states_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dungeon_opportunity_ledger"
  ADD CONSTRAINT "dungeon_opportunity_ledger_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dungeon_runs"
  ADD CONSTRAINT "dungeon_runs_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dungeon_runs_loadout_preset_id_fkey"
  FOREIGN KEY ("loadout_preset_id") REFERENCES "loadout_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dungeon_opportunity_states"
  ADD CONSTRAINT "dungeon_opportunity_states_count_non_negative_check" CHECK ("opportunity_count" >= 0),
  ADD CONSTRAINT "dungeon_opportunity_states_cap_positive_check" CHECK ("opportunity_cap" > 0),
  ADD CONSTRAINT "dungeon_opportunity_states_count_not_above_cap_check" CHECK ("opportunity_count" <= "opportunity_cap");

ALTER TABLE "dungeon_opportunity_ledger"
  ADD CONSTRAINT "dungeon_opportunity_ledger_balance_non_negative_check" CHECK ("balance_after" >= 0);

ALTER TABLE "dungeon_runs"
  ADD CONSTRAINT "dungeon_runs_opportunity_cost_non_negative_check" CHECK ("opportunity_cost" >= 0);
