import type { PerfEnvironment } from './perf-env.js';
import type { PerfRequestMethod, PerfSample, PerfScenarioResult, PerfRunStatus } from './perf-types.js';
import { summarizeSamples } from './perf-stats.js';

export type PerfRequestSpec = {
  readonly label: string;
  readonly method: PerfRequestMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly requiresCsrf?: boolean;
};

export type PerfHttpResult = {
  readonly status: number;
  readonly durationMs: number;
  readonly errorCode: string | null;
  readonly retryable: boolean;
  readonly lockTimeout: boolean;
};

export type PerfHttpClient = {
  readonly cookies: Map<string, string>;
  request(spec: PerfRequestSpec): Promise<PerfHttpResult & { readonly json: unknown }>;
};

export type PerfScenarioContext = {
  readonly env: PerfEnvironment;
  readonly requestIdPrefix: string;
  readonly createClient: () => PerfHttpClient;
  readonly createPreparedClients: (count: number) => Promise<readonly PreparedPerfClient[]>;
};

export type PreparedPerfClient = {
  readonly characterId: string;
  readonly presetId: string | null;
  readonly client: PerfHttpClient;
};

export type PerfScenarioDefinition = {
  readonly id: string;
  readonly description: string;
  readonly run: (context: PerfScenarioContext) => Promise<readonly PerfSample[]>;
  readonly requiresOutageHooks?: boolean;
};

const loginAndSettle10hScenario: PerfScenarioDefinition = {
  id: 'login-settle-10h',
  description: '200 并发会话同时登录并触发 10 小时结算。',
  run: async (context) => {
    const prepared = await context.createPreparedClients(200);
    const samples: PerfSample[] = [];

    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      if (!item) {
        continue;
      }

      const session = item.client;
      const auth = await session.request({
        label: 'auth.session',
        method: 'GET',
        path: '/api/v1/auth/session',
      });
      samples.push(toSample('login-settle-10h', `auth-session-${index}`, auth, 'GET', '/api/v1/auth/session'));

      const queue = await session.request({
        body: {
          expected_queue_version: 0,
          entries: [
            {
              client_entry_id: `perf-${index}-cultivation`,
              action_id: 'action.cultivation.qi',
              mode: 'INFINITE',
              on_blocked: 'FALLBACK',
            },
          ],
          fallback: {
            action_id: 'action.cultivation.qi',
            mode: 'INFINITE',
          },
        },
        label: 'queue.save',
        method: 'PUT',
        path: `/api/v1/characters/${item.characterId}/queue`,
        requiresCsrf: true,
      });
      samples.push(toSample('login-settle-10h', `queue-save-${index}`, queue, 'PUT', `/api/v1/characters/${item.characterId}/queue`));
    }

    return samples;
  },
};

const mixedWriteScenario: PerfScenarioDefinition = {
  id: 'mixed-authority-writes',
  description: '50 写请求 / 秒，混合队列、药品、装备与秘境操作。',
  run: async (context) => {
    const prepared = await context.createPreparedClients(50);
    if (prepared.length === 0) {
      return [];
    }
    if (prepared.some((entry) => entry.presetId === null)) {
      return [];
    }
    const samples: PerfSample[] = [];

    for (let index = 0; index < prepared.length; index += 1) {
      const preparedClient = prepared[index];
      if (!preparedClient) {
        continue;
      }
      const presetId = preparedClient.presetId;
      if (presetId === null) {
        continue;
      }
      const spec = buildMixedWriteSpec(preparedClient.characterId, presetId, index);
      const result = await preparedClient.client.request(spec);
      samples.push(toSample('mixed-authority-writes', `write-${index}`, result, spec.method, spec.path));
    }

    return samples;
  },
};

function buildMixedWriteSpec(characterId: string, presetId: string, index: number): PerfRequestSpec {
  switch (index % 5) {
    case 0:
      return {
        body: {
          expected_queue_version: 0,
          entries: [
            {
              client_entry_id: 'mixed-queue-1',
              action_id: 'action.t1.herb_baicao_valley',
              mode: 'COUNT',
              target_value: 1,
              on_blocked: 'FALLBACK',
            },
          ],
          fallback: {
            action_id: 'action.cultivation.qi',
            mode: 'INFINITE',
          },
        },
        label: 'queue.preview',
        method: 'POST',
        path: `/api/v1/characters/${characterId}/queue/preview`,
      };
    case 1:
      return {
        body: {
          expected_state_version: 0,
          item_id: 'item.t1.qi_gathering_pill',
          quantity: 1,
          target_slot_index: 1,
        },
        label: 'buff.use',
        method: 'POST',
        path: `/api/v1/characters/${characterId}/buffs/use`,
        requiresCsrf: true,
      };
    case 2:
      return {
        label: 'equipment.equip',
        method: 'POST',
        path: `/api/v1/characters/${characterId}/loadouts/${presetId}/equip`,
        requiresCsrf: true,
      };
    case 3:
      return {
        label: 'dungeon.grant',
        method: 'POST',
        path: `/api/v1/characters/${characterId}/dungeon-opportunities/teaching-grant`,
        requiresCsrf: true,
      };
    default:
      return {
        body: {
          config_version: '2026.08.16.1',
          dungeon_id: 'dungeon.t1.qingshe_cave',
          expected_state_version: 0,
          initial_route_id: 'route.t1.qingshe_cave.safe_exit',
          loadout_preset_id: presetId,
          strategy_preset_id: 'strategy.safe',
        },
        label: 'dungeon.enter',
        method: 'POST',
        path: `/api/v1/characters/${characterId}/dungeon-runs`,
        requiresCsrf: true,
      };
  }
}

const maxSegmentScenario: PerfScenarioDefinition = {
  id: 'max-legal-segment',
  description: '单角色最大合法分段请求。',
  run: async (context) => {
    const [prepared] = await context.createPreparedClients(1);
    if (!prepared) {
      return [];
    }

    const result = await prepared.client.request({
      label: 'queue.save',
      method: 'PUT',
      path: `/api/v1/characters/${prepared.characterId}/queue`,
      body: {
        expected_queue_version: 0,
        entries: [
          {
            client_entry_id: 'max-segment',
            action_id: 'action.cultivation.qi',
            mode: 'COUNT',
            target_value: '600',
            on_blocked: 'FALLBACK',
          },
        ],
        fallback: {
          action_id: 'action.cultivation.qi',
          mode: 'INFINITE',
        },
      },
      requiresCsrf: true,
    });

    return [toSample('max-legal-segment', 'queue-max-segment', result, 'PUT', `/api/v1/characters/${prepared.characterId}/queue`)];
  },
};

const workerRestartScenario: PerfScenarioDefinition = {
  id: 'worker-restart',
  description: 'Worker 重启期间持续写入。',
  requiresOutageHooks: true,
  run: async (context) => {
    if (context.env.workerRestartCommand === null) {
      return [];
    }

    const [prepared] = await context.createPreparedClients(1);
    if (!prepared) {
      return [];
    }

    const result = await prepared.client.request({
      label: 'queue.save',
      method: 'PUT',
      path: `/api/v1/characters/${prepared.characterId}/queue`,
      body: {
        expected_queue_version: 0,
        entries: [
          {
            client_entry_id: 'worker-restart',
            action_id: 'action.cultivation.qi',
            mode: 'INFINITE',
            on_blocked: 'FALLBACK',
          },
        ],
        fallback: {
          action_id: 'action.cultivation.qi',
          mode: 'INFINITE',
        },
      },
      requiresCsrf: true,
    });

    return [toSample('worker-restart', 'worker-restart-write', result, 'PUT', `/api/v1/characters/${prepared.characterId}/queue`)];
  },
};

const databaseOutageScenario: PerfScenarioDefinition = {
  id: 'database-short-outage',
  description: '数据库短断期间持续请求。',
  requiresOutageHooks: true,
  run: async (context) => {
    if (context.env.databaseOutageCommand === null) {
      return [];
    }

    const [prepared] = await context.createPreparedClients(1);
    if (!prepared) {
      return [];
    }

    const result = await prepared.client.request({
      label: 'settlements.latest',
      method: 'GET',
      path: `/api/v1/characters/${prepared.characterId}/settlements/latest`,
    });

    return [toSample('database-short-outage', 'database-outage-read', result, 'GET', `/api/v1/characters/${prepared.characterId}/settlements/latest`)];
  },
};

export const performanceScenarios: readonly PerfScenarioDefinition[] = [
  loginAndSettle10hScenario,
  mixedWriteScenario,
  maxSegmentScenario,
  workerRestartScenario,
  databaseOutageScenario,
];

export function selectPerformanceScenarios(filter: readonly string[] | null): readonly PerfScenarioDefinition[] {
  if (filter === null) {
    return performanceScenarios;
  }

  const selected = performanceScenarios.filter((scenario) => filter.includes(scenario.id));
  return selected.length === 0 ? performanceScenarios : selected;
}

export function isScenarioEnabled(scenario: PerfScenarioDefinition, env: PerfEnvironment): boolean {
  if (!scenario.requiresOutageHooks) {
    return true;
  }
  return env.workerRestartCommand !== null || env.databaseOutageCommand !== null;
}

export function summarizeScenario(
  scenarioId: string,
  samples: readonly PerfSample[],
  status: PerfRunStatus,
  reason: string | null,
): PerfScenarioResult {
  return {
    scenarioId,
    status,
    reason,
    samples,
    summary: summarizeSamples(samples),
  };
}

function toSample(
  scenarioId: string,
  requestId: string,
  result: PerfHttpResult,
  method: PerfRequestMethod,
  path: string,
): PerfSample {
  return {
    scenarioId,
    requestId,
    label: requestId,
    method,
    path,
    status: result.status,
    durationMs: result.durationMs,
    errorCode: result.errorCode,
    retryable: result.retryable,
    lockTimeout: result.lockTimeout,
  };
}
