-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ANONYMOUS', 'REGISTERED');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" "AccountType" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_normalized" TEXT,
    "username_normalized" TEXT,
    "password_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" UUID NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "csrf_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "realm_stage_id" TEXT NOT NULL,
    "state_version" BIGINT NOT NULL DEFAULT 0,
    "active_config_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_progression" (
    "character_id" UUID NOT NULL,
    "cultivation_xp" DECIMAL(30,6) NOT NULL,
    "realm_stage_id" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_progression_pkey" PRIMARY KEY ("character_id")
);

-- CreateTable
CREATE TABLE "skill_progression" (
    "character_id" UUID NOT NULL,
    "skill_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" DECIMAL(30,6) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_progression_pkey" PRIMARY KEY ("character_id","skill_id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "character_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "reserved_quantity" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("character_id","item_id")
);

-- CreateTable
CREATE TABLE "currency_balances" (
    "character_id" UUID NOT NULL,
    "currency_id" TEXT NOT NULL,
    "quantity" DECIMAL(30,6) NOT NULL,
    "reserved_quantity" DECIMAL(30,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_balances_pkey" PRIMARY KEY ("character_id","currency_id")
);

-- CreateTable
CREATE TABLE "asset_transactions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "operation_type" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "idempotency_record_id" UUID,
    "config_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_ledger" (
    "entry_id" UUID NOT NULL DEFAULT uuidv7(),
    "transaction_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "delta" DECIMAL(30,6) NOT NULL,
    "balance_after" DECIMAL(30,6) NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "config_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_ledger_pkey" PRIMARY KEY ("entry_id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" UUID NOT NULL,
    "operation_type" TEXT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "http_status" INTEGER NOT NULL,
    "response_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_releases" (
    "config_version" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "formula_version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "previous_version" TEXT,
    "min_client_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),
    "created_by" TEXT NOT NULL,

    CONSTRAINT "config_releases_pkey" PRIMARY KEY ("config_version")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "transaction_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_normalized_key" ON "accounts"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_username_normalized_key" ON "accounts"("username_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_hash_key" ON "sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "sessions_account_id_idx" ON "sessions"("account_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "characters_account_id_key" ON "characters"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_transactions_idempotency_record_id_key" ON "asset_transactions"("idempotency_record_id");

-- CreateIndex
CREATE INDEX "asset_transactions_character_id_created_at_idx" ON "asset_transactions"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "asset_ledger_character_id_created_at_idx" ON "asset_ledger"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "asset_ledger_transaction_id_idx" ON "asset_ledger"("transaction_id");

-- CreateIndex
CREATE INDEX "asset_ledger_reference_type_reference_id_idx" ON "asset_ledger"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_ledger_transaction_id_asset_type_asset_id_entry_id_key" ON "asset_ledger"("transaction_id", "asset_type", "asset_id", "entry_id");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_account_id_operation_type_idempotency_k_key" ON "idempotency_records"("account_id", "operation_type", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "config_releases_content_hash_key" ON "config_releases"("content_hash");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_progression" ADD CONSTRAINT "character_progression_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_progression" ADD CONSTRAINT "skill_progression_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_balances" ADD CONSTRAINT "currency_balances_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_ledger" ADD CONSTRAINT "asset_ledger_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "asset_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_ledger" ADD CONSTRAINT "asset_ledger_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "asset_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Cross-field and non-negative invariants not expressible in the Prisma schema.
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_registration_identity_check"
  CHECK (
    ("type" = 'ANONYMOUS' AND "email_normalized" IS NULL AND "username_normalized" IS NULL AND "password_hash" IS NULL)
    OR
    ("type" = 'REGISTERED' AND ("email_normalized" IS NOT NULL OR "username_normalized" IS NOT NULL) AND "password_hash" IS NOT NULL)
  );

ALTER TABLE "characters"
  ADD CONSTRAINT "characters_state_version_non_negative_check"
  CHECK ("state_version" >= 0);

ALTER TABLE "character_progression"
  ADD CONSTRAINT "character_progression_cultivation_xp_non_negative_check"
  CHECK ("cultivation_xp" >= 0);

ALTER TABLE "skill_progression"
  ADD CONSTRAINT "skill_progression_level_positive_check" CHECK ("level" >= 1),
  ADD CONSTRAINT "skill_progression_xp_non_negative_check" CHECK ("xp" >= 0);

ALTER TABLE "inventories"
  ADD CONSTRAINT "inventories_quantity_non_negative_check" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "inventories_reserved_quantity_non_negative_check" CHECK ("reserved_quantity" >= 0),
  ADD CONSTRAINT "inventories_reserved_quantity_within_quantity_check" CHECK ("reserved_quantity" <= "quantity");

ALTER TABLE "currency_balances"
  ADD CONSTRAINT "currency_balances_quantity_non_negative_check" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "currency_balances_reserved_quantity_non_negative_check" CHECK ("reserved_quantity" >= 0),
  ADD CONSTRAINT "currency_balances_reserved_quantity_within_quantity_check" CHECK ("reserved_quantity" <= "quantity");

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_http_status_check" CHECK ("http_status" BETWEEN 100 AND 599);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempt_count_non_negative_check" CHECK ("attempt_count" >= 0);

CREATE OR REPLACE FUNCTION prevent_asset_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'asset_ledger is immutable';
END;
$$;

CREATE TRIGGER asset_ledger_immutable_trigger
BEFORE UPDATE OR DELETE ON "asset_ledger"
FOR EACH ROW EXECUTE FUNCTION prevent_asset_ledger_mutation();
