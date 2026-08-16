CREATE TABLE "loadout_presets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "character_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weapon_instance_id" UUID,
    "armor_instance_id" UUID,
    "accessory_instance_id" UUID,
    "combat_consumables" JSONB NOT NULL DEFAULT '[]',
    "strategy_id" TEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loadout_presets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loadout_presets_character_id_updated_at_idx"
  ON "loadout_presets"("character_id", "updated_at");

ALTER TABLE "loadout_presets"
  ADD CONSTRAINT "loadout_presets_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loadout_presets"
  ADD CONSTRAINT "loadout_presets_weapon_instance_id_fkey"
  FOREIGN KEY ("weapon_instance_id") REFERENCES "equipment_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loadout_presets"
  ADD CONSTRAINT "loadout_presets_armor_instance_id_fkey"
  FOREIGN KEY ("armor_instance_id") REFERENCES "equipment_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loadout_presets"
  ADD CONSTRAINT "loadout_presets_accessory_instance_id_fkey"
  FOREIGN KEY ("accessory_instance_id") REFERENCES "equipment_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "characters"
  ADD COLUMN "active_loadout_preset_id" UUID;

ALTER TABLE "characters"
  ADD CONSTRAINT "characters_active_loadout_preset_id_fkey"
  FOREIGN KEY ("active_loadout_preset_id") REFERENCES "loadout_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "characters_active_loadout_preset_id_idx"
  ON "characters"("active_loadout_preset_id");

ALTER TABLE "loadout_presets"
  ADD CONSTRAINT "loadout_presets_version_non_negative_check" CHECK ("version" >= 0);
