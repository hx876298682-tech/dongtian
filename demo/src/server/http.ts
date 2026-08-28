import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ApiError } from './types.ts';
import { createAuthProvider } from './auth.ts';
import type { AuthIdentity } from './auth.ts';
import type { AuthProvider } from './auth.ts';
import type { CollectionPoolId, DungeonId, HighTierRealm } from './types.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GameService } from './service.ts';
import { evaluateReadiness } from './health.ts';
import type { HealthChecks } from './health.ts';

const json = (response: ServerResponse, status: number, payload: unknown): void => { response.statusCode = status; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(payload)); };
export const DEFAULT_HTTP_MAX_BODY_BYTES = 1_048_576;
export const MAX_HTTP_MAX_BODY_BYTES = 10 * 1_048_576;

export const readHttpMaxBodyBytes = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env.DONGTIAN_HTTP_MAX_BODY_BYTES;
  if (raw === undefined) return DEFAULT_HTTP_MAX_BODY_BYTES;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`DONGTIAN_HTTP_MAX_BODY_BYTES must be an integer between 1 and ${MAX_HTTP_MAX_BODY_BYTES}`);
  const value = Number(raw);
  if (value < 1 || value > MAX_HTTP_MAX_BODY_BYTES) throw new Error(`DONGTIAN_HTTP_MAX_BODY_BYTES must be an integer between 1 and ${MAX_HTTP_MAX_BODY_BYTES}`);
  return value;
};

const contentLength = (request: IncomingMessage): number | undefined => {
  const raw = request.headers['content-length'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) throw new ApiError('VALIDATION_FAILED', 'content-length must be a non-negative integer');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ApiError('VALIDATION_FAILED', 'content-length must be a safe integer');
  return value;
};

const body = async (request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> => {
  const declaredBytes = contentLength(request);
  if (declaredBytes !== undefined && declaredBytes > maxBytes) {
    request.resume();
    throw new ApiError('REQUEST_BODY_TOO_LARGE', `request body exceeds the ${maxBytes}-byte limit`, { maxBytes });
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      request.resume();
      throw new ApiError('REQUEST_BODY_TOO_LARGE', `request body exceeds the ${maxBytes}-byte limit`, { maxBytes });
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('VALIDATION_FAILED', 'request body must be an object');
  return value as Record<string, unknown>;
};
const authenticatedIdentity = async (request: IncomingMessage, authProvider: AuthProvider): Promise<AuthIdentity> => {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (!match) throw new ApiError('AUTH_REQUIRED', 'Authorization must use the Bearer scheme');
    return await authProvider.authenticate(match[1]);
  }
  if (process.env.DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER === '1') {
    const developmentPlayerId = request.headers['x-player-id'];
    if (typeof developmentPlayerId === 'string' && developmentPlayerId.trim()) return { subject: developmentPlayerId.trim(), roles: [] };
  }
  throw new ApiError('AUTH_REQUIRED', 'Authorization: Bearer <token> is required');
};
const invalid = (field: string, message = `${field} is invalid`): never => { throw new ApiError('VALIDATION_FAILED', message); };
const onlyFields = (payload: Record<string, unknown>, allowed: readonly string[]): void => {
  const unexpected = Object.keys(payload).filter((field) => !allowed.includes(field));
  if (unexpected.length > 0) invalid(unexpected[0]!, `unsupported field: ${unexpected[0]}`);
};
const requiredString = (payload: Record<string, unknown>, field: string): string => {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim().length === 0) invalid(field, `${field} is required and must be a non-empty string`);
  return value as string;
};
const optionalString = (payload: Record<string, unknown>, field: string): string | undefined => {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) invalid(field, `${field} must be a non-empty string when provided`);
  return value as string;
};
const requiredInteger = (payload: Record<string, unknown>, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  const value = payload[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(field, `${field} must be an integer between ${minimum} and ${maximum}`);
  return value as number;
};
const optionalInteger = (payload: Record<string, unknown>, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | undefined => {
  if (payload[field] === undefined) return undefined;
  return requiredInteger(payload, field, minimum, maximum);
};
const queryInteger = (searchParams: URLSearchParams, field: string, fallback: number, minimum: number, maximum: number): number => {
  const value = searchParams.get(field);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) invalid(field, `${field} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) invalid(field, `${field} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
};
const enumString = <T extends string>(payload: Record<string, unknown>, field: string, allowed: readonly T[]): T => {
  const value = requiredString(payload, field);
  if (!allowed.includes(value as T)) invalid(field, `${field} is not a supported value`);
  return value as T;
};
const revision = (request: IncomingMessage, payload: Record<string, unknown>): number => {
  const header = request.headers['x-expected-revision'];
  if (header !== undefined) {
    const raw = typeof header === 'string' ? header.trim() : invalid('expectedRevision', 'x-expected-revision must be a non-negative integer');
    if (!/^\d+$/.test(raw)) invalid('expectedRevision', 'x-expected-revision must be a non-negative integer');
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) invalid('expectedRevision', 'x-expected-revision must be a safe integer');
    if (payload.expectedRevision !== undefined && requiredInteger(payload, 'expectedRevision') !== value) invalid('expectedRevision', 'body and x-expected-revision must match');
    return value;
  }
  return requiredInteger(payload, 'expectedRevision');
};
const pathSegment = (value: string, field: string): string => {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.length === 0) invalid(field, `${field} must be a non-empty path segment`);
    return decoded;
  } catch {
    return invalid(field, `${field} contains malformed URI encoding`);
  }
};
const idempotencyKey = (request: IncomingMessage): string | undefined => {
  const value = request.headers['idempotency-key'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return invalid('idempotency-key', 'idempotency-key must be a single non-empty string');
  const trimmed = value.trim();
  const containsControlCharacter = [...trimmed].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (trimmed.length === 0 || trimmed.length > 512 || containsControlCharacter) invalid('idempotency-key', 'idempotency-key must contain 1 to 512 non-control characters');
  return trimmed;
};
const requiredIdempotencyKey = (request: IncomingMessage): string => {
  const key = idempotencyKey(request);
  if (!key) invalid('idempotency-key', 'idempotency-key header is required for state-changing requests');
  return key as string;
};
const buildingIds = ['alchemy_room', 'forge_room', 'spirit_farm', 'technique_pavilion', 'treasure_pavilion'] as const;
const recipeIds = ['alchemy_basic', 'forge_basic'] as const;
const equipmentActions = ['equip', 'unequip', 'reinforce', 'promote', 'reroll', 'lock', 'awaken', 'salvage', 'sell'] as const;
const dungeonIds = ['qing_feng', 'yan_prison', 'sky_abyss'] as const;
const highTierRealms = ['nascent_soul', 'divine_transformation', 'void_refining', 'body_unity', 'great_vehicle', 'tribulation'] as const satisfies readonly HighTierRealm[];
const actionIds = ['training', 'bai_cao_valley', 'black_wind_valley', 'red_flame_cave', 'alchemy', 'forge', 'alchemy_basic', 'forge_basic', 'technique_research', 'treasure_research', 'technique_training', 'herbalism', 'mining', ...highTierRealms.map((realm) => `high_tier_expedition:${realm}`)] as const;
const collectionActions = ['research', 'treasure_upgrade'] as const;
const collectionPools = ['starter', ...highTierRealms] as const satisfies readonly CollectionPoolId[];
const leaderboardTypes = ['realm', 'cultivation_xp', 'combat_power', 'technique', 'herbalism', 'mining', 'alchemy', 'forge'] as const;

export const createGameHttpServer = (service: GameService, options: { authProvider?: AuthProvider; healthChecks?: HealthChecks; healthCheckTimeoutMs?: number; maxBodyBytes?: number } = {}) => {
  const authProvider = options.authProvider ?? createAuthProvider(process.env);
  const maxBodyBytes = options.maxBodyBytes ?? readHttpMaxBodyBytes();
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > MAX_HTTP_MAX_BODY_BYTES) throw new Error(`maxBodyBytes must be an integer between 1 and ${MAX_HTTP_MAX_BODY_BYTES}`);
  return createServer(async (request, response) => {
  const requestId = String(request.headers['x-request-id'] ?? randomUUID());
  let id = '';
  let roles: string[] = [];
  let responseService = service;
  try {
    // Health endpoints are intentionally unauthenticated and handled before
    // body parsing or config routing. Their payload contains no secrets,
    // release versions, URLs, or provider error details.
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'GET' && pathname === '/healthz') {
      response.setHeader('cache-control', 'no-store');
      return json(response, 200, { status: 'ok' });
    }
    if (request.method === 'GET' && pathname === '/readyz') {
      const report = await evaluateReadiness(options.healthChecks ?? {}, options.healthCheckTimeoutMs);
      response.setHeader('cache-control', 'no-store');
      return json(response, report.status === 'ok' ? 200 : 503, report);
    }
    const payload = await body(request, maxBodyBytes);
    const identity = await authenticatedIdentity(request, authProvider);
    id = identity.subject;
    roles = identity.roles;
    const configHeader = request.headers['x-config-version'];
    const context = { requestId, configVersion: configHeader ? String(configHeader) : undefined, now: new Date() };
    if (request.method === 'GET' && pathname === '/metrics') {
      if (process.env.DONGTIAN_METRICS_REQUIRE_ADMIN === '1' && !roles.includes('admin')) throw new ApiError('FORBIDDEN', 'admin role is required for metrics');
      response.statusCode = 200;
      response.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
      response.end(await service.metricsPrometheusAsync());
      return;
    }
    if (request.method === 'POST' && pathname === '/v1/admin/config/refresh') {
      if (!roles.includes('admin')) throw new ApiError('FORBIDDEN', 'admin role is required');
      onlyFields(payload, []);
      const configVersion = await service.reloadConfig();
      return json(response, 200, { requestId, configVersion, serverTime: new Date().toISOString(), data: { configVersion } });
    }
    const adminConfigOperation = pathname.match(/^\/v1\/admin\/config\/(canary|activate|rollback)$/);
    if (request.method === 'POST' && adminConfigOperation) {
      if (!roles.includes('admin')) throw new ApiError('FORBIDDEN', 'admin role is required');
      const operation = adminConfigOperation[1] as 'canary' | 'activate' | 'rollback';
      onlyFields(payload, ['version', 'reason', 'canaryPercent']);
      const result = await service.configReleaseOperation({ ...context, operation, version: requiredString(payload, 'version'), reason: requiredString(payload, 'reason'), canaryPercent: optionalInteger(payload, 'canaryPercent', 1, 100), operatorSubject: id, idempotencyKey: requiredIdempotencyKey(request) });
      return json(response, 200, result);
    }
    // Bind every player request to one immutable release snapshot. The
    // provider computes the stable canary bucket from playerId and shared PG
    // state; x-config-version is reserved for an explicit historical replay
    // or a caller that already received a request envelope.
    const routedService = await service.forPlayer(id, context.configVersion);
    responseService = routedService;
    if (request.method === 'GET' && pathname === '/v1/bootstrap') return json(response, 200, await routedService.bootstrap(id, context));
    if (request.method === 'GET' && pathname === '/v1/action-catalog') return json(response, 200, await routedService.actionCatalog(id, context));
    if (request.method === 'GET' && pathname === '/v1/random-events/current') return json(response, 200, await routedService.randomEventsCurrent(id, context));
    if (request.method === 'POST' && pathname === '/v1/economy/long-term') {
      onlyFields(payload, ['horizonHours', 'seed']);
      const horizonValue = requiredInteger(payload, 'horizonHours', 720, 2160);
      if (horizonValue !== 720 && horizonValue !== 2160) invalid('horizonHours', 'horizonHours must be 720 or 2160');
      const horizonHours = horizonValue as 720 | 2160;
      return json(response, 200, await routedService.longTermEconomy({ ...context, playerId: id, horizonHours, seed: requiredInteger(payload, 'seed', 0, 0xffffffff) }));
    }
    if (request.method === 'POST' && pathname === '/v1/economy/long-term/equipment-consumption') {
      onlyFields(payload, ['horizonHours', 'seed']);
      const horizonValue = requiredInteger(payload, 'horizonHours', 720, 2160);
      if (horizonValue !== 720 && horizonValue !== 2160) invalid('horizonHours', 'horizonHours must be 720 or 2160');
      return json(response, 200, await routedService.longTermEquipmentConsumption({ ...context, playerId: id, horizonHours: horizonValue as 720 | 2160, seed: requiredInteger(payload, 'seed', 0, 0xffffffff) }));
    }
    if (request.method === 'POST' && pathname === '/v1/economy/long-term/confidence') {
      onlyFields(payload, ['horizonHours', 'seed', 'sampleCount']);
      const horizonValue = requiredInteger(payload, 'horizonHours', 720, 2160);
      if (horizonValue !== 720 && horizonValue !== 2160) invalid('horizonHours', 'horizonHours must be 720 or 2160');
      return json(response, 200, await routedService.longTermEconomyConfidence({ ...context, playerId: id, horizonHours: horizonValue as 720 | 2160, seed: requiredInteger(payload, 'seed', 0, 0xffffffff), sampleCount: requiredInteger(payload, 'sampleCount', 10, 500) }));
    }
    const leaderboardMatch = pathname.match(/^\/v1\/leaderboards\/([^/]+)$/);
    if (request.method === 'GET' && leaderboardMatch) {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const type = pathSegment(leaderboardMatch[1], 'type');
      if (!leaderboardTypes.includes(type as (typeof leaderboardTypes)[number])) invalid('type', 'type is not a supported leaderboard');
      const limit = queryInteger(url.searchParams, 'limit', 20, 1, 100);
      const offset = queryInteger(url.searchParams, 'offset', 0, 0, 100000);
      return json(response, 200, await routedService.leaderboard({ ...context, playerId: id, type: type as (typeof leaderboardTypes)[number], limit, offset }));
    }
    const replayMatch = pathname.match(/^\/v1\/replays\/([^/]+)$/);
    if (request.method === 'GET' && replayMatch) return json(response, 200, await routedService.replaySettlement(id, pathSegment(replayMatch[1], 'settlementId'), context));
    if (request.method === 'GET' && pathname === '/v1/journal') {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const limit = queryInteger(url.searchParams, 'limit', 30, 1, 100);
      const beforeRevision = queryInteger(url.searchParams, 'beforeRevision', Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
      return json(response, 200, await routedService.journal({ ...context, playerId: id, limit, beforeRevision }));
    }
    if (request.method === 'GET' && pathname === '/v1/collection/events') {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const limit = queryInteger(url.searchParams, 'limit', 50, 1, 100);
      const before = url.searchParams.get('before') ?? undefined;
      return json(response, 200, await routedService.collectionEvents({ ...context, playerId: id, limit, before }));
    }
    if (request.method === 'POST' && pathname === '/v1/actions/start') {
      onlyFields(payload, ['actionId', 'recipeId', 'equipmentTemplateId', 'techniqueId', 'mapId', 'expectedRevision']);
      return json(response, 200, await routedService.startAction({ ...context, playerId: id, actionId: enumString(payload, 'actionId', actionIds), recipeId: optionalString(payload, 'recipeId'), equipmentTemplateId: optionalString(payload, 'equipmentTemplateId'), techniqueId: optionalString(payload, 'techniqueId'), mapId: optionalString(payload, 'mapId'), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/actions/stop') {
      onlyFields(payload, ['settlementId', 'requestedStartedAt', 'requestedEndedAt', 'expectedRevision']);
      return json(response, 200, await routedService.stopAction({ ...context, playerId: id, settlementId: requiredString(payload, 'settlementId'), requestedStartedAt: requiredString(payload, 'requestedStartedAt'), requestedEndedAt: requiredString(payload, 'requestedEndedAt'), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/actions/switch') {
      onlyFields(payload, ['actionId', 'recipeId', 'equipmentTemplateId', 'techniqueId', 'mapId', 'settlementId', 'requestedStartedAt', 'requestedEndedAt', 'expectedRevision']);
      return json(response, 200, await routedService.switchAction({ ...context, playerId: id, actionId: enumString(payload, 'actionId', actionIds), recipeId: optionalString(payload, 'recipeId'), equipmentTemplateId: optionalString(payload, 'equipmentTemplateId'), techniqueId: optionalString(payload, 'techniqueId'), mapId: optionalString(payload, 'mapId'), settlementId: requiredString(payload, 'settlementId'), requestedStartedAt: requiredString(payload, 'requestedStartedAt'), requestedEndedAt: requiredString(payload, 'requestedEndedAt'), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/settlements/offline') {
      onlyFields(payload, ['settlementId', 'requestedStartedAt', 'requestedEndedAt', 'expectedRevision']);
      // Settlement IDs provide durable replay identity, but the public write
      // contract still requires an explicit idempotency key on every mutation.
      requiredIdempotencyKey(request);
      return json(response, 200, await routedService.offlineSettlement({ ...context, playerId: id, settlementId: requiredString(payload, 'settlementId'), requestedStartedAt: requiredString(payload, 'requestedStartedAt'), requestedEndedAt: requiredString(payload, 'requestedEndedAt'), expectedRevision: revision(request, payload) }));
    }
    const spiritFarmPlotMatch = pathname.match(/^\/v1\/buildings\/spirit_farm\/plots\/([^/]+)\/plant$/);
    if (request.method === 'POST' && spiritFarmPlotMatch) {
      onlyFields(payload, ['plantId', 'expectedRevision']);
      return json(response, 200, await routedService.plantSpiritFarmPlot({ ...context, playerId: id, plotId: pathSegment(spiritFarmPlotMatch[1], 'plotId'), plantId: requiredString(payload, 'plantId'), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/buildings/spirit_farm/plant') {
      onlyFields(payload, ['plots', 'expectedRevision']);
      return json(response, 200, await routedService.plantSpiritFarm({ ...context, playerId: id, plots: requiredInteger(payload, 'plots', 1, 4), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    const buildingMatch = pathname.match(/^\/v1\/buildings\/([^/]+)\/jobs$/);
    if (request.method === 'POST' && buildingMatch) {
      onlyFields(payload, ['recipeId', 'quantity', 'expectedRevision']);
      return json(response, 200, await routedService.queueBuildingJob({ ...context, playerId: id, buildingId: enumString({ buildingId: pathSegment(buildingMatch[1], 'buildingId') }, 'buildingId', buildingIds), recipeId: enumString(payload, 'recipeId', recipeIds), quantity: requiredInteger(payload, 'quantity', 1, 10000), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    const buildingUpgradeMatch = pathname.match(/^\/v1\/buildings\/([^/]+)\/upgrade$/);
    if (request.method === 'POST' && buildingUpgradeMatch) {
      onlyFields(payload, ['expectedRevision']);
      return json(response, 200, await routedService.upgradeBuilding({ ...context, playerId: id, buildingId: enumString({ buildingId: pathSegment(buildingUpgradeMatch[1], 'buildingId') }, 'buildingId', buildingIds), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    const equipmentMatch = pathname.match(/^\/v1\/equipment\/([^/]+)\/actions$/);
    if (request.method === 'POST' && equipmentMatch) {
      onlyFields(payload, ['action', 'expectedRevision', 'lockSlots', 'slotIndex', 'target', 'targetAffix']);
      const lockSlots = payload.lockSlots === undefined ? undefined : Array.isArray(payload.lockSlots) ? payload.lockSlots.map((value, index) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(`lockSlots[${index}]`, 'lockSlots must contain non-negative integers'); return value; }) : invalid('lockSlots', 'lockSlots must be an array');
      const slotIndex = optionalInteger(payload, 'slotIndex');
      const target = payload.target === undefined ? undefined : typeof payload.target === 'boolean' ? payload.target : invalid('target', 'target must be a boolean');
      return json(response, 200, await routedService.equipmentAction({ ...context, playerId: id, instanceId: pathSegment(equipmentMatch[1], 'instanceId'), action: enumString(payload, 'action', equipmentActions), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request), lockSlots, slotIndex, target, targetAffix: optionalString(payload, 'targetAffix') }));
    }
    const dungeonPreviewMatch = pathname.match(/^\/v1\/dungeons\/([^/]+)\/preview$/);
    if (request.method === 'GET' && dungeonPreviewMatch) return json(response, 200, await routedService.previewDungeon(id, pathSegment(dungeonPreviewMatch[1], 'dungeonId') as DungeonId, context));
    if (request.method === 'POST' && pathname === '/v1/dungeons/start') {
      onlyFields(payload, ['dungeonId', 'expectedRevision']);
      return json(response, 200, await routedService.startDungeon({ ...context, playerId: id, dungeonId: enumString(payload, 'dungeonId', dungeonIds), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/dungeons/settle') {
      onlyFields(payload, ['attemptId', 'expectedRevision']);
      if (Object.prototype.hasOwnProperty.call(payload, 'outcome')) invalid('outcome', 'outcome is server-controlled and must not be provided');
      requiredIdempotencyKey(request);
      return json(response, 200, await routedService.settleDungeon({ ...context, playerId: id, attemptId: requiredString(payload, 'attemptId'), expectedRevision: revision(request, payload) }));
    }
    const highTierPreviewMatch = pathname.match(/^\/v1\/high-tier\/([^/]+)\/preview$/);
    if (request.method === 'GET' && highTierPreviewMatch) return json(response, 200, await routedService.previewHighTier(id, enumString({ realm: pathSegment(highTierPreviewMatch[1], 'realm') }, 'realm', highTierRealms), context));
    if (request.method === 'POST' && pathname === '/v1/high-tier/start') {
      onlyFields(payload, ['realm', 'expectedRevision']);
      return json(response, 200, await routedService.startHighTier({ ...context, playerId: id, realm: enumString(payload, 'realm', highTierRealms), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/high-tier/settle') {
      onlyFields(payload, ['attemptId', 'expectedRevision']);
      if (Object.prototype.hasOwnProperty.call(payload, 'outcome')) invalid('outcome', 'outcome is server-controlled and must not be provided');
      requiredIdempotencyKey(request);
      return json(response, 200, await routedService.settleHighTier({ ...context, playerId: id, attemptId: requiredString(payload, 'attemptId'), expectedRevision: revision(request, payload) }));
    }
    if (request.method === 'POST' && pathname === '/v1/combat/preview') {
      onlyFields(payload, ['activityId', 'expectedRevision']);
      return json(response, 200, await routedService.combatPreview({ ...context, playerId: id, activityId: requiredString(payload, 'activityId'), expectedRevision: revision(request, payload) }));
    }
    if (request.method === 'POST' && pathname === '/v1/combat/start') {
      onlyFields(payload, ['activityId', 'expectedRevision']);
      const activityId = requiredString(payload, 'activityId');
      const expectedRevision = revision(request, payload);
      if (dungeonIds.includes(activityId as DungeonId)) {
        return json(response, 200, await routedService.startDungeon({ ...context, playerId: id, dungeonId: activityId as DungeonId, expectedRevision, idempotencyKey: requiredIdempotencyKey(request) }));
      }
      if (highTierRealms.includes(activityId as HighTierRealm)) {
        return json(response, 200, await routedService.startHighTier({ ...context, playerId: id, realm: activityId as HighTierRealm, expectedRevision, idempotencyKey: requiredIdempotencyKey(request) }));
      }
      throw new ApiError('CONTENT_LOCKED', `combat activity is not available: ${activityId}`);
    }
    if (request.method === 'POST' && pathname === '/v1/collection/actions') {
      onlyFields(payload, ['action', 'techniqueId', 'quality', 'treasureId', 'expectedRevision']);
      const action = enumString(payload, 'action', collectionActions);
      const techniqueId = optionalString(payload, 'techniqueId');
      const quality = optionalString(payload, 'quality');
      const treasureId = optionalString(payload, 'treasureId');
      if (action === 'research' && (!techniqueId || !quality)) invalid('techniqueId', 'research requires techniqueId and quality');
      if (action === 'treasure_upgrade' && !treasureId) invalid('treasureId', 'treasure_upgrade requires treasureId');
      if (action === 'research' && treasureId !== undefined) invalid('treasureId', 'research does not accept treasureId');
      if (action === 'treasure_upgrade' && (techniqueId !== undefined || quality !== undefined)) invalid('techniqueId', 'treasure_upgrade does not accept techniqueId or quality');
      return json(response, 200, await routedService.collectionAction({ ...context, playerId: id, action, techniqueId, quality, treasureId, expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/collection/exchanges') {
      onlyFields(payload, ['poolId', 'targetTreasureId', 'expectedRevision']);
      return json(response, 200, await routedService.collectionExchange({ ...context, playerId: id, poolId: enumString(payload, 'poolId', collectionPools), targetTreasureId: requiredString(payload, 'targetTreasureId'), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/equipment/auto-promotion/policy') {
      onlyFields(payload, ['enabled', 'targetInstanceIds', 'resourceReserve', 'maxOperationsPerCycle', 'expectedRevision']);
      const enabled = typeof payload.enabled === 'boolean' ? payload.enabled : invalid('enabled', 'enabled must be boolean');
      const targetInstanceIds = Array.isArray(payload.targetInstanceIds) ? payload.targetInstanceIds.map((value, index) => typeof value === 'string' ? value : invalid(`targetInstanceIds[${index}]`, 'target instance id must be a string')) : invalid('targetInstanceIds', 'targetInstanceIds must be an array');
      const reserve = payload.resourceReserve === undefined ? undefined : payload.resourceReserve && typeof payload.resourceReserve === 'object' && !Array.isArray(payload.resourceReserve) ? payload.resourceReserve as { spirit_stone?: unknown; millennium_herb?: unknown; meteor_iron?: unknown } : invalid('resourceReserve', 'resourceReserve must be an object');
      const resourceReserve = reserve ? { spirit_stone: reserve.spirit_stone === undefined ? undefined : requiredInteger(reserve as Record<string, unknown>, 'spirit_stone'), millennium_herb: reserve.millennium_herb === undefined ? undefined : requiredInteger(reserve as Record<string, unknown>, 'millennium_herb'), meteor_iron: reserve.meteor_iron === undefined ? undefined : requiredInteger(reserve as Record<string, unknown>, 'meteor_iron') } : undefined;
      return json(response, 200, await routedService.setAutoPromotionPolicy({ ...context, playerId: id, enabled, targetInstanceIds, resourceReserve, maxOperationsPerCycle: optionalInteger(payload, 'maxOperationsPerCycle', 1, 100), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/equipment/auto-promotion/cycles') {
      onlyFields(payload, ['cycleId', 'expectedRevision']);
      return json(response, 200, await routedService.autoPromotionCycle({ ...context, playerId: id, cycleId: payload.cycleId === undefined ? undefined : requiredString(payload, 'cycleId'), expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    if (request.method === 'POST' && pathname === '/v1/progression/breakthrough') {
      onlyFields(payload, ['expectedRevision']);
      return json(response, 200, await routedService.breakthrough({ ...context, playerId: id, expectedRevision: revision(request, payload), idempotencyKey: requiredIdempotencyKey(request) }));
    }
    return json(response, 404, { requestId, configVersion: routedService.currentConfigVersion(), stateRevision: await routedService.currentRevision(id) ?? 0, serverTime: new Date().toISOString(), error: { code: 'VALIDATION_FAILED', message: 'route not found' } });
  } catch (error) {
    const common = { requestId, configVersion: responseService.currentConfigVersion(), stateRevision: id ? await responseService.currentRevision(id) ?? 0 : 0, serverTime: new Date().toISOString() };
    if (error instanceof SyntaxError) return json(response, 400, { ...common, error: { code: 'VALIDATION_FAILED', message: 'invalid JSON' } });
    if (error instanceof ApiError) return json(response, error.code === 'STALE_REVISION' ? 409 : error.code === 'TRANSACTION_RETRYABLE' ? 503 : error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : error.code === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, { ...common, error: { code: error.code, message: error.message, details: error.details } });
    return json(response, 500, { ...common, error: { code: 'INTERNAL_ROLLBACK', message: 'internal error' } });
  }
  });
};
