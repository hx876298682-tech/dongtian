CREATE TABLE "temper_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "equipment_instance_id" UUID NOT NULL,
    "from_level" INTEGER NOT NULL,
    "target_level" INTEGER NOT NULL,
    "success_probability" DECIMAL(12,9) NOT NULL,
    "random_seed" BYTEA NOT NULL,
    "config_version" TEXT NOT NULL,
    "formula_version" INTEGER NOT NULL,
    "result" TEXT NOT NULL,
    "success" BOOLEAN,
    "costs" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "asset_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "temper_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "equipment_temper_audits" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "attempt_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "equipment_instance_id" UUID NOT NULL,
    "from_level" INTEGER NOT NULL,
    "target_level" INTEGER NOT NULL,
    "level_before" INTEGER NOT NULL,
    "level_after" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "result" TEXT NOT NULL,
    "asset_transaction_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_temper_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "temper_attempts_character_id_created_at_idx"
ON "temper_attempts"("character_id", "created_at");

CREATE INDEX "temper_attempts_equipment_instance_id_created_at_idx"
ON "temper_attempts"("equipment_instance_id", "created_at");

CREATE UNIQUE INDEX "temper_attempts_asset_transaction_id_key"
ON "temper_attempts"("asset_transaction_id");

CREATE UNIQUE INDEX "equipment_temper_audits_attempt_id_key"
ON "equipment_temper_audits"("attempt_id");

CREATE UNIQUE INDEX "equipment_temper_audits_asset_transaction_id_key"
ON "equipment_temper_audits"("asset_transaction_id");

ALTER TABLE "temper_attempts"
ADD CONSTRAINT "temper_attempts_character_id_fkey"
FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "temper_attempts"
ADD CONSTRAINT "temper_attempts_equipment_instance_id_fkey"
FOREIGN KEY ("equipment_instance_id") REFERENCES "equipment_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "temper_attempts"
ADD CONSTRAINT "temper_attempts_asset_transaction_id_fkey"
FOREIGN KEY ("asset_transaction_id") REFERENCES "asset_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_temper_audits"
ADD CONSTRAINT "equipment_temper_audits_attempt_id_fkey"
FOREIGN KEY ("attempt_id") REFERENCES "temper_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_temper_audits"
ADD CONSTRAINT "equipment_temper_audits_character_id_fkey"
FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_temper_audits"
ADD CONSTRAINT "equipment_temper_audits_equipment_instance_id_fkey"
FOREIGN KEY ("equipment_instance_id") REFERENCES "equipment_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_temper_audits"
ADD CONSTRAINT "equipment_temper_audits_asset_transaction_id_fkey"
FOREIGN KEY ("asset_transaction_id") REFERENCES "asset_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "temper_attempts"
  ADD CONSTRAINT "temper_attempts_from_level_non_negative_check" CHECK ("from_level" >= 0),
  ADD CONSTRAINT "temper_attempts_target_level_positive_check" CHECK ("target_level" >= 1),
  ADD CONSTRAINT "temper_attempts_result_check" CHECK ("result" IN ('PENDING', 'SUCCESS', 'FAILURE', 'REJECTED'));

ALTER TABLE "equipment_temper_audits"
  ADD CONSTRAINT "equipment_temper_audits_level_check" CHECK ("level_before" >= 0 AND "level_after" >= 0 AND "target_level" >= 1),
  ADD CONSTRAINT "equipment_temper_audits_result_check" CHECK ("result" IN ('SUCCESS', 'FAILURE', 'REJECTED'));
