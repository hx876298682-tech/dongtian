CREATE TABLE "buff_instances" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "buff_config_id" TEXT NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "stack_group" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "source_transaction_id" UUID NOT NULL,
    "config_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buff_instances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "buff_instances_character_id_slot_index_idx"
  ON "buff_instances"("character_id", "slot_index");

CREATE INDEX "buff_instances_character_id_expires_at_idx"
  ON "buff_instances"("character_id", "expires_at");

ALTER TABLE "buff_instances"
  ADD CONSTRAINT "buff_instances_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "buff_instances_started_before_expiry_check"
  CHECK ("expires_at" >= "started_at"),
  ADD CONSTRAINT "buff_instances_slot_index_positive_check"
  CHECK ("slot_index" > 0);
