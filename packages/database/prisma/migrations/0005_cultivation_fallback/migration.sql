ALTER TABLE "action_queues"
  ALTER COLUMN "fallback_action_id" SET DEFAULT 'action.cultivation.qi';

ALTER TABLE "action_queue_entries"
  ADD COLUMN "blocked_reason" TEXT;

UPDATE "characters"
SET "realm_stage_id" = 'realm.mortal.entry'
WHERE "realm_stage_id" = 'realm.mortal.start';

UPDATE "character_progression"
SET "realm_stage_id" = 'realm.mortal.entry'
WHERE "realm_stage_id" = 'realm.mortal.start';

INSERT INTO "action_queues" ("character_id", "fallback_action_id")
SELECT "id", 'action.cultivation.qi'
FROM "characters"
ON CONFLICT ("character_id") DO NOTHING;
