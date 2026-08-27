-- 洞天 Web MVP V1.003. Durable, cross-instance operational metrics.
-- Events are append-only and idempotent by event_id. Aggregation is performed
-- by the metrics adapter, so every service instance can share this table.

create table if not exists metrics_event (
  event_id uuid primary key,
  instance_id text not null,
  event_type text not null,
  event_at timestamptz not null,
  duration_ms numeric,
  pending_age_ms numeric,
  resource_delta jsonb not null default '{}'::jsonb,
  resource_overflow jsonb not null default '{}'::jsonb,
  growth text,
  drop_key text,
  drop_expected numeric,
  drop_actual numeric,
  anomaly_key text,
  anomaly_value numeric,
  created_at timestamptz not null default now()
);

alter table metrics_event add column if not exists drop_key text;
alter table metrics_event add column if not exists drop_expected numeric;
alter table metrics_event add column if not exists drop_actual numeric;
alter table metrics_event add column if not exists anomaly_key text;
alter table metrics_event add column if not exists anomaly_value numeric;

create index if not exists metrics_event_at_idx on metrics_event(event_at, event_id);
create index if not exists metrics_event_instance_idx on metrics_event(instance_id, event_at);
