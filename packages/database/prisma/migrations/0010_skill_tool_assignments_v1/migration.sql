CREATE TABLE "skill_tool_assignments" (
    "character_id" UUID NOT NULL,
    "skill_id" TEXT NOT NULL,
    "equipment_instance_id" UUID NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_tool_assignments_pkey" PRIMARY KEY ("character_id", "skill_id")
);

CREATE INDEX "skill_tool_assignments_character_id_updated_at_idx"
  ON "skill_tool_assignments"("character_id", "updated_at");

ALTER TABLE "skill_tool_assignments"
  ADD CONSTRAINT "skill_tool_assignments_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_tool_assignments"
  ADD CONSTRAINT "skill_tool_assignments_equipment_instance_id_fkey"
  FOREIGN KEY ("equipment_instance_id") REFERENCES "equipment_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "skill_tool_assignments"
  ADD CONSTRAINT "skill_tool_assignments_version_non_negative_check"
  CHECK ("version" >= 0);
