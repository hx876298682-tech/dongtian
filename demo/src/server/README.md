# Server runtime boundary

The runnable MVP service is in this directory. `MemoryRepository` is an in-memory test double only; it is not an authoritative production store. Production wiring must provide the `Repository` interface with a PostgreSQL adapter that executes the same transaction/CAS contract. `migrations/V1_001_core.sql` is the PostgreSQL V1 schema baseline.

Run `npm run test:server`, `npm run typecheck:server`, or `npm run server` from `demo`.

The HTTP adapter bounds request-body buffering by bytes to protect the process
from oversized JSON requests. The default `DONGTIAN_HTTP_MAX_BODY_BYTES` is
`1048576` (1 MiB); deployments may lower or raise it up to `10485760` (10 MiB).
An oversized declared `Content-Length` is rejected before buffering, and a
chunked request is rejected as soon as the accumulated bytes exceed the limit.
Both paths return `413` with `error.code = REQUEST_BODY_TOO_LARGE` and drain the
remaining request stream so the connection can be reused. Malformed
`Content-Length` values remain `400 VALIDATION_FAILED`.

## HTTP API surface

The HTTP adapter is the authoritative public DTO boundary. Authenticated JSON
requests use camelCase fields; player-state mutation routes require
`Idempotency-Key` and an expected revision supplied either as the
`X-Expected-Revision` header or as body field `expectedRevision` (when both are
present they must match). Admin config rollout mutations (`canary`, `activate`,
`rollback`) require an `Idempotency-Key` but do not use player revisions;
`/v1/admin/config/refresh` is an empty-body refresh command and has no
idempotency field. The adapter rejects unknown fields and does not
provide snake_case or client-controlled outcome/seed/attempt compatibility
aliases.

Read-only routes:

- `GET /v1/bootstrap`
- `GET /v1/dungeons/{dungeonId}/preview`
- `GET /v1/high-tier/{realm}/preview`
- `GET /v1/replays/{settlementId}`
- `GET /v1/collection/events?limit=&before=`
- `GET /v1/leaderboards/{type}?limit=&offset=`
- `POST /v1/economy/long-term`: `horizonHours`, `seed` (read-only projection)
- `POST /v1/economy/long-term/equipment-consumption`: `horizonHours`, `seed` (read-only projection)
- `POST /v1/economy/long-term/confidence`: `horizonHours`, `seed`, `sampleCount` (read-only projection)
- `POST /v1/combat/preview`: `activityId`, `expectedRevision` (read-only preview)

State-changing routes and accepted JSON fields:

- `POST /v1/actions/start`: `actionId`, `expectedRevision`
- `POST /v1/actions/stop`: `settlementId`, `requestedStartedAt`, `requestedEndedAt`, `expectedRevision`
- `POST /v1/actions/switch`: the stop fields plus `actionId`
- `POST /v1/settlements/offline`: the stop fields without `actionId`
- `POST /v1/buildings/spirit_farm/plant`: `plots`, `expectedRevision` (does not occupy the global action slot; no seed cost is inferred)
- `POST /v1/buildings/{buildingId}/jobs`: `recipeId`, `quantity`, `expectedRevision`
- `POST /v1/buildings/{buildingId}/upgrade`: `expectedRevision`
- `POST /v1/equipment/{instanceId}/actions`: `action`, `expectedRevision`, and action-specific `lockSlots`, `slotIndex`, `target`, `targetAffix`
- `POST /v1/dungeons/start`: `dungeonId`, `expectedRevision`
- `POST /v1/dungeons/settle`: `attemptId`, `expectedRevision`
- `POST /v1/high-tier/start`: `realm`, `expectedRevision`
- `POST /v1/high-tier/settle`: `attemptId`, `expectedRevision`
- `POST /v1/combat/start`: `activityId`, `expectedRevision`
- `POST /v1/collection/actions`: `action`, optional `techniqueId`, `quality`, `treasureId`, `expectedRevision`
- `POST /v1/progression/breakthrough`: `expectedRevision`

Admin-only state-changing routes are `POST /v1/admin/config/refresh` (empty
body) and `POST /v1/admin/config/{canary|activate|rollback}` with
`version`, `reason`, and optional `canaryPercent`.

The public combat start route generates `attemptId` and the random seed on the
server. `outcome`, `seed`, and `attemptId` are rejected when supplied by the
client. JSON mutation and error responses carry `requestId`, `configVersion`,
`stateRevision`, and `serverTime`; `/healthz`, `/readyz`, and `/metrics` are
the documented non-envelope probe/scrape exceptions.

## Health boundary

`GET /healthz` is an unauthenticated liveness probe and returns only
`{"status":"ok"}`. `GET /readyz` is an unauthenticated readiness probe: it runs
bounded checks for PostgreSQL, the active config release, and the pending
settlement scanner, returning `200` only when all three are up and `503`
otherwise. Missing checks, failures, and timeouts fail closed. Both responses
set `Cache-Control: no-store` and intentionally omit URLs, release versions,
credentials, and error details. The production preflight already requires the
same PostgreSQL, active-config, and scanner deployment contract; the probes do
not replace external topology or certificate acceptance checks.

## Deployment preflight

Run `npm run preflight:deployment` before starting a production instance. This
is a deterministic configuration gate: it requires a PostgreSQL URL, durable
metrics, configured authentication, HTTPS webhook alerts, and rejects explicit
local fallbacks. It does not connect to PostgreSQL, fetch JWKS, validate a real
certificate chain, or send an alert. Those environment checks remain deployment
acceptance steps. The command never prints secret values.

### Environment acceptance harness

`npm run acceptance:production` is the environment-level gate that must follow
the static preflight. It deliberately does real, bounded probes and does not
turn a preflight `PASS` into an environment `PASS`. The command fails closed
when any input, probe, or evidence file is missing or stale; it never sends a
real alert payload.

The command requires these environment variables (secrets are supplied through
files and are never printed):

- `DONGTIAN_ACCEPTANCE_INSTANCE_URLS`: two or more distinct HTTPS service URLs.
  Each URL is probed at `/healthz` and `/readyz`; all database/config/scanner
  checks must be `up`. The verified sample JWT is also sent to a read-only
  leaderboard probe on every instance, proving the deployed auth boundary
  accepts the same issuer/audience/key configuration rather than only proving
  anonymous readiness.
- `DONGTIAN_ACCEPTANCE_JWKS_URL`, `DONGTIAN_ACCEPTANCE_JWKS_ISSUER`, and
  `DONGTIAN_ACCEPTANCE_JWKS_AUDIENCE`: the JWKS endpoint and expected claims.
  The harness fetches the endpoint over HTTPS, bounds the response to 1 MiB,
  validates unique RSA/RS256 signing keys, then verifies the compact JWT in
  `DONGTIAN_ACCEPTANCE_JWT_FILE` (including signature, `sub`, `exp`, `iss`, and
  `aud`) through the same JWKS provider used by the server.
- `DONGTIAN_ACCEPTANCE_WEBHOOK_URL` and optional
  `DONGTIAN_ACCEPTANCE_WEBHOOK_TOKEN_FILE`: a bounded `HEAD` reachability check
  only. No alert event is posted. A 404 or transport/5xx failure is rejected.
- `DONGTIAN_ACCEPTANCE_SCANNER_EVIDENCE_FILE`: fresh JSON evidence from an
  actual multi-instance scanner run. It must contain at least two distinct
  `instanceIds`, `attemptedSettlements`, matching committed/rejected/retryable
  counts, `duplicateCommits: 0`, `crossInstanceClaimObserved: true`, and at
  least one `expiredLeaseRecoveredSettlements`.
- `DONGTIAN_ACCEPTANCE_CAPACITY_REPORT_FILE` and
  `DONGTIAN_ACCEPTANCE_CAPACITY_SLO_FILE`: fresh report and explicit SLO JSON.
  The report must have internally consistent counts, monotonic latency
  percentiles, and an error array matching `failedSettlements`; the harness
  compares players, rounds, settlements, throughput, error rate, and P50/P95/P99
  against the supplied SLO floors/ceilings. No SLO values are invented by the
  harness.

`DONGTIAN_ACCEPTANCE_TIMEOUT_MS` (default 5000, maximum 120000) bounds network
probes. `DONGTIAN_ACCEPTANCE_MAX_EVIDENCE_AGE_MS` (default 24 hours, maximum 30
days) rejects stale scanner/capacity artifacts. A successful static preflight
with absent acceptance inputs therefore remains a failed production
acceptance, as intended.

PostgreSQL process settings are explicit in deployment: `DONGTIAN_DB_POOL_MAX`
(1-200), `DONGTIAN_DB_CONNECT_TIMEOUT_MS` (1-120000),
`DONGTIAN_DB_STATEMENT_TIMEOUT_MS` (1-600000),
`DONGTIAN_DB_QUERY_TIMEOUT_MS` (1-600000 and not shorter than statement timeout),
and `DONGTIAN_DB_IDLE_TIMEOUT_MS` (1000-600000). `DONGTIAN_DB_SSL_MODE`
must be `verify-full` for deployment; an optional `DONGTIAN_DB_SSL_CA` supplies
the CA bundle. The startup `Pool` uses the same bounded settings. This is a
configuration contract, not proof that the supplied CA, hostname, network
policy, or database topology is correct; those still require environment-level
acceptance.

## Identity provider boundary

`auth.ts` exposes an injectable `AuthProvider` contract. The default backend is
the existing local HS256 adapter when `DONGTIAN_JWT_SECRET` is present; its
issuer/audience checks remain controlled by `DONGTIAN_JWT_ISSUER` and
`DONGTIAN_JWT_AUDIENCE`. For a production OIDC-compatible key set, set
`DONGTIAN_AUTH_BACKEND=jwks`, `DONGTIAN_JWKS_URL` (HTTPS only),
`DONGTIAN_JWKS_ISSUER`, and `DONGTIAN_JWKS_AUDIENCE`. The provider accepts only
RS256 JWTs with a non-empty `kid`, requires `sub` and `exp`, verifies the RSA
signature against a bounded JWKS response, and refreshes an in-memory key cache
with `DONGTIAN_JWKS_CACHE_TTL_MS` (default 5 minutes). Fetches are bounded by
`DONGTIAN_JWKS_TIMEOUT_MS` (default 5 seconds); a key miss forces one refresh,
while network/configuration failures become `AUTH_REQUIRED` at the HTTP edge.

`DONGTIAN_AUTH_BACKEND=hs256` is the default production-compatible local
contract and requires `DONGTIAN_JWT_SECRET` (the runnable `main.ts` also
requires at least 32 characters). `DONGTIAN_AUTH_BACKEND=insecure` is allowed
only with `DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN=1` and is for local tests. The
legacy `DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER=1` remains a separate explicit
development-only `x-player-id` fallback. This repository contains provider and
HTTP verification tests, but does not claim a deployed external IdP, certificate
chain, JWKS rotation, or production topology until those environment-level
checks are run.

## PostgreSQL boundary

`V1_001_core.sql` is the persistence contract for the `src/server` runtime. The
runtime represents IDs as strings so the MemoryRepository can use readable test
fixtures. PostgreSQL validates player, settlement, and dungeon attempt IDs as UUIDs;
equipment instance IDs are stable content/runtime strings and are stored as text. The migration
keeps resource IDs in the `dongtian_resource_id` enum, persists `equipment_count`,
and stores the active dungeon state fields in `progress_state` so a restart can
restore combat phase, boss HP, carry time, and failure cooldown. A settlement's
UUID primary key is the idempotency constraint; repeated requests return the
stored response payload instead of creating a second record.

Each dungeon run is also persisted in `dungeon_attempt`. Its UUID primary key
is the attempt idempotency key, while seed, status, boss/phase counters,
`response_payload`, and `settled_at` preserve deterministic replay and repeated
settlement responses independently of the player's current active dungeon row.

## Metrics boundary

`metrics.ts` provides an injectable in-memory `MetricsCollector`. Service or HTTP
adapters can call `record()` at their commit/error boundaries without changing
API envelopes. It aggregates settlement outcomes and duration/pending age,
resource deltas and overflow, inventory-full events, map/dungeon outcomes, and
equipment growth actions. `snapshot()` returns a defensive read-only snapshot;
`queryAlerts(thresholds)` performs threshold checks without mutating metrics.
The collector is intentionally independent of the PostgreSQL adapter. For the
multi-instance MVP boundary, `V1_003_observability.sql` adds an append-only
`metrics_event` stream and `metrics-postgres.ts` provides an asynchronous
`PostgresMetricsStore`: event IDs are idempotent, all instances aggregate the
same PostgreSQL rows, and a newly created store can rebuild a snapshot after a
process restart. Set `DONGTIAN_METRICS_BACKEND=postgres` (with
`DATABASE_URL`) to wire that store into the service. Metric writes are
fire-and-forget and failures fall back to the local collector; `/metrics`
awaits the durable scrape and falls back to memory if PostgreSQL is unavailable.
The default `DONGTIAN_METRICS_BACKEND=memory` keeps the single-process behavior.
`DONGTIAN_METRICS_INSTANCE_ID` identifies a service instance, and
`DONGTIAN_METRICS_REQUIRE_ADMIN=1` requires an authenticated JWT with the
`admin` role for `/metrics` (authentication is always required).

Webhook alert dispatches are tracked independently from gameplay telemetry.
During SIGTERM/SIGINT the alert interval is stopped, new webhook sends are
rejected, and the process waits at most `DONGTIAN_ALERT_SHUTDOWN_TIMEOUT_MS`
(default 5000 ms, bounded 0-120000) for in-flight sends. Built-in fetch sends
are aborted if the bound expires; a custom injected publisher that cannot be
cancelled is reported as pending and does not block the remaining shutdown
steps.

## Config release boundary

`config-release.ts` provides an independent in-memory `ConfigReleaseRegistry`
for draft -> validated -> canary -> active lifecycle and historical rollback.
Registration requires manifest `config_version`, frozen parameter SHA, and
content SHA to agree; mismatches are rejected before a release is stored.
Canary assignment is deterministic per `(version, playerId)`. Seeded settlement
records store the exact config version, seed, and response payload at commit
time. Rollback only changes the active release pointer, so replaying a committed
settlement never recalculates it under the rolled-back version. `main.ts` wires
the PostgreSQL provider into request routing and historical replay; the in-memory
registry remains a test/integration adapter and is not a UI dependency.

`V1_002_config_release.sql` and `config-release-postgres.ts` provide the
durable boundary for this registry. `config_release` stores the versioned
manifest/content payload and rollout status with a partial unique index allowing
only one active version. `config_release_settlement` stores UUID settlement IDs,
the write-time config version, seed, and response payload for restart-safe replay.
The repository exposes draft creation, validation, activation, rollback, and
replay operations. Production startup still requires an active release unless
the explicit static-config local fallback is enabled.
