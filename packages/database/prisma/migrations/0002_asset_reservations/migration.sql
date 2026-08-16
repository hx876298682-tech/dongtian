-- CreateEnum
CREATE TYPE "AssetReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "asset_reservations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "business_type" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "quantity" DECIMAL(30,6) NOT NULL,
    "status" "AssetReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_transaction_id" UUID NOT NULL,
    "consumed_transaction_id" UUID,
    "released_transaction_id" UUID,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_reservations_character_id_status_idx"
ON "asset_reservations"("character_id", "status");

CREATE INDEX "asset_reservations_business_type_business_id_idx"
ON "asset_reservations"("business_type", "business_id");

CREATE UNIQUE INDEX "asset_reservations_consumed_transaction_id_key"
ON "asset_reservations"("consumed_transaction_id");

CREATE UNIQUE INDEX "asset_reservations_released_transaction_id_key"
ON "asset_reservations"("released_transaction_id");

CREATE UNIQUE INDEX "asset_reservations_active_business_asset_key"
ON "asset_reservations"("business_type", "business_id", "asset_type", "asset_id")
WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "asset_reservations"
ADD CONSTRAINT "asset_reservations_character_id_fkey"
FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asset_reservations"
ADD CONSTRAINT "asset_reservations_created_transaction_id_fkey"
FOREIGN KEY ("created_transaction_id") REFERENCES "asset_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asset_reservations"
ADD CONSTRAINT "asset_reservations_consumed_transaction_id_fkey"
FOREIGN KEY ("consumed_transaction_id") REFERENCES "asset_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asset_reservations"
ADD CONSTRAINT "asset_reservations_released_transaction_id_fkey"
FOREIGN KEY ("released_transaction_id") REFERENCES "asset_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-field invariants not expressible in the Prisma schema.
ALTER TABLE "asset_reservations"
  ADD CONSTRAINT "asset_reservations_quantity_positive_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "asset_reservations_asset_type_check" CHECK ("asset_type" IN ('ITEM', 'CURRENCY')),
  ADD CONSTRAINT "asset_reservations_item_quantity_integer_check"
    CHECK ("asset_type" <> 'ITEM' OR "quantity" = trunc("quantity"));

-- CreateTable
CREATE TABLE "equipment_instances" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "temper_level" INTEGER NOT NULL DEFAULT 0,
    "bound" BOOLEAN NOT NULL DEFAULT false,
    "created_transaction_id" UUID NOT NULL,
    "created_config_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_instances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "equipment_instances_character_id_created_at_idx"
ON "equipment_instances"("character_id", "created_at");

ALTER TABLE "equipment_instances"
ADD CONSTRAINT "equipment_instances_character_id_fkey"
FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_instances"
ADD CONSTRAINT "equipment_instances_created_transaction_id_fkey"
FOREIGN KEY ("created_transaction_id") REFERENCES "asset_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_instances"
  ADD CONSTRAINT "equipment_instances_temper_level_non_negative_check" CHECK ("temper_level" >= 0);
