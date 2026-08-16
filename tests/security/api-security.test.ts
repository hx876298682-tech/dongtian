import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfigRegistry, parseEnvironment, type ConfigRegistry, type Environment } from '../../packages/config-schema/src/index.js';
import type {
  AssetRepository,
  BuffRepository,
  CharacterProgressionRecord,
  CharacterRepository,
  DatabasePool,
  EquipmentRepository,
  InventorySnapshot,
  JsonValue,
  QueueEntryRecord,
  QueueRecord,
  QueueRepository,
} from '../../packages/database/src/index.js';

import { AuthController } from '../../apps/api/src/auth/auth.controller.js';
import { AuthService } from '../../apps/api/src/auth/auth.service.js';
import { authRepositoryToken, databasePoolToken } from '../../apps/api/src/auth/auth.tokens.js';
import { AssetController } from '../../apps/api/src/asset/asset.controller.js';
import { AssetService } from '../../apps/api/src/asset/asset.service.js';
import { BuffController } from '../../apps/api/src/buff/buff.controller.js';
import { BuffService } from '../../apps/api/src/buff/buff.service.js';
import { buffRepositoryToken } from '../../apps/api/src/buff/buff.tokens.js';
import { configRegistryToken } from '../../apps/api/src/config/config.tokens.js';
import { ContentController } from '../../apps/api/src/content/content.controller.js';
import { ContentService } from '../../apps/api/src/content/content.service.js';
import { characterRepositoryToken } from '../../apps/api/src/character/character.tokens.js';
import { assetRepositoryToken } from '../../apps/api/src/asset/asset.tokens.js';
import { EquipmentController } from '../../apps/api/src/equipment/equipment.controller.js';
import { EquipmentService } from '../../apps/api/src/equipment/equipment.service.js';
import { equipmentRepositoryToken } from '../../apps/api/src/equipment/equipment.tokens.js';
import { environmentToken } from '../../apps/api/src/environment.js';
import { HttpErrorFilter } from '../../apps/api/src/http/error.filter.js';
import { SuccessEnvelopeInterceptor } from '../../apps/api/src/http/envelope.interceptor.js';
import { QueueController } from '../../apps/api/src/queue/queue.controller.js';
import { QueueService } from '../../apps/api/src/queue/queue.service.js';
import { queueRepositoryToken } from '../../apps/api/src/queue/queue.tokens.js';
import { SettlementService } from '../../apps/api/src/settlement/settlement.service.js';
import { NestFactory } from '../../apps/api/node_modules/@nestjs/core/index.js';
import { FastifyAdapter } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import { BadRequestException, ConflictException, Module } from '../../apps/api/node_modules/@nestjs/common/index.js';

const moduleRequire = createRequire(import.meta.url);

const CONFIG_VERSION = '2026.08.16.1';

type CookieJar = Record<string, string>;

type SecurityState = {
  readonly sessionsByTokenHash: Map<string, SessionRecord>;
  readonly characterAccounts: Map<string, string>;
  readonly queueByCharacterId: Map<string, QueueRecord>;
  readonly queueRequestCache: Map<string, { readonly requestHash: string; readonly response: JsonValue }>;
  readonly equipmentPresets: Map<string, EquipmentPresetRecord>;
  readonly inventoryByCharacterId: Map<string, InventorySnapshot>;
  readonly progressionByCharacterId: Map<string, CharacterProgressionRecord>;
  readonly buffLookup: Map<string, BuffLookupRecord>;
  readonly throwOnActionsLoad: { value: boolean };
  readonly queueReplaceCount: { value: number };
  readonly sessionCounter: { value: number };
  readonly accountCounter: { value: number };
};

type SessionRecord = {
  readonly sessionId: string;
  readonly accountId: string;
  readonly accountType: 'ANONYMOUS' | 'REGISTERED';
  readonly accountStatus: 'ACTIVE';
  csrfTokenHash: string;
  readonly expiresAt: Date;
};

type EquipmentPresetRecord = {
  readonly characterId: string;
  readonly presetId: string;
  readonly name: string;
  readonly active: boolean;
  readonly complete: boolean;
  readonly stateVersion: string;
  readonly weaponInstanceId: string | null;
  readonly armorInstanceId: string | null;
  readonly accessoryInstanceId: string | null;
  readonly combatConsumables: readonly { readonly item_id: string; readonly quantity: string }[];
  readonly strategyId: string;
  readonly version: bigint;
};

type BuffLookupRecord = {
  readonly id: string;
  readonly source_item_id: string;
  readonly stack_group: string;
  readonly stack_rule: 'REPLACE' | 'STACK';
  readonly duration_seconds: number;
};

function createEnvironment(): Environment {
  return parseEnvironment({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    WEB_ORIGIN: 'https://web.test',
  });
}

function createConfigRegistry(): ConfigRegistry {
  return loadConfigRegistry({
    releasesRoot: fileURLToPath(new URL('../../config/releases', import.meta.url)),
    version: CONFIG_VERSION,
  });
}

function emptyInventory(): InventorySnapshot {
  return {
    items: [],
    currencies: [],
    equipmentInstances: [],
  };
}

function createCharacterProgression(characterId: string, accountId: string): CharacterProgressionRecord {
  return {
    characterId,
    accountId,
    name: '洞天散修',
    stateVersion: '0',
    activeConfigVersion: CONFIG_VERSION,
    cultivationXp: '0',
    realmStageId: 'realm.mortal.entry',
    skills: [],
  };
}

function cloneQueue(queue: QueueRecord | null): QueueRecord | null {
  return queue === null
    ? null
    : {
        ...queue,
        entries: queue.entries.map((entry) => ({ ...entry })),
      };
}

function createState(): SecurityState {
  const progressionByCharacterId = new Map<string, CharacterProgressionRecord>();
  progressionByCharacterId.set('character-1', createCharacterProgression('character-1', 'account-1'));
  progressionByCharacterId.set('character-2', createCharacterProgression('character-2', 'account-2'));

  const equipmentPresets = new Map<string, EquipmentPresetRecord>();
  equipmentPresets.set('character-1:preset-1', {
    characterId: 'character-1',
    presetId: 'preset-1',
    name: '基础预设',
    active: false,
    complete: true,
    stateVersion: '0',
    weaponInstanceId: null,
    armorInstanceId: null,
    accessoryInstanceId: null,
    combatConsumables: [],
    strategyId: 'strategy.safe',
    version: 1n,
  });

  const buffLookup = new Map<string, BuffLookupRecord>();
  buffLookup.set('item.t1.qi_gathering_pill', {
    id: 'buff.t1.qi_gathering_pill',
    source_item_id: 'item.t1.qi_gathering_pill',
    stack_group: 'buff_group.t1.qi',
    stack_rule: 'REPLACE',
    duration_seconds: 3600,
  });

  return {
    sessionsByTokenHash: new Map(),
    characterAccounts: new Map<string, string>(),
    queueByCharacterId: new Map<string, QueueRecord>([
      [
        'character-1',
        {
          characterId: 'character-1',
          queueVersion: 0n,
          pendingReplaceAfterCycle: false,
          paused: false,
          fallbackActionId: 'action.t1.herb_baicao_valley',
          entries: [],
        },
      ],
    ]),
    queueRequestCache: new Map(),
    equipmentPresets,
    inventoryByCharacterId: new Map<string, InventorySnapshot>([
      ['character-1', emptyInventory()],
      ['character-2', emptyInventory()],
    ]),
    progressionByCharacterId,
    buffLookup,
    throwOnActionsLoad: { value: false },
    queueReplaceCount: { value: 0 },
    sessionCounter: { value: 0 },
    accountCounter: { value: 0 },
  };
}

function parseSetCookieHeader(value: string | readonly string[] | undefined): CookieJar {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const cookies: CookieJar = {};
  for (const entry of entries) {
    const firstPart = entry.split(';', 1)[0];
    const separatorIndex = firstPart.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = firstPart.slice(0, separatorIndex);
    const cookieValue = firstPart.slice(separatorIndex + 1);
    cookies[name] = cookieValue;
  }
  return cookies;
}

function cookieHeader(cookies: CookieJar): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function makeAnonymousRequest(origin = 'https://web.test') {
  return {
    method: 'POST',
    url: '/api/v1/auth/anonymous',
    headers: { origin },
  };
}

function makeSessionHeaders(cookies: CookieJar, csrfToken: string, extra: Record<string, string> = {}) {
  return {
    cookie: cookieHeader(cookies),
    origin: 'https://web.test',
    'x-csrf-token': csrfToken,
    ...extra,
  };
}

function requestHash(value: unknown): string {
  return JSON.stringify(value);
}

function createAuthRepository(state: SecurityState) {
  return {
    async createAnonymousSession(input: {
      readonly sessionTokenHash: string;
      readonly csrfTokenHash: string;
      readonly expiresAt: Date;
    }) {
      state.sessionCounter.value += 1;
      state.accountCounter.value += 1;
      const accountId = `account-${state.accountCounter.value}`;
      const characterId = `character-${state.accountCounter.value}`;
      state.sessionsByTokenHash.set(input.sessionTokenHash, {
        sessionId: `session-${state.sessionCounter.value}`,
        accountId,
        accountType: 'ANONYMOUS',
        accountStatus: 'ACTIVE',
        csrfTokenHash: input.csrfTokenHash,
        expiresAt: input.expiresAt,
      });
      state.characterAccounts.set(characterId, accountId);
      state.progressionByCharacterId.set(characterId, createCharacterProgression(characterId, accountId));
      state.inventoryByCharacterId.set(characterId, emptyInventory());
      return {
        sessionId: `session-${state.sessionCounter.value}`,
        accountId,
        characterId,
        accountType: 'ANONYMOUS' as const,
        accountStatus: 'ACTIVE' as const,
        expiresAt: input.expiresAt,
      };
    },
    async ensureDefaultCharacter(accountId: string) {
      for (const [characterId, ownerAccountId] of state.characterAccounts) {
        if (ownerAccountId === accountId) {
          return { characterId };
        }
      }
      const characterId = `character-${state.characterAccounts.size + 1}`;
      state.characterAccounts.set(characterId, accountId);
      state.progressionByCharacterId.set(characterId, createCharacterProgression(characterId, accountId));
      state.inventoryByCharacterId.set(characterId, emptyInventory());
      return { characterId };
    },
    async findActiveSession(sessionTokenHash: string, now: Date) {
      const session = state.sessionsByTokenHash.get(sessionTokenHash);
      return session && session.expiresAt > now && session.accountStatus === 'ACTIVE' ? { ...session } : null;
    },
    async touchSession() {},
    async rotateCsrfToken(sessionId: string, csrfTokenHash: string, now: Date) {
      for (const session of state.sessionsByTokenHash.values()) {
        if (session.sessionId === sessionId && session.expiresAt > now) {
          session.csrfTokenHash = csrfTokenHash;
          return true;
        }
      }
      return false;
    },
    async revokeSession(sessionTokenHash: string) {
      return state.sessionsByTokenHash.delete(sessionTokenHash);
    },
    async characterBelongsToAccount(characterId: string, accountId: string) {
      return state.characterAccounts.get(characterId) === accountId;
    },
  };
}

function createCharacterRepository(state: SecurityState): CharacterRepository {
  return {
    async getProgression(characterId: string, accountId: string) {
      if (state.throwOnActionsLoad.value) {
        throw new Error('SELECT * FROM accounts WHERE session_token = $1 -- token=secret');
      }
      const record = state.progressionByCharacterId.get(characterId);
      return record && record.accountId === accountId ? record : null;
    },
  } as unknown as CharacterRepository;
}

function createAssetRepository(state: SecurityState): AssetRepository {
  return {
    async getInventory(characterId: string, accountId: string) {
      return state.characterAccounts.get(characterId) === accountId
        ? state.inventoryByCharacterId.get(characterId) ?? null
        : null;
    },
    async getInventoryOnTransaction(_client: unknown, characterId: string, accountId: string) {
      return state.characterAccounts.get(characterId) === accountId
        ? state.inventoryByCharacterId.get(characterId) ?? null
        : null;
    },
    async deductOnTransaction() {
      return { transactionId: 'transaction-1' };
    },
    async reserveOnTransaction() {
      return { transactionId: 'transaction-1', reservationId: 'reservation-1' };
    },
    async findActiveReservationsByBusiness() {
      return [];
    },
    async releaseOnTransaction() {
      return { transactionId: 'transaction-1' };
    },
  } as unknown as AssetRepository;
}

function createQueueRepository(state: SecurityState): QueueRepository {
  return {
    async getQueue(characterId: string) {
      return cloneQueue(state.queueByCharacterId.get(characterId) ?? null);
    },
    async lockQueue(_client: unknown, characterId: string) {
      return cloneQueue(state.queueByCharacterId.get(characterId) ?? null);
    },
    async replaceQueue(_client: unknown, input: {
      readonly characterId: string;
      readonly expectedQueueVersion: bigint;
      readonly fallbackActionId: string;
      readonly entries: readonly {
        readonly clientEntryId: string;
        readonly position: number;
        readonly actionConfigId: string;
        readonly mode: string;
        readonly onBlocked: string;
        readonly configVersion: string;
        readonly targetValue?: string;
        readonly conditionItemId?: string;
        readonly conditionOperator?: string;
      }[];
    }) {
      state.queueReplaceCount.value += 1;
      const entries: QueueEntryRecord[] = input.entries.map((entry, index) => ({
        id: `queue-entry-${state.queueReplaceCount.value}-${index + 1}`,
        characterId: input.characterId,
        clientEntryId: entry.clientEntryId,
        position: entry.position,
        actionConfigId: entry.actionConfigId,
        mode: entry.mode as QueueEntryRecord['mode'],
        targetValue: entry.targetValue ?? null,
        conditionItemId: entry.conditionItemId ?? null,
        conditionOperator: entry.conditionOperator ?? null,
        onBlocked: entry.onBlocked as QueueEntryRecord['onBlocked'],
        status: 'QUEUED',
        completedCycles: 0n,
        progressTimeUs: 0n,
        blockedReason: null,
        snapshotConfigVersion: entry.configVersion,
        snapshot: { client_entry_id: entry.clientEntryId } as JsonValue,
        startedAt: null,
        completedAt: null,
      }));
      const nextQueue: QueueRecord = {
        characterId: input.characterId,
        queueVersion: input.expectedQueueVersion + 1n,
        pendingReplaceAfterCycle: false,
        paused: false,
        fallbackActionId: input.fallbackActionId,
        entries,
      };
      state.queueByCharacterId.set(input.characterId, nextQueue);
      return cloneQueue(nextQueue) as QueueRecord;
    },
    async setPaused(_client: unknown, input: { readonly characterId: string; readonly expectedQueueVersion: bigint; readonly paused: boolean }) {
      const current = state.queueByCharacterId.get(input.characterId);
      if (!current) {
        throw new Error('QUEUE_NOT_FOUND');
      }
      const nextQueue: QueueRecord = {
        ...current,
        queueVersion: input.expectedQueueVersion + 1n,
        paused: input.paused,
      };
      state.queueByCharacterId.set(input.characterId, nextQueue);
      return cloneQueue(nextQueue) as QueueRecord;
    },
  } as unknown as QueueRepository;
}

function createEquipmentRepository(state: SecurityState): EquipmentRepository {
  return {
    async getLoadoutPreset(characterId: string, accountId: string, presetId: string) {
      if (state.characterAccounts.get(characterId) !== accountId) {
        return null;
      }
      return state.equipmentPresets.get(`${characterId}:${presetId}`) ?? null;
    },
    async saveLoadoutPreset() {
      throw new Error('NOT_USED');
    },
    async activateLoadoutPreset() {
      throw new Error('NOT_USED');
    },
  } as unknown as EquipmentRepository;
}

function createBuffRepository(): BuffRepository {
  return {
    async lockActiveBuffs() {
      return [];
    },
  } as unknown as BuffRepository;
}

function createDatabasePool(): DatabasePool {
  return {
    async query<T>(sql: string, params: readonly unknown[]) {
      if (sql.includes('FROM characters c') && sql.includes('active_loadout_preset_id')) {
        const characterId = String(params[0]);
        const accountId = String(params[1]);
        return {
          rows: characterId === 'character-1' && accountId === 'account-1'
            ? [{ state_version: '0', realm_stage_id: 'realm.mortal.entry', active_loadout_preset_id: null }]
            : [],
        } as { rows: T[] };
      }
      return { rows: [] as T[] } as { rows: T[] };
    },
    async connect() {
      throw new Error('NOT_USED');
    },
    async end() {},
  } as unknown as DatabasePool;
}

function createSettlementServiceMock(state: SecurityState) {
  return {
    async executeSettledWrite<T extends JsonValue>(
      request: { readonly headers: Record<string, string | string[] | undefined> },
      characterId: string,
      input: {
        readonly operationType: string;
        readonly request: unknown;
        readonly execute: (context: {
          readonly client: { readonly query: <R>(sql: string, params: readonly unknown[]) => Promise<{ readonly rows: R[] }> };
          readonly settlement: { readonly settlement_id: string; readonly effective_until: string };
          readonly settlementState: { readonly continuationRequired: boolean };
          readonly requestHash: string;
        }) => Promise<{ readonly statusCode: number; readonly response: T }>;
      },
    ) {
      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message_key: 'error.validation_error',
          details: { field: 'Idempotency-Key' },
        });
      }
      const cacheKey = `${characterId}:${input.operationType}:${idempotencyKey}`;
      const hash = requestHash(input.request);
      const cached = state.queueRequestCache.get(cacheKey);
      if (cached) {
        if (cached.requestHash !== hash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message_key: 'error.idempotency_key_reused',
          });
        }
        return { statusCode: 200, response: cached.response as T };
      }

      const result = await input.execute({
        client: {
          async query<R>() {
            return { rows: [] as R[] };
          },
        },
        settlement: {
          settlement_id: 'settlement-1',
          effective_until: '2026-08-16T00:00:00.000Z',
        },
        settlementState: { continuationRequired: false },
        requestHash: hash,
      });
      state.queueRequestCache.set(cacheKey, {
        requestHash: hash,
        response: result.response,
      });
      return result;
    },
  } as unknown as SettlementService;
}

const environment = createEnvironment();
const configRegistry = createConfigRegistry();
const state = createState();

class SecurityTestModule {}

Module({
  controllers: [AuthController, AssetController, BuffController, ContentController, EquipmentController, QueueController],
  providers: [
    { provide: environmentToken, useValue: environment },
    { provide: configRegistryToken, useValue: configRegistry },
    { provide: authRepositoryToken, useFactory: () => createAuthRepository(state) },
    { provide: characterRepositoryToken, useFactory: () => createCharacterRepository(state) },
    { provide: assetRepositoryToken, useFactory: () => createAssetRepository(state) },
    { provide: queueRepositoryToken, useFactory: () => createQueueRepository(state) },
    { provide: equipmentRepositoryToken, useFactory: () => createEquipmentRepository(state) },
    { provide: buffRepositoryToken, useFactory: () => createBuffRepository() },
    { provide: databasePoolToken, useFactory: () => createDatabasePool() },
    { provide: SettlementService, useFactory: () => createSettlementServiceMock(state) },
    AuthService,
    AssetService,
    BuffService,
    ContentService,
    EquipmentService,
    QueueService,
  ],
})(SecurityTestModule);

async function createSecurityApp(): Promise<any> {
  const app = await NestFactory.create(SecurityTestModule, new FastifyAdapter(), { logger: false });
  const fastify: any = app.getHttpAdapter().getInstance();
  const cookie = moduleRequire('../../apps/api/node_modules/@fastify/cookie/index.js');
  const helmet = moduleRequire('../../apps/api/node_modules/@fastify/helmet/index.js');
  await fastify.register(cookie);
  await fastify.register(helmet);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalInterceptors(new SuccessEnvelopeInterceptor(environment));
  await app.init();
  return app;
}

function responseError(response: { readonly json: () => unknown }) {
  return response.json() as { readonly error?: Record<string, unknown> };
}

describe('security regression subset', () => {
  let app: any;

  beforeAll(async () => {
    app = await createSecurityApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    state.sessionsByTokenHash.clear();
    state.characterAccounts.clear();
    state.queueByCharacterId.set('character-1', {
      characterId: 'character-1',
      queueVersion: 0n,
      pendingReplaceAfterCycle: false,
      paused: false,
      fallbackActionId: 'action.t1.herb_baicao_valley',
      entries: [],
    });
    state.queueRequestCache.clear();
    state.queueReplaceCount.value = 0;
    state.throwOnActionsLoad.value = false;
    state.sessionCounter.value = 0;
    state.accountCounter.value = 0;
    state.progressionByCharacterId.set('character-1', createCharacterProgression('character-1', 'account-1'));
    state.progressionByCharacterId.set('character-2', createCharacterProgression('character-2', 'account-2'));
    state.characterAccounts.set('character-1', 'account-1');
    state.characterAccounts.set('character-2', 'account-2');
    state.inventoryByCharacterId.set('character-1', emptyInventory());
    state.inventoryByCharacterId.set('character-2', emptyInventory());
  });

  async function createAnonymousSession() {
    const response = await app.getHttpAdapter().getInstance().inject(makeAnonymousRequest());
    expect(response.statusCode).toBe(201);
    const envelope = response.json() as {
      readonly data: {
        readonly account_id: string;
        readonly character_id: string;
        readonly csrf_token: string;
      };
    };
    const cookies = parseSetCookieHeader(response.headers['set-cookie']);
    return { body: envelope.data, cookies };
  }

  it('rejects logout when Origin or CSRF is missing or wrong', async () => {
    const session = await createAnonymousSession();

    const missingCsrf = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: cookieHeader(session.cookies),
        origin: 'https://web.test',
      },
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(responseError(missingCsrf)).toMatchObject({
      error: {
        code: 'CSRF_VALIDATION_FAILED',
        message_key: 'error.csrf_validation_failed',
      },
    });

    const wrongOrigin = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: makeSessionHeaders(session.cookies, session.body.csrf_token, {
        origin: 'https://attacker.test',
      }),
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(responseError(wrongOrigin)).toMatchObject({
      error: {
        code: 'CSRF_VALIDATION_FAILED',
        message_key: 'error.csrf_validation_failed',
      },
    });
  });

  it('rejects unauthorized and cross-account reads without revealing ownership', async () => {
    const unauthorized = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/v1/characters/character-1/inventory',
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(responseError(unauthorized)).toMatchObject({
      error: {
        code: 'UNAUTHENTICATED',
        message_key: 'error.unauthenticated',
      },
    });

    const session = await createAnonymousSession();
    const otherCharacter = state.progressionByCharacterId.get('character-2');
    expect(otherCharacter).toBeDefined();

    const forbidden = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/v1/characters/character-2/inventory',
      headers: {
        cookie: cookieHeader(session.cookies),
      },
    });
    expect(forbidden.statusCode).toBe(404);
    expect(responseError(forbidden)).toMatchObject({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message_key: 'error.resource_not_found',
      },
    });
  });

  it('treats missing and mismatched loadout IDs as not found', async () => {
    const session = await createAnonymousSession();

    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/v1/characters/character-2/loadouts/preset-1',
      headers: {
        cookie: cookieHeader(session.cookies),
      },
    });

    expect(response.statusCode).toBe(404);
    expect(responseError(response)).toMatchObject({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message_key: 'error.resource_not_found',
      },
    });
  });

  it('rejects queue previews with negative and oversized target values', async () => {
    const session = await createAnonymousSession();
    const headers = {
      cookie: cookieHeader(session.cookies),
    };
    const baseBody = {
      expected_queue_version: 0,
      entries: [
        {
          client_entry_id: 'tmp-1',
          action_id: 'action.t1.herb_baicao_valley',
          mode: 'COUNT',
          target_value: 1,
          on_blocked: 'FALLBACK',
        },
      ],
      fallback: {
        action_id: 'action.t1.herb_baicao_valley',
        mode: 'INFINITE',
      },
    } as const;

    const negative = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: `/api/v1/characters/${session.body.character_id}/queue/preview`,
      headers,
      payload: {
        ...baseBody,
        entries: [
          {
            ...baseBody.entries[0],
            target_value: -1,
          },
        ],
      },
    });
    expect(negative.statusCode).toBe(400);
    expect(responseError(negative)).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message_key: 'error.validation_error',
      },
    });

    const oversized = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: `/api/v1/characters/${session.body.character_id}/queue/preview`,
      headers,
      payload: {
        ...baseBody,
        entries: [
          {
            ...baseBody.entries[0],
            target_value: '1e309',
          },
        ],
      },
    });
    expect(oversized.statusCode).toBe(400);
    expect(responseError(oversized)).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message_key: 'error.validation_error',
      },
    });
  });

  it('accepts extra fields but does not allow prototype pollution', async () => {
    const session = await createAnonymousSession();
    const payload = JSON.stringify({
      expected_queue_version: 0,
      entries: [
        {
          client_entry_id: 'tmp-1',
          action_id: 'action.t1.herb_baicao_valley',
          mode: 'COUNT',
          target_value: 1,
          on_blocked: 'FALLBACK',
        },
      ],
      fallback: {
        action_id: 'action.t1.herb_baicao_valley',
        mode: 'INFINITE',
      },
      extra_field: 'ignored',
      __proto__: {
        polluted: 'yes',
      },
    });

    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: `/api/v1/characters/${session.body.character_id}/queue/preview`,
      headers: {
        cookie: cookieHeader(session.cookies),
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(response.json()).toMatchObject({
      data: {
        entries: [
          expect.objectContaining({
            client_entry_id: 'tmp-1',
            action_id: 'action.t1.herb_baicao_valley',
          }),
        ],
      },
    });
  });

  it('requires Idempotency-Key and rejects reuse with a different body', async () => {
    const session = await createAnonymousSession();
    const headers = makeSessionHeaders(session.cookies, session.body.csrf_token);
    const body = {
      expected_queue_version: 0,
      entries: [
        {
          client_entry_id: 'tmp-1',
          action_id: 'action.t1.herb_baicao_valley',
          mode: 'COUNT',
          target_value: 1,
          on_blocked: 'FALLBACK',
        },
      ],
      fallback: {
        action_id: 'action.t1.herb_baicao_valley',
        mode: 'INFINITE',
      },
    };

    const missingKey = await app.getHttpAdapter().getInstance().inject({
      method: 'PUT',
      url: `/api/v1/characters/${session.body.character_id}/queue`,
      headers,
      payload: body,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(responseError(missingKey)).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message_key: 'error.validation_error',
        details: { field: 'Idempotency-Key' },
      },
    });

    const idempotencyKey = '0198f6d7-3f09-7c11-8e2d-000000000001';
    const first = await app.getHttpAdapter().getInstance().inject({
      method: 'PUT',
      url: `/api/v1/characters/${session.body.character_id}/queue`,
      headers: {
        ...headers,
        'idempotency-key': idempotencyKey,
      },
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      data: {
        queue_version: 1,
      },
    });
    expect(state.queueReplaceCount.value).toBe(1);

    const sameBodyReplay = await app.getHttpAdapter().getInstance().inject({
      method: 'PUT',
      url: `/api/v1/characters/${session.body.character_id}/queue`,
      headers: {
        ...headers,
        'idempotency-key': idempotencyKey,
      },
      payload: body,
    });
    expect(sameBodyReplay.statusCode).toBe(200);
    expect(sameBodyReplay.json()).toMatchObject({
      data: {
        queue_version: 1,
      },
    });
    expect(state.queueReplaceCount.value).toBe(1);

    const differentBodyConflict = await app.getHttpAdapter().getInstance().inject({
      method: 'PUT',
      url: `/api/v1/characters/${session.body.character_id}/queue`,
      headers: {
        ...headers,
        'idempotency-key': idempotencyKey,
      },
      payload: {
        ...body,
        entries: [
          {
            ...body.entries[0],
            target_value: 2,
          },
        ],
      },
    });
    expect(differentBodyConflict.statusCode).toBe(409);
    expect(responseError(differentBodyConflict)).toMatchObject({
      error: {
        code: 'IDEMPOTENCY_KEY_REUSED',
        message_key: 'error.idempotency_key_reused',
      },
    });
  });

  it('rejects buff slot indexes outside the supported range', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/api/v1/characters/character-1/buffs/use',
      payload: {
        item_id: 'item.t1.qi_gathering_pill',
        quantity: 1,
        target_slot_index: 0,
        expected_state_version: 0,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(responseError(response)).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message_key: 'error.validation_error',
      },
    });
  });

  it('does not leak internal stack traces or SQL text on unexpected errors', async () => {
    const session = await createAnonymousSession();
    const original = state.throwOnActionsLoad.value;
    state.throwOnActionsLoad.value = true;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: 'GET',
        url: '/api/v1/actions',
        headers: {
          cookie: cookieHeader(session.cookies),
        },
      });

      const raw = response.body;
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: {
          code: 'INTERNAL_ERROR',
          message_key: 'error.internal_error',
          retryable: true,
        },
      });
      expect(raw).not.toContain('SELECT * FROM accounts');
      expect(raw).not.toContain('token=secret');
      expect(raw).not.toContain('stack');
    } finally {
      state.throwOnActionsLoad.value = original;
      consoleErrorSpy.mockRestore();
    }
  });

  it('returns 404 for market routes that are intentionally not registered', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/v1/market/quotes?item_ids=item.t1.qi_gathering_pill',
    });

    expect(response.statusCode).toBe(404);
  });
});
