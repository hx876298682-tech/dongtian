import { randomUUID } from 'node:crypto';

import { createDatabasePool, createAssetRepository } from '@dongtian/database';

import { loadPerfEnvironment, type PerfEnvironment } from './perf-env.js';
import type { PerfAuditReport, PerfRunReport, PerfScenarioResult, PerfSample } from './perf-types.js';
import { selectPerformanceScenarios, summarizeScenario, isScenarioEnabled, type PerfHttpClient, type PerfScenarioContext, type PreparedPerfClient } from './perf-scenarios.js';
import { summarizeSamples } from './perf-stats.js';

class HttpPerfClient implements PerfHttpClient {
  public readonly cookies = new Map<string, string>();

  public constructor(
    private readonly baseUrl: string,
    private readonly webOrigin: string,
    private readonly lockTimeoutCodes: readonly string[],
  ) {}

  public async request(input: {
    readonly label: string;
    readonly method: 'GET' | 'POST' | 'PUT';
    readonly path: string;
    readonly body?: unknown;
    readonly requiresCsrf?: boolean;
  }): Promise<{
    readonly status: number;
    readonly durationMs: number;
    readonly errorCode: string | null;
    readonly retryable: boolean;
    readonly lockTimeout: boolean;
    readonly json: unknown;
  }> {
    const headers = new Headers();
    headers.set('accept', 'application/json');
    if (input.body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    const cookieHeader = this.cookieHeader();
    if (cookieHeader.length > 0) {
      headers.set('cookie', cookieHeader);
    }
    if (input.requiresCsrf === true) {
      const csrf = this.cookies.get('dt_csrf');
      if (csrf !== undefined) {
        headers.set('x-csrf-token', csrf);
      }
      headers.set('origin', this.webOrigin);
    }

    const startedAt = performance.now();
    const response = await fetch(new URL(input.path, this.baseUrl), {
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      headers,
      method: input.method,
    });
    const durationMs = Math.max(0, performance.now() - startedAt);
    this.mergeCookies(response.headers);
    const json = await this.parseJson(response);
    const error = json !== null && typeof json === 'object' && 'error' in json
      ? (json as { readonly error?: { readonly code?: unknown; readonly retryable?: unknown } }).error
      : null;
    const errorCode = typeof error?.code === 'string' ? error.code : null;
    const retryable = typeof error?.retryable === 'boolean' ? error.retryable : response.status >= 500;
    return {
      durationMs,
      errorCode,
      json,
      lockTimeout: errorCode !== null && this.lockTimeoutCodes.includes(errorCode),
      retryable,
      status: response.status,
    };
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private mergeCookies(headers: Headers): void {
    const setCookieHeader = (headers as Headers & { readonly getSetCookie?: () => readonly string[] }).getSetCookie?.() ?? [];
    const rawHeader = headers.get('set-cookie');
    const cookieHeaders = setCookieHeader.length > 0 ? setCookieHeader : rawHeader === null ? [] : [rawHeader];
    for (const header of cookieHeaders) {
      for (const cookie of header.split(/,(?=[^ ;]+=)/g)) {
        const [pair] = cookie.split(';', 1);
        const separatorIndex = pair.indexOf('=');
        if (separatorIndex <= 0) {
          continue;
        }
        const name = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();
        if (name.length > 0) {
          this.cookies.set(name, value);
        }
      }
    }
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.length === 0) {
      return null;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  }
}

async function prepareClients(env: PerfEnvironment, count: number): Promise<readonly PreparedPerfClient[]> {
  const pool = createDatabasePool(env.databaseUrl);
  const clientFactory = () => new HttpPerfClient(env.baseUrl, env.webOrigin, env.lockTimeoutCodes);
  const created: PreparedPerfClient[] = [];

  try {
    const bootstrapped = await Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const client = clientFactory();
        const auth = await client.request({
          label: 'auth.anonymous',
          method: 'POST',
          path: '/api/v1/auth/anonymous',
        });
        if (auth.status >= 400) {
          throw new Error(`Failed to bootstrap perf session ${index}: HTTP ${auth.status}`);
        }
        const session = await client.request({
          label: 'auth.session',
          method: 'GET',
          path: '/api/v1/auth/session',
        });
        const payload = session.json as { readonly data?: { readonly character_id?: string } };
        const characterId = payload.data?.character_id;
        if (typeof characterId !== 'string' || characterId.length === 0) {
          throw new Error(`Failed to resolve character_id for perf session ${index}.`);
        }
        return { characterId, client };
      }),
    );

    await Promise.all(
      bootstrapped.map(async (entry, index) => {
        const presetId = randomUUID();
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO loadout_presets
              (id, character_id, name, weapon_instance_id, armor_instance_id, accessory_instance_id, combat_consumables, strategy_id, version)
             VALUES ($1, $2, $3, NULL, NULL, NULL, '[]'::jsonb, $4, 0)
             ON CONFLICT (id) DO UPDATE
               SET character_id = EXCLUDED.character_id,
                   name = EXCLUDED.name,
                   strategy_id = EXCLUDED.strategy_id,
                   version = EXCLUDED.version,
                   updated_at = CURRENT_TIMESTAMP`,
            [presetId, entry.characterId, `perf-loadout-${index + 1}`, 'strategy.safe'],
          );
          await client.query(
            `UPDATE characters
                SET realm_stage_id = $2,
                    active_loadout_preset_id = $3,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1`,
            [entry.characterId, 'realm.qi.early', presetId],
          );
          await client.query(
            `UPDATE character_progression
                SET realm_stage_id = $2,
                    updated_at = CURRENT_TIMESTAMP
              WHERE character_id = $1`,
            [entry.characterId, 'realm.qi.early'],
          );
          await client.query(
            `INSERT INTO inventories (character_id, item_id, quantity, reserved_quantity)
             VALUES ($1, $2, $3, 0)
             ON CONFLICT (character_id, item_id) DO UPDATE
               SET quantity = inventories.quantity + EXCLUDED.quantity,
                   updated_at = CURRENT_TIMESTAMP`,
            [entry.characterId, 'item.t1.qi_gathering_pill', 12],
          );
          await client.query(
            `UPDATE settlement_states
                SET last_settled_at = CURRENT_TIMESTAMP - INTERVAL '10 hours',
                    updated_at = CURRENT_TIMESTAMP
              WHERE character_id = $1`,
            [entry.characterId],
          );
          await client.query('COMMIT');
          created.push({
            characterId: entry.characterId,
            client: entry.client,
            presetId,
          });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }),
    );

    return created;
  } finally {
    await pool.end();
  }
}

function buildFallbackClient(env: PerfEnvironment): PerfHttpClient {
  return new HttpPerfClient(env.baseUrl, env.webOrigin, env.lockTimeoutCodes);
}

export async function runPerfHarness(): Promise<PerfRunReport> {
  const envState = loadPerfEnvironment();
  if (!envState.configured) {
    const reason = `Missing required env: ${envState.missing.join(', ')}`;
    if (envState.allowSkip) {
      return {
        audit: null,
        reason,
        scenarioResults: [],
        status: 'skipped',
        summary: summarizeSamples([]),
      };
    }

    throw new Error(reason);
  }

  const env = envState.env;
  const scenarios = selectPerformanceScenarios(env.scenarioFilter).filter((scenario) => isScenarioEnabled(scenario, env));
  const scenarioResults: PerfScenarioResult[] = [];
  const aggregatedSamples: PerfSample[] = [];
  const pool = createDatabasePool(env.databaseUrl);

  const context: PerfScenarioContext = {
    env,
    requestIdPrefix: 'perf',
    createClient: () => buildFallbackClient(env),
    createPreparedClients: async (count: number) => prepareClients(env, count),
  };

  try {
    for (const scenario of scenarios) {
      const samples = await scenario.run(context);
      const result = summarizeScenario(scenario.id, samples, 'passed', null);
      scenarioResults.push(result);
      aggregatedSamples.push(...samples);
    }

    const auditResult = await createAssetRepository(pool).audit();
    const audit: PerfAuditReport = {
      discrepancyCount: auditResult.discrepancyCount,
      ok: auditResult.ok,
    };

    return {
      audit,
      reason: audit.ok ? null : `Ledger audit found ${audit.discrepancyCount} discrepancies.`,
      scenarioResults,
      status: audit.ok ? 'passed' : 'failed',
      summary: summarizeSamples(aggregatedSamples),
    };
  } finally {
    await pool.end();
  }
}

export function renderPerfReport(report: PerfRunReport): string {
  const lines = [
    `PERF ${report.status.toUpperCase()}${report.reason ? `: ${report.reason}` : ''}`,
    `samples=${report.summary.sampleCount} p50=${formatMetric(report.summary.p50Ms)}ms p95=${formatMetric(report.summary.p95Ms)}ms p99=${formatMetric(report.summary.p99Ms)}ms errorRate=${(report.summary.errorRate * 100).toFixed(2)}% lockTimeoutRate=${(report.summary.lockTimeoutRate * 100).toFixed(2)}%`,
  ];

  for (const scenario of report.scenarioResults) {
    lines.push(
      `${scenario.scenarioId} ${scenario.status} samples=${scenario.summary.sampleCount} p95=${formatMetric(scenario.summary.p95Ms)}ms errorRate=${(scenario.summary.errorRate * 100).toFixed(2)}%${scenario.reason ? ` reason=${scenario.reason}` : ''}`,
    );
  }

  if (report.audit !== null) {
    lines.push(`audit ok=${report.audit.ok} discrepancyCount=${report.audit.discrepancyCount}`);
  }

  return `${lines.join('\n')}\n`;
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}
