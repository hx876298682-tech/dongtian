-- 洞天 Web MVP V1.001. PostgreSQL is the only authoritative state store.
create extension if not exists pgcrypto;

do $$
begin
  create type dongtian_resource_id as enum (
    'spirit_stone', 'spirit_herb', 'spirit_ore', 'spirit_wood', 'pill',
    'ancient_scroll', 'millennium_herb', 'meteor_iron', 'demon_core',
    'herb_zi_yun_hua', 'herb_ning_lu_cao', 'herb_jin_huan_she_xin', 'herb_chi_yan_zhi',
    'pill_zi_yun', 'pill_ning_lu', 'pill_huang_long', 'pill_chi_yan'
  );
exception when duplicate_object then null;
end $$;

create table if not exists player_state (
  player_id uuid primary key,
  realm_id text not null,
  substage_index smallint not null default 0,
  cultivation_xp bigint not null check (cultivation_xp >= 0),
  primary_action_id text,
  primary_action_target text,
  primary_action_started timestamptz,
  primary_action_carry_seconds bigint not null default 0 check (primary_action_carry_seconds >= 0),
  primary_action_model_version text not null default 'global_single_slot_v1',
  last_settled_at timestamptz not null,
  state_revision bigint not null default 0 check (state_revision >= 0),
  config_version text not null,
  equipment_count bigint not null default 0 check (equipment_count >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table player_state add column if not exists primary_action_model_version text not null default 'global_single_slot_v1';
alter table player_state add column if not exists primary_action_target text;

create table if not exists building_state (
  player_id uuid not null references player_state(player_id),
  building_id text not null,
  level smallint not null check (level between 1 and 5),
  active_job_id uuid,
  job_started_at timestamptz,
  carry_seconds numeric not null default 0 check (carry_seconds >= 0),
  carry_quantity numeric not null default 0 check (carry_quantity >= 0),
  planted_plots numeric,
  planted_at timestamptz,
  mature_at timestamptz,
  queued_job_ids jsonb not null default '[]'::jsonb,
  state_revision bigint not null default 0 check (state_revision >= 0),
  primary key (player_id, building_id)
);

alter table building_state add column if not exists carry_quantity numeric not null default 0;
alter table building_state add column if not exists planted_plots numeric;
alter table building_state add column if not exists planted_at timestamptz;
alter table building_state add column if not exists mature_at timestamptz;

-- Farm speed multipliers produce fractional intervals; retain carry precision
-- when upgrading installations that still have the original bigint column.
alter table building_state alter column carry_seconds type numeric using carry_seconds::numeric;

create table if not exists building_job (
  job_id uuid primary key,
  player_id uuid not null references player_state(player_id),
  building_id text not null,
  recipe_id text not null,
  remaining_quantity bigint not null check (remaining_quantity > 0),
  queued_at timestamptz not null
);

-- Explicit spirit-farm plots are independent from the legacy batch columns on
-- building_state. A row disappears atomically when its crop matures.
create table if not exists spirit_farm_plot_state (
  player_id uuid not null references player_state(player_id),
  plot_id text not null,
  plant_id text not null,
  planted_at timestamptz not null,
  mature_at timestamptz not null,
  state_revision bigint not null default 0,
  primary key (player_id, plot_id),
  check (length(plot_id) between 6 and 100),
  check (length(plant_id) between 1 and 100),
  check (mature_at > planted_at),
  check (state_revision >= 0)
);

alter table spirit_farm_plot_state add column if not exists plant_id text;
alter table spirit_farm_plot_state add column if not exists planted_at timestamptz;
alter table spirit_farm_plot_state add column if not exists mature_at timestamptz;
alter table spirit_farm_plot_state add column if not exists state_revision bigint not null default 0;

create table if not exists inventory_resource (
  player_id uuid not null references player_state(player_id),
  resource_id dongtian_resource_id not null,
  amount numeric not null check (amount >= 0),
  capacity numeric not null check (capacity >= 0),
  reserved_amount numeric not null default 0 check (reserved_amount >= 0),
  overflow_amount numeric not null default 0 check (overflow_amount >= 0),
  state_revision bigint not null default 0 check (state_revision >= 0),
  primary key (player_id, resource_id),
  check (amount + reserved_amount <= capacity)
);

-- Resource supply rates may be fractional; preserve existing integer rows while
-- allowing hourly settlement output to round-trip without truncation.
alter table inventory_resource alter column amount type numeric using amount::numeric;
alter table inventory_resource alter column capacity type numeric using capacity::numeric;
alter table inventory_resource alter column reserved_amount type numeric using reserved_amount::numeric;

-- The capacity invariant was part of the V1 contract from the beginning, but
-- CREATE TABLE alone does not add it to installations that already have the
-- inventory table. Keep the migration idempotent and fail closed if legacy
-- rows violate the invariant instead of silently changing their balances.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'inventory_resource'::regclass
       and conname = 'inventory_resource_amount_reserved_capacity'
  ) then
    alter table inventory_resource
      add constraint inventory_resource_amount_reserved_capacity
      check (amount + reserved_amount <= capacity);
  end if;
end $$;

-- Keep legacy installations under the same non-negative resource invariants.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'building_state'::regclass and conname = 'building_state_carry_seconds_nonnegative') then
    alter table building_state add constraint building_state_carry_seconds_nonnegative check (carry_seconds >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'building_state'::regclass and conname = 'building_state_carry_quantity_nonnegative') then
    alter table building_state add constraint building_state_carry_quantity_nonnegative check (carry_quantity >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'building_state'::regclass and conname = 'building_state_planted_plots_nonnegative') then
    alter table building_state add constraint building_state_planted_plots_nonnegative check (planted_plots is null or (planted_plots >= 0 and planted_plots = trunc(planted_plots)));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'building_state'::regclass and conname = 'building_state_planting_consistent') then
    alter table building_state add constraint building_state_planting_consistent check (
      (planted_plots is null and planted_at is null and mature_at is null)
      or (planted_plots = 0 and planted_at is null and mature_at is null)
      or (planted_plots > 0 and planted_at is not null and mature_at > planted_at)
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'inventory_resource'::regclass and conname = 'inventory_resource_overflow_nonnegative') then
    alter table inventory_resource add constraint inventory_resource_overflow_nonnegative check (overflow_amount >= 0);
  end if;
end $$;

create table if not exists equipment_instance (
  -- Equipment IDs are stable content/runtime strings; player and attempt IDs remain UUIDs.
  instance_id text not null,
  player_id uuid not null references player_state(player_id),
  template_id text not null,
  slot text not null check (slot in ('weapon', 'armor_1', 'armor_2', 'armor_3', 'armor_4', 'accessory')),
  quality text not null,
  reinforcement_level smallint not null default 0,
  awakening_level smallint not null default 0,
  affixes jsonb not null,
  locked_slots jsonb not null default '[]'::jsonb,
  is_equipped boolean not null default false,
  created_config_version text not null,
  created_at timestamptz not null,
  primary key (player_id, instance_id)
);

-- V1_001 originally used a global instance_id key. Stable content IDs are scoped
-- to a player, so migrate existing installations to the composite key.
do $$
declare
  primary_key_name text;
begin
  select c.conname
    into primary_key_name
    from pg_constraint c
   where c.conrelid = 'equipment_instance'::regclass
     and c.contype = 'p'
     and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (instance_id)';
  if primary_key_name is not null then
    execute format('alter table equipment_instance drop constraint %I', primary_key_name);
  end if;
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'equipment_instance'::regclass
       and c.contype = 'p'
       and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (player_id, instance_id)'
  ) then
    alter table equipment_instance add primary key (player_id, instance_id);
  end if;
end $$;

create table if not exists collection_state (
  player_id uuid primary key references player_state(player_id),
  technique_layers jsonb not null default '{}'::jsonb,
  technique_research_xp bigint not null default 0 check (technique_research_xp >= 0),
  treasure_stars jsonb not null default '{}'::jsonb,
  collection_marks bigint not null default 0 check (collection_marks >= 0),
  duplicate_balances jsonb not null default '{}'::jsonb,
  mark_balances jsonb not null default '{}'::jsonb,
  state_revision bigint not null default 0 check (state_revision >= 0)
);

alter table collection_state add column if not exists technique_research_xp bigint not null default 0;
alter table collection_state add column if not exists mark_balances jsonb not null default '{}'::jsonb;

-- FI-05 migration A: old unscoped marks have no source provenance. Assign
-- them once to starter; never copy them into multiple pools.
do $$
begin
  if exists (select 1 from collection_state where collection_marks < 0) then
    raise exception 'legacy collection marks contain a negative value';
  end if;
  update collection_state
     set mark_balances = jsonb_build_object('starter', collection_marks)
   where mark_balances = '{}'::jsonb and collection_marks > 0;
end $$;

-- Collection marks are a consumable counter. Keep legacy installations under
-- the same non-negative invariant before any future exchange mutation exists.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'collection_state'::regclass
       and conname = 'collection_state_collection_marks_nonnegative'
  ) then
    alter table collection_state
      add constraint collection_state_collection_marks_nonnegative
      check (collection_marks >= 0);
  end if;
end $$;

create table if not exists progress_state (
  player_id uuid primary key references player_state(player_id),
  map_pity jsonb not null default '{}'::jsonb,
  dungeon_pity jsonb not null default '{}'::jsonb,
  random_event_state jsonb not null default '{}'::jsonb,
  support_route_state jsonb not null default '{}'::jsonb,
  high_tier_gate_state jsonb not null default '{}'::jsonb,
  failure_cooldowns jsonb not null default '{}'::jsonb,
  active_dungeon_id text,
  dungeon_status text not null default 'idle' check (dungeon_status in ('idle', 'fighting', 'success', 'failed', 'cooldown')),
  dungeon_phase smallint not null default 0 check (dungeon_phase >= 0),
  dungeon_boss_hp bigint not null default 0 check (dungeon_boss_hp >= 0),
  dungeon_started_at timestamptz,
  dungeon_carry_seconds bigint not null default 0 check (dungeon_carry_seconds >= 0),
  dungeon_failure_cooldown_until timestamptz,
  random_state jsonb not null,
  auto_promotion_state jsonb not null default '{}'::jsonb,
  state_revision bigint not null default 0 check (state_revision >= 0)
);

alter table progress_state add column if not exists random_event_state jsonb not null default '{}'::jsonb;
alter table progress_state add column if not exists support_route_state jsonb not null default '{}'::jsonb;
alter table progress_state add column if not exists auto_promotion_state jsonb not null default '{}'::jsonb;

-- Boss simulation may leave a fractional HP remainder on a failed timeout.
-- Keep the authoritative snapshot lossless across PostgreSQL round-trips.
alter table progress_state alter column dungeon_boss_hp type numeric using dungeon_boss_hp::numeric;

create table if not exists dungeon_attempt (
  attempt_id uuid primary key,
  player_id uuid not null references player_state(player_id),
  dungeon_id text not null check (dungeon_id in ('qing_feng', 'yan_prison', 'sky_abyss')),
  config_version text,
  config_snapshot jsonb,
  seed bigint not null,
  status text not null check (status in ('active', 'succeeded', 'failed')),
  started_at timestamptz not null,
  settled_at timestamptz,
  boss_hp numeric not null,
  boss_max_hp numeric not null,
  barrier numeric not null,
  phase smallint not null check (phase in (1, 2)),
  elapsed_seconds integer not null default 0,
  stun_seconds integer not null default 0,
  spirit_burn_seconds integer not null default 0,
  spirit_burn_damage numeric not null default 0,
  boss_damage_taken numeric not null default 0,
  boss_damage_multiplier numeric not null default 1,
  combat_snapshot jsonb,
  failure_reason text,
  response_payload jsonb,
  state_revision bigint not null default 0 check (state_revision >= 0)
);

alter table dungeon_attempt add column if not exists combat_snapshot jsonb;
alter table dungeon_attempt add column if not exists config_version text;
alter table dungeon_attempt add column if not exists config_snapshot jsonb;
-- Bounded deterministic combat trace for settlement replay/audit. Older rows
-- remain readable with an empty trace.
alter table dungeon_attempt add column if not exists combat_events jsonb not null default '[]'::jsonb;

create table if not exists settlement_record (
  settlement_id uuid primary key,
  player_id uuid not null references player_state(player_id),
  request_started_at timestamptz not null,
  request_ended_at timestamptz not null,
  settled_seconds bigint not null check (settled_seconds between 0 and 86400),
  expected_revision bigint not null check (expected_revision >= 0),
  committed_revision bigint check (committed_revision >= 0),
  config_version text not null,
  summary_hash text not null,
  status text not null check (status in ('pending', 'committed', 'rejected')),
  response_payload jsonb not null,
  created_at timestamptz not null,
  committed_at timestamptz,
  -- Scanner workers claim pending rows for a bounded lease. A NULL lease is
  -- available; expiry makes rows recoverable after a crashed worker.
  claim_token text,
  claim_until timestamptz
);

alter table settlement_record add column if not exists claim_token text;
alter table settlement_record add column if not exists claim_until timestamptz;

create table if not exists audit_event (
  event_id uuid primary key,
  player_id uuid not null references player_state(player_id),
  settlement_id uuid references settlement_record(settlement_id),
  event_type text not null,
  before_revision bigint not null check (before_revision >= 0),
  after_revision bigint not null check (after_revision >= 0),
  config_version text not null,
  payload_hash text not null,
  payload jsonb,
  created_at timestamptz not null
);

-- Collection changes are kept as a separate append-only stream so research,
-- duplicate treasure conversion and overflow marks can be replayed without
-- interpreting the general audit payload.
create table if not exists collection_event (
  event_id uuid primary key,
  player_id uuid not null references player_state(player_id) on delete cascade,
  event_type text not null,
  before_revision bigint not null check (before_revision >= 0),
  after_revision bigint not null check (after_revision >= 0),
  config_version text not null,
  payload_hash text not null,
  payload jsonb not null,
  created_at timestamptz not null
);

alter table audit_event add column if not exists payload jsonb;

create table if not exists action_idempotency (
  action_key text primary key,
  player_id uuid not null references player_state(player_id),
  response_payload jsonb not null,
  created_at timestamptz not null
);

create index if not exists settlement_record_player_created_idx on settlement_record(player_id, created_at);
create index if not exists settlement_record_pending_created_idx on settlement_record(created_at, settlement_id) where status = 'pending';
create index if not exists settlement_record_pending_claim_idx on settlement_record(claim_until, created_at, settlement_id) where status = 'pending';
create index if not exists audit_event_player_created_idx on audit_event(player_id, created_at);
create index if not exists collection_event_player_created_idx on collection_event(player_id, created_at, event_id);

-- State revisions are CAS cursors and cannot be negative. Add the invariant
-- to installations created before the executable CREATE definitions above.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'player_state'::regclass and conname = 'player_state_revision_nonnegative') then
    alter table player_state add constraint player_state_revision_nonnegative check (state_revision >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'building_state'::regclass and conname = 'building_state_revision_nonnegative') then
    alter table building_state add constraint building_state_revision_nonnegative check (state_revision >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'inventory_resource'::regclass and conname = 'inventory_resource_revision_nonnegative') then
    alter table inventory_resource add constraint inventory_resource_revision_nonnegative check (state_revision >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'collection_state'::regclass and conname = 'collection_state_revision_nonnegative') then
    alter table collection_state add constraint collection_state_revision_nonnegative check (state_revision >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'progress_state'::regclass and conname = 'progress_state_revision_nonnegative') then
    alter table progress_state add constraint progress_state_revision_nonnegative check (state_revision >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dungeon_attempt'::regclass and conname = 'dungeon_attempt_revision_nonnegative') then
    alter table dungeon_attempt add constraint dungeon_attempt_revision_nonnegative check (state_revision >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'settlement_record'::regclass and conname = 'settlement_record_expected_revision_nonnegative') then
    alter table settlement_record add constraint settlement_record_expected_revision_nonnegative check (expected_revision >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'settlement_record'::regclass and conname = 'settlement_record_committed_revision_nonnegative') then
    alter table settlement_record add constraint settlement_record_committed_revision_nonnegative check (committed_revision >= 0);
  end if;
end $$;
create index if not exists action_idempotency_player_created_idx on action_idempotency(player_id, created_at);
