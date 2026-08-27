-- 洞天 Web MVP V1.002. Versioned config release and replay history.
-- Applied after V1_001_core.sql; deployment code owns rollout transitions.

create table if not exists config_release (
  version text primary key,
  parameter_sha256 text not null,
  content_sha256 text not null,
  status text not null check (status in ('draft', 'validated', 'canary', 'active', 'rolled_back')),
  canary_percent numeric not null default 0 check (canary_percent >= 0 and canary_percent <= 100),
  created_at timestamptz not null,
  validated_at timestamptz,
  activated_at timestamptz,
  rolled_back_at timestamptz,
  transition_reason text check (transition_reason is null or transition_reason in ('manual', 'rollback', 'superseded')),
  content_payload jsonb not null,
  parameter_payload jsonb not null default '{}'::jsonb,
  migration_policy jsonb,
  check (status <> 'canary' or canary_percent > 0),
  check (status <> 'active' or canary_percent = 100)
);

alter table config_release add column if not exists parameter_payload jsonb not null default '{}'::jsonb;
alter table config_release add column if not exists migration_policy jsonb;

create unique index if not exists config_release_one_active_idx on config_release(status) where status = 'active';

create table if not exists config_release_settlement (
  settlement_id uuid primary key,
  config_version text not null references config_release(version),
  seed bigint not null check (seed between 0 and 4294967295),
  response_payload jsonb not null,
  committed_at timestamptz not null
);

create index if not exists config_release_settlement_version_idx on config_release_settlement(config_version, committed_at);

create table if not exists config_release_audit (
  audit_id uuid primary key,
  operation text not null check (operation in ('canary', 'activate', 'rollback')),
  target_version text not null references config_release(version),
  from_version text references config_release(version),
  to_version text references config_release(version),
  operator_subject text not null,
  reason text not null,
  created_at timestamptz not null
);

create index if not exists config_release_audit_created_idx on config_release_audit(created_at, audit_id);

-- Rollout idempotency is separate from player action idempotency: the key is
-- operator-scoped and the response is committed atomically with the release
-- transition and its audit row, so a retry after restart cannot re-apply it.
create table if not exists config_release_operation (
  operation_key text primary key,
  operation text not null check (operation in ('canary', 'activate', 'rollback')),
  target_version text not null references config_release(version),
  operator_subject text not null,
  reason text not null,
  request_id text not null,
  response_payload jsonb not null,
  created_at timestamptz not null
);

create index if not exists config_release_operation_created_idx on config_release_operation(created_at, operation_key);
