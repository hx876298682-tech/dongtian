import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthProvider } from './auth.ts';
import { runDeploymentPreflight } from './deployment-preflight.ts';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type AcceptanceStatus = 'pass' | 'fail' | 'not_run';
export type AcceptanceCheck = { name: string; status: AcceptanceStatus; detail: string };
export type ProductionAcceptanceResult = { ok: boolean; checks: AcceptanceCheck[] };

type AcceptanceConfig = {
  instanceUrls: string[];
  jwksUrl: string;
  issuer: string;
  audience: string;
  jwtFile: string;
  webhookUrl: string;
  webhookTokenFile?: string;
  scannerEvidenceFile: string;
  capacityReportFile: string;
  capacitySloFile: string;
  timeoutMs: number;
  maxEvidenceAgeMs: number;
};

type ScannerEvidence = {
  generatedAt: string;
  instanceIds: string[];
  attemptedSettlements: number;
  committedSettlements: number;
  rejectedSettlements: number;
  retryableSettlements: number;
  duplicateCommits: number;
  crossInstanceClaimObserved: boolean;
  expiredLeaseRecoveredSettlements: number;
};

const check = (name: string, status: AcceptanceStatus, detail: string): AcceptanceCheck => ({ name, status, detail });
const failMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const duration = (env: NodeJS.ProcessEnv, key: string, fallback: number, max: number): number => {
  const raw = env[key] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer between 1 and ${max}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${key} must be an integer between 1 and ${max}`);
  return value;
};

const httpsUrl = (raw: string, key: string): string => {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`${key} must be a valid HTTPS URL`); }
  if (parsed.protocol !== 'https:') throw new Error(`${key} must use HTTPS`);
  if (parsed.username || parsed.password) throw new Error(`${key} must not contain credentials`);
  return parsed.toString().replace(/\/$/, '');
};

const readConfig = (env: NodeJS.ProcessEnv): AcceptanceConfig => {
  const instanceUrls = required(env, 'DONGTIAN_ACCEPTANCE_INSTANCE_URLS').split(',').map((value) => httpsUrl(value.trim(), 'DONGTIAN_ACCEPTANCE_INSTANCE_URLS'));
  if (instanceUrls.length < 2 || new Set(instanceUrls).size !== instanceUrls.length) throw new Error('DONGTIAN_ACCEPTANCE_INSTANCE_URLS must contain at least two distinct HTTPS instance URLs');
  return {
    instanceUrls,
    jwksUrl: httpsUrl(required(env, 'DONGTIAN_ACCEPTANCE_JWKS_URL'), 'DONGTIAN_ACCEPTANCE_JWKS_URL'),
    issuer: required(env, 'DONGTIAN_ACCEPTANCE_JWKS_ISSUER'),
    audience: required(env, 'DONGTIAN_ACCEPTANCE_JWKS_AUDIENCE'),
    jwtFile: required(env, 'DONGTIAN_ACCEPTANCE_JWT_FILE'),
    webhookUrl: httpsUrl(required(env, 'DONGTIAN_ACCEPTANCE_WEBHOOK_URL'), 'DONGTIAN_ACCEPTANCE_WEBHOOK_URL'),
    webhookTokenFile: env.DONGTIAN_ACCEPTANCE_WEBHOOK_TOKEN_FILE?.trim() || undefined,
    scannerEvidenceFile: required(env, 'DONGTIAN_ACCEPTANCE_SCANNER_EVIDENCE_FILE'),
    capacityReportFile: required(env, 'DONGTIAN_ACCEPTANCE_CAPACITY_REPORT_FILE'),
    capacitySloFile: required(env, 'DONGTIAN_ACCEPTANCE_CAPACITY_SLO_FILE'),
    timeoutMs: duration(env, 'DONGTIAN_ACCEPTANCE_TIMEOUT_MS', 5_000, 120_000),
    maxEvidenceAgeMs: duration(env, 'DONGTIAN_ACCEPTANCE_MAX_EVIDENCE_AGE_MS', 86_400_000, 2_592_000_000),
  };
};

const readNonEmptyFile = async (path: string, label: string): Promise<string> => {
  const value = (await readFile(path, 'utf8')).trim();
  if (!value) throw new Error(`${label} is empty`);
  return value;
};

const readJsonFile = async (path: string, label: string): Promise<unknown> => {
  const raw = await readNonEmptyFile(path, label);
  try { return JSON.parse(raw) as unknown; }
  catch { throw new Error(`${label} is not valid JSON`); }
};

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
};

const finite = (value: unknown, label: string, min = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new Error(`${label} must be a finite number >= ${min}`);
  return value;
};

const integer = (value: unknown, label: string, min = 0): number => {
  const result = finite(value, label, min);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a safe integer`);
  return result;
};

const freshTimestamp = (value: unknown, label: string, maxAgeMs: number, now: number): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO timestamp`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO timestamp`);
  if (timestamp > now + 300_000) throw new Error(`${label} is more than 5 minutes in the future`);
  if (now - timestamp > maxAgeMs) throw new Error(`${label} is older than the configured evidence age`);
  return value;
};

const fetchBounded = async (fetchFn: FetchLike, url: string, timeoutMs: number, init?: RequestInit): Promise<Response> => fetchFn(url, {
  ...init,
  signal: AbortSignal.timeout(timeoutMs),
});

const validateJwks = async (config: AcceptanceConfig, fetchFn: FetchLike): Promise<void> => {
  const response = await fetchBounded(fetchFn, config.jwksUrl, config.timeoutMs, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`JWKS endpoint returned HTTP ${response.status}`);
  const length = response.headers.get('content-length');
  if (length && Number(length) > 1_000_000) throw new Error('JWKS response exceeds 1 MB');
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > 1_000_000) throw new Error('JWKS response exceeds 1 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error('JWKS response is not valid JSON'); }
  const keys = record(parsed, 'JWKS response').keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100) throw new Error('JWKS response must contain 1 to 100 keys');
  const kids = new Set<string>();
  for (const [index, rawKey] of keys.entries()) {
    const key = record(rawKey, `JWKS key ${index}`);
    if (key.kty !== 'RSA' || (key.alg !== undefined && key.alg !== 'RS256') || typeof key.kid !== 'string' || key.kid.length === 0 || typeof key.n !== 'string' || key.n.length === 0 || typeof key.e !== 'string' || key.e.length === 0) {
      throw new Error(`JWKS key ${index} must declare unique kid, RSA, RS256, n and e`);
    }
    if (key.use !== undefined && key.use !== 'sig') throw new Error(`JWKS key ${index} use must be sig when supplied`);
    if (kids.has(key.kid)) throw new Error(`JWKS contains duplicate kid ${key.kid}`);
    kids.add(key.kid);
  }
};

const validateJwt = async (config: AcceptanceConfig, fetchFn: FetchLike): Promise<string> => {
  const token = await readNonEmptyFile(config.jwtFile, 'acceptance JWT file');
  const provider = createAuthProvider({
    DONGTIAN_AUTH_BACKEND: 'jwks',
    DONGTIAN_JWKS_URL: config.jwksUrl,
    DONGTIAN_JWKS_ISSUER: config.issuer,
    DONGTIAN_JWKS_AUDIENCE: config.audience,
    DONGTIAN_JWKS_TIMEOUT_MS: String(config.timeoutMs),
  }, fetchFn);
  const identity = await provider.authenticate(token);
  if (!identity.subject.trim()) throw new Error('verified JWT subject is empty');
  return token;
};

const validateWebhookReachability = async (config: AcceptanceConfig, fetchFn: FetchLike): Promise<string> => {
  const headers: Record<string, string> = {};
  if (config.webhookTokenFile) headers.authorization = `Bearer ${await readNonEmptyFile(config.webhookTokenFile, 'webhook token file')}`;
  const response = await fetchBounded(fetchFn, config.webhookUrl, config.timeoutMs, { method: 'HEAD', headers, redirect: 'manual' });
  // A reachable URL is not enough for production acceptance: redirects and
  // client/server errors can hide a wrong route or rejected credentials. The
  // probe must receive an affirmative 2xx response before we claim the
  // configured endpoint is usable. Alert delivery is still never invoked.
  if (response.status < 200 || response.status >= 300) throw new Error(`webhook endpoint returned HTTP ${response.status}`);
  return `reachable via HEAD (HTTP ${response.status}); alert delivery was not invoked`;
};

const validateInstances = async (config: AcceptanceConfig, fetchFn: FetchLike, token: string | undefined): Promise<void> => {
  if (!token) throw new Error('verified acceptance JWT is unavailable for instance probe');
  for (const [index, baseUrl] of config.instanceUrls.entries()) {
    const health = await fetchBounded(fetchFn, `${baseUrl}/healthz`, config.timeoutMs, { headers: { accept: 'application/json' } });
    if (health.status !== 200) throw new Error(`instance ${index + 1} healthz returned HTTP ${health.status}`);
    const healthBody = record(await health.json(), `instance ${index + 1} healthz`);
    if (healthBody.status !== 'ok') throw new Error(`instance ${index + 1} healthz did not report ok`);
    const readiness = await fetchBounded(fetchFn, `${baseUrl}/readyz`, config.timeoutMs, { headers: { accept: 'application/json' } });
    if (readiness.status !== 200) throw new Error(`instance ${index + 1} readyz returned HTTP ${readiness.status}`);
    const readyBody = record(await readiness.json(), `instance ${index + 1} readyz`);
    const checks = record(readyBody.checks, `instance ${index + 1} readyz checks`);
    if (readyBody.status !== 'ok' || checks.database !== 'up' || checks.config !== 'up' || checks.scanner !== 'up') throw new Error(`instance ${index + 1} readyz did not report database/config/scanner up`);
    const authenticated = await fetchBounded(fetchFn, `${baseUrl}/v1/leaderboards/combat_power?limit=1&offset=0`, config.timeoutMs, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    });
    if (authenticated.status !== 200) throw new Error(`instance ${index + 1} authenticated probe returned HTTP ${authenticated.status}`);
  }
};

export const validateScannerEvidence = (value: unknown, maxAgeMs: number, now = Date.now()): ScannerEvidence => {
  const evidence = record(value, 'scanner evidence');
  freshTimestamp(evidence.generatedAt, 'scanner evidence generatedAt', maxAgeMs, now);
  if (!Array.isArray(evidence.instanceIds) || evidence.instanceIds.length < 2 || evidence.instanceIds.some((item) => typeof item !== 'string' || !item.trim()) || new Set(evidence.instanceIds).size !== evidence.instanceIds.length) throw new Error('scanner evidence must contain at least two distinct instanceIds');
  const attempted = integer(evidence.attemptedSettlements, 'scanner attemptedSettlements', 1);
  const committed = integer(evidence.committedSettlements, 'scanner committedSettlements');
  const rejected = integer(evidence.rejectedSettlements, 'scanner rejectedSettlements');
  const retryable = integer(evidence.retryableSettlements, 'scanner retryableSettlements');
  if (committed + rejected + retryable !== attempted) throw new Error('scanner settlement outcome counts must equal attemptedSettlements');
  if (integer(evidence.duplicateCommits, 'scanner duplicateCommits') !== 0) throw new Error('scanner evidence contains duplicate commits');
  if (evidence.crossInstanceClaimObserved !== true) throw new Error('scanner evidence must prove a cross-instance claim');
  if (integer(evidence.expiredLeaseRecoveredSettlements, 'scanner expiredLeaseRecoveredSettlements') < 1) throw new Error('scanner evidence must prove expired lease recovery');
  return evidence as ScannerEvidence;
};

export const validateCapacitySlo = (reportValue: unknown, sloValue: unknown, maxAgeMs: number, now = Date.now()): void => {
  const report = record(reportValue, 'capacity report');
  const slo = record(sloValue, 'capacity SLO');
  freshTimestamp(report.generatedAt, 'capacity report generatedAt', maxAgeMs, now);
  const players = integer(report.players, 'capacity report players', 1);
  const rounds = integer(report.rounds, 'capacity report rounds', 1);
  const settlements = integer(report.settlements, 'capacity report settlements', 1);
  const successful = integer(report.successfulSettlements, 'capacity report successfulSettlements');
  const failed = integer(report.failedSettlements, 'capacity report failedSettlements');
  if (successful + failed !== settlements) throw new Error('capacity report success/failure counts must equal settlements');
  if (!Array.isArray(report.errors) || report.errors.length !== failed) throw new Error('capacity report errors length must equal failedSettlements');
  for (const [index, value] of report.errors.entries()) {
    const error = record(value, `capacity report error ${index}`);
    if (typeof error.playerId !== 'string' || !error.playerId.trim()) throw new Error(`capacity report error ${index} playerId must be a non-empty string`);
    integer(error.round, `capacity report error ${index} round`, 1);
    if (typeof error.message !== 'string' || !error.message.trim()) throw new Error(`capacity report error ${index} message must be a non-empty string`);
  }
  const throughput = finite(report.throughputPerSecond, 'capacity report throughputPerSecond');
  const latency = record(report.latencyMs, 'capacity report latencyMs');
  const p50 = finite(latency.p50, 'capacity report p50');
  const p95 = finite(latency.p95, 'capacity report p95');
  const p99 = finite(latency.p99, 'capacity report p99');
  const max = finite(latency.max, 'capacity report max');
  if (!(p50 <= p95 && p95 <= p99 && p99 <= max)) throw new Error('capacity latency percentiles must be monotonic');

  const minimumPlayers = integer(slo.minimumPlayers, 'capacity SLO minimumPlayers', 1);
  const minimumRounds = integer(slo.minimumRounds, 'capacity SLO minimumRounds', 1);
  const minimumSettlements = integer(slo.minimumSettlements, 'capacity SLO minimumSettlements', 1);
  const minimumThroughput = finite(slo.minimumThroughputPerSecond, 'capacity SLO minimumThroughputPerSecond', Number.EPSILON);
  const maximumErrorRate = finite(slo.maximumErrorRate, 'capacity SLO maximumErrorRate');
  if (maximumErrorRate > 1) throw new Error('capacity SLO maximumErrorRate must be between 0 and 1');
  const maximumP50 = finite(slo.maximumP50Ms, 'capacity SLO maximumP50Ms', Number.EPSILON);
  const maximumP95 = finite(slo.maximumP95Ms, 'capacity SLO maximumP95Ms', Number.EPSILON);
  const maximumP99 = finite(slo.maximumP99Ms, 'capacity SLO maximumP99Ms', Number.EPSILON);
  if (!(maximumP50 <= maximumP95 && maximumP95 <= maximumP99)) throw new Error('capacity SLO latency limits must be monotonic');

  const errors = failed / settlements;
  if (players < minimumPlayers) throw new Error(`capacity players ${players} is below SLO floor ${minimumPlayers}`);
  if (rounds < minimumRounds) throw new Error(`capacity rounds ${rounds} is below SLO floor ${minimumRounds}`);
  if (settlements < minimumSettlements) throw new Error(`capacity settlements ${settlements} is below SLO floor ${minimumSettlements}`);
  if (throughput < minimumThroughput) throw new Error(`capacity throughput ${throughput} is below SLO floor ${minimumThroughput}`);
  if (errors > maximumErrorRate) throw new Error(`capacity error rate ${errors} exceeds SLO ${maximumErrorRate}`);
  if (p50 > maximumP50 || p95 > maximumP95 || p99 > maximumP99) throw new Error('capacity latency exceeds one or more SLO limits');
};

export const runProductionAcceptance = async (env: NodeJS.ProcessEnv = process.env, fetchFn: FetchLike = globalThis.fetch, now = Date.now()): Promise<ProductionAcceptanceResult> => {
  const checks: AcceptanceCheck[] = [];
  let config: AcceptanceConfig;
  let verifiedToken: string | undefined;
  try {
    config = readConfig(env);
    checks.push(check('acceptance-inputs', 'pass', 'all required acceptance inputs are present and structurally valid'));
  } catch (error) {
    checks.push(check('acceptance-inputs', 'fail', failMessage(error)));
    for (const name of ['deployment-preflight', 'jwks-endpoint', 'jwt-claims', 'webhook-reachability', 'instance-health-readiness', 'scanner-multi-instance', 'capacity-slo']) checks.push(check(name, 'not_run', 'acceptance inputs are invalid'));
    return { ok: false, checks };
  }

  const preflight = runDeploymentPreflight(env);
  checks.push(preflight.ok
    ? check('deployment-preflight', 'pass', 'static deployment configuration is valid; this is not environment acceptance')
    : check('deployment-preflight', 'fail', `${preflight.issues.length} static deployment issue(s)`));

  try { await validateJwks(config, fetchFn); checks.push(check('jwks-endpoint', 'pass', 'HTTPS JWKS is reachable and exposes bounded unique RSA/RS256 signing keys')); }
  catch (error) { checks.push(check('jwks-endpoint', 'fail', failMessage(error))); }

  try { verifiedToken = await validateJwt(config, fetchFn); checks.push(check('jwt-claims', 'pass', 'sample JWT signature, issuer, audience, subject and expiry verified through JWKS')); }
  catch (error) { checks.push(check('jwt-claims', 'fail', failMessage(error))); }

  try { const detail = await validateWebhookReachability(config, fetchFn); checks.push(check('webhook-reachability', 'pass', detail)); }
  catch (error) { checks.push(check('webhook-reachability', 'fail', failMessage(error))); }

  try { await validateInstances(config, fetchFn, verifiedToken); checks.push(check('instance-health-readiness', 'pass', `${config.instanceUrls.length} distinct instances report health ok, database/config/scanner ready, and accept the verified JWT`)); }
  catch (error) { checks.push(check('instance-health-readiness', 'fail', failMessage(error))); }

  try { validateScannerEvidence(await readJsonFile(config.scannerEvidenceFile, 'scanner evidence file'), config.maxEvidenceAgeMs, now); checks.push(check('scanner-multi-instance', 'pass', 'fresh evidence proves cross-instance claim, zero duplicate commits and expired lease recovery')); }
  catch (error) { checks.push(check('scanner-multi-instance', 'fail', failMessage(error))); }

  try {
    const [report, slo] = await Promise.all([readJsonFile(config.capacityReportFile, 'capacity report file'), readJsonFile(config.capacitySloFile, 'capacity SLO file')]);
    validateCapacitySlo(report, slo, config.maxEvidenceAgeMs, now);
    checks.push(check('capacity-slo', 'pass', 'fresh capacity report satisfies every explicit SLO input'));
  } catch (error) { checks.push(check('capacity-slo', 'fail', failMessage(error))); }

  return { ok: checks.every((item) => item.status === 'pass'), checks };
};

export const formatProductionAcceptance = (result: ProductionAcceptanceResult): string => [
  `production acceptance: ${result.ok ? 'PASS' : 'FAIL'}`,
  ...result.checks.map(({ name, status, detail }) => `- [${status.toUpperCase()}] ${name}: ${detail}`),
].join('\n');

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await runProductionAcceptance();
  process.stdout.write(`${formatProductionAcceptance(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
