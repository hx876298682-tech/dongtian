import Decimal from 'decimal.js';

import {
  simulateCombatEncounter,
  type CombatSimulationInput,
  type CombatSimulationResult,
  type CombatantInput,
} from './combat.js';
import { decimal } from './decimal.js';
import { deriveScopedSeed, seedFromHex, Xoshiro128StarStar } from './random.js';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type DungeonRouteRisk = 'SAFE' | 'HIGH_RISK';
export type DungeonRunPhase = 'ENTERED' | 'REWARD_CANDIDATE' | 'FINALIZED';
export type DungeonOutcome = 'PENDING' | 'SUCCESS' | 'FAILURE' | 'DOUBLE_KO';

export type DungeonEntryItem = {
  readonly itemId: string;
  readonly quantity: string;
};

export type DungeonRewardEntry = {
  readonly itemId: string;
  readonly minQuantity: string;
  readonly maxQuantity?: string;
  readonly probability: string;
  readonly rolls: number;
};

export type DungeonRewardTable = {
  readonly id: string;
  readonly cultivationXp: string;
  readonly entries: readonly DungeonRewardEntry[];
};

export type DungeonChoiceConfig = {
  readonly id: string;
  readonly routeId: string;
  readonly risk: DungeonRouteRisk;
  readonly labelKey: string;
  readonly battleEnemy: CombatantInput;
  readonly successRewardTableId: string;
  readonly failureRewardTableId: string;
  readonly maxEvents?: number;
  readonly maxRounds?: number;
};

export type DungeonNodeConfig = {
  readonly id: string;
  readonly type: 'PREPARE' | 'ENTRY' | 'CHOICE' | 'BATTLE' | 'REWARD';
  readonly nextNodeId: string | null;
};

export type DungeonSuccessModel = {
  readonly baseSuccessRate: string;
  readonly recommendedPower: string;
  readonly powerElasticity: string;
  readonly minSuccessRate: string;
  readonly maxSuccessRate: string;
};

export type DungeonConfig = {
  readonly id: string;
  readonly realmRequired: string;
  readonly opportunityCost: number;
  readonly entryItems: readonly DungeonEntryItem[];
  readonly choiceTimeoutSeconds: number;
  readonly defaultSafeChoiceId: string;
  readonly prepareNodeId: string;
  readonly entryNodeId: string;
  readonly choiceNodeId: string;
  readonly battleNodeId: string;
  readonly rewardNodeId: string;
  readonly nodes: readonly DungeonNodeConfig[];
  readonly choices: readonly DungeonChoiceConfig[];
  readonly rewardTables: readonly DungeonRewardTable[];
  readonly failureRewardTableId: string;
  readonly successModel: DungeonSuccessModel;
  readonly scope: 'MVP' | 'MVP_ENDGAME' | 'ANCHOR';
};

export type DungeonPreviewResult = {
  readonly dungeonId: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly recommendedPower: string;
  readonly baseSuccessRate: string;
  readonly estimatedSuccessRate: string;
  readonly choiceTimeoutSeconds: number;
  readonly opportunityCost: number;
  readonly entryItems: readonly DungeonEntryItem[];
  readonly choices: readonly {
    readonly choiceId: string;
    readonly routeId: string;
    readonly risk: DungeonRouteRisk;
    readonly labelKey: string;
  }[];
  readonly coreRewards: readonly string[];
};

export type DungeonCombatResultSnapshot = Omit<CombatSimulationResult, 'elapsedUs'> & {
  readonly elapsedUs: string;
};

export type DungeonRewardItemIntent = {
  readonly assetId: string;
  readonly quantity: string;
  readonly tableId: string;
  readonly sourceRollIndex: number;
};

export type DungeonRewardCandidate = {
  readonly outcome: DungeonOutcome;
  readonly routeId: string;
  readonly choiceId: string;
  readonly routeRisk: DungeonRouteRisk;
  readonly combat: DungeonCombatResultSnapshot;
  readonly cultivationXp: string;
  readonly items: readonly DungeonRewardItemIntent[];
  readonly rewardTableId: string;
};

export type DungeonFinalization = {
  readonly finalizedAtUs: string;
  readonly reward: DungeonRewardCandidate;
};

export type DungeonRunEvent = {
  readonly eventIndex: number;
  readonly eventType: 'ENTERED' | 'CHOICE_PRESENTED' | 'CHOICE_SELECTED' | 'CHOICE_TIMEOUT' | 'COMBAT_RESOLVED' | 'REWARD_CANDIDATE' | 'FINALIZED';
  readonly nodeId: string;
  readonly payload: JsonValue;
};

export type DungeonRunState = {
  readonly runId: string;
  readonly characterId: string;
  readonly dungeonId: string;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly seedHex: string;
  readonly phase: DungeonRunPhase;
  readonly outcome: DungeonOutcome;
  readonly revision: number;
  readonly currentNodeId: string;
  readonly choiceDeadlineAtUs: string;
  readonly selectedChoiceId: string | null;
  readonly selectedRouteId: string | null;
  readonly selectedRouteRisk: DungeonRouteRisk | null;
  readonly selectedAtUs: string | null;
  readonly combatResolvedAtUs: string | null;
  readonly finalizedAtUs: string | null;
  readonly loadoutSnapshot: JsonValue;
  readonly buffSnapshot: JsonValue;
  readonly strategySnapshot: JsonValue;
  readonly playerCombatSnapshot: CombatantInput;
  readonly config: DungeonConfig;
  readonly combatResult: DungeonCombatResultSnapshot | null;
  readonly rewardCandidate: DungeonRewardCandidate | null;
  readonly finalization: DungeonFinalization | null;
  readonly events: readonly DungeonRunEvent[];
};

export type DungeonPreparationInput = {
  readonly dungeon: DungeonConfig;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly playerPower: string;
};

export type DungeonRunCreationInput = {
  readonly runId: string;
  readonly characterId: string;
  readonly dungeon: DungeonConfig;
  readonly configVersion: string;
  readonly formulaVersion: number;
  readonly seedHex: string;
  readonly startedAtUs: string;
  readonly loadoutSnapshot: JsonValue;
  readonly buffSnapshot: JsonValue;
  readonly strategySnapshot: JsonValue;
  readonly playerCombatSnapshot: CombatantInput;
};

export type DungeonChoiceInput = {
  readonly run: DungeonRunState;
  readonly choiceId: string;
  readonly expectedRunVersion: number;
  readonly chosenAtUs: string;
};

export type DungeonTimeoutInput = {
  readonly run: DungeonRunState;
  readonly chosenAtUs: string;
};

export type DungeonFinalizeInput = {
  readonly run: DungeonRunState;
  readonly finalizedAtUs: string;
};

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`DUNGEON_${field}_INVALID`);
  }
}

function assertDecimalString(value: string, field: string): Decimal {
  const parsed = decimal(value).value;
  if (parsed.isNaN() || !parsed.isFinite()) {
    throw new Error(`DUNGEON_${field}_INVALID`);
  }
  if (parsed.isNegative()) {
    throw new Error(`DUNGEON_${field}_NEGATIVE`);
  }
  return parsed;
}

function formatDecimal(value: Decimal): string {
  return decimal(value).toString();
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function deriveSeedHex(seedHex: string, namespace: string, index: string, version: string): string {
  const seed = seedFromHex(seedHex);
  return bytesToHex(deriveScopedSeed(seed, namespace, index, version));
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nodeMap(config: DungeonConfig): ReadonlyMap<string, DungeonNodeConfig> {
  const result = new Map<string, DungeonNodeConfig>();
  for (const node of config.nodes) {
    if (result.has(node.id)) {
      throw new Error(`DUNGEON_DUPLICATE_NODE:${node.id}`);
    }
    result.set(node.id, node);
  }
  return result;
}

function choiceMap(config: DungeonConfig): ReadonlyMap<string, DungeonChoiceConfig> {
  const result = new Map<string, DungeonChoiceConfig>();
  for (const choice of config.choices) {
    if (result.has(choice.id)) {
      throw new Error(`DUNGEON_DUPLICATE_CHOICE:${choice.id}`);
    }
    result.set(choice.id, choice);
  }
  return result;
}

function rewardTableMap(config: DungeonConfig): ReadonlyMap<string, DungeonRewardTable> {
  const result = new Map<string, DungeonRewardTable>();
  for (const table of config.rewardTables) {
    if (result.has(table.id)) {
      throw new Error(`DUNGEON_DUPLICATE_REWARD_TABLE:${table.id}`);
    }
    result.set(table.id, table);
  }
  return result;
}

function validateDungeonConfig(config: DungeonConfig): void {
  if (config.id.trim().length === 0) {
    throw new Error('DUNGEON_ID_REQUIRED');
  }
  if (config.realmRequired.trim().length === 0) {
    throw new Error('DUNGEON_REALM_REQUIRED');
  }
  assertPositiveInteger(config.opportunityCost, 'OPPORTUNITY_COST');
  assertPositiveInteger(config.choiceTimeoutSeconds, 'CHOICE_TIMEOUT_SECONDS');
  if (config.entryNodeId.trim().length === 0 || config.choiceNodeId.trim().length === 0 || config.battleNodeId.trim().length === 0 || config.rewardNodeId.trim().length === 0) {
    throw new Error('DUNGEON_NODE_REQUIRED');
  }
  if (config.defaultSafeChoiceId.trim().length === 0) {
    throw new Error('DUNGEON_DEFAULT_SAFE_CHOICE_REQUIRED');
  }
  assertDecimalString(config.successModel.baseSuccessRate, 'BASE_SUCCESS_RATE');
  assertDecimalString(config.successModel.recommendedPower, 'RECOMMENDED_POWER');
  assertDecimalString(config.successModel.powerElasticity, 'POWER_ELASTICITY');
  const minRate = assertDecimalString(config.successModel.minSuccessRate, 'MIN_SUCCESS_RATE');
  const maxRate = assertDecimalString(config.successModel.maxSuccessRate, 'MAX_SUCCESS_RATE');
  if (minRate.lt(0) || maxRate.gt(1) || minRate.gt(maxRate)) {
    throw new Error('DUNGEON_SUCCESS_RATE_RANGE_INVALID');
  }

  const nodes = nodeMap(config);
  const choices = choiceMap(config);
  const tables = rewardTableMap(config);

  for (const requiredNodeId of [config.prepareNodeId, config.entryNodeId, config.choiceNodeId, config.battleNodeId, config.rewardNodeId]) {
    if (!nodes.has(requiredNodeId)) {
      throw new Error(`DUNGEON_NODE_MISSING:${requiredNodeId}`);
    }
  }
  for (const choice of config.choices) {
    if (!tables.has(choice.successRewardTableId)) {
      throw new Error(`DUNGEON_REWARD_TABLE_MISSING:${choice.successRewardTableId}`);
    }
    if (!tables.has(choice.failureRewardTableId)) {
      throw new Error(`DUNGEON_REWARD_TABLE_MISSING:${choice.failureRewardTableId}`);
    }
    if (!choices.has(choice.id)) {
      throw new Error(`DUNGEON_CHOICE_MISSING:${choice.id}`);
    }
  }
  if (!choices.has(config.defaultSafeChoiceId)) {
    throw new Error(`DUNGEON_DEFAULT_SAFE_CHOICE_MISSING:${config.defaultSafeChoiceId}`);
  }
}

function estimateSuccessRate(config: DungeonConfig, playerPower: string): string {
  const power = assertDecimalString(playerPower, 'PLAYER_POWER');
  const recommended = assertDecimalString(config.successModel.recommendedPower, 'RECOMMENDED_POWER');
  const elasticity = assertDecimalString(config.successModel.powerElasticity, 'POWER_ELASTICITY');
  const base = assertDecimalString(config.successModel.baseSuccessRate, 'BASE_SUCCESS_RATE');
  const minRate = assertDecimalString(config.successModel.minSuccessRate, 'MIN_SUCCESS_RATE');
  const maxRate = assertDecimalString(config.successModel.maxSuccessRate, 'MAX_SUCCESS_RATE');
  const ratio = recommended.isZero() ? new Decimal(0) : power.div(recommended);
  const raw = ratio.isZero() ? minRate : base.times(ratio.pow(elasticity));
  return formatDecimal(Decimal.max(minRate, Decimal.min(maxRate, raw)));
}

function normalizeCombatResult(result: CombatSimulationResult): DungeonCombatResultSnapshot {
  return {
    ...result,
    elapsedUs: result.elapsedUs.toString(),
  };
}

function buildRewardCandidate(
  run: DungeonRunState,
  choice: DungeonChoiceConfig,
  combatResult: DungeonCombatResultSnapshot,
  rewardTable: DungeonRewardTable,
  outcome: DungeonOutcome,
): DungeonRewardCandidate {
  const tableSeed = deriveSeedHex(run.seedHex, 'dungeon.reward.table', `${choice.routeId}:${choice.id}:${rewardTable.id}`, String(run.formulaVersion));
  const random = new Xoshiro128StarStar(seedFromHex(tableSeed));
  const items: DungeonRewardItemIntent[] = [];

  for (const [index, entry] of rewardTable.entries.entries()) {
    for (let rollIndex = 0; rollIndex < entry.rolls; rollIndex += 1) {
      const probability = assertDecimalString(entry.probability, 'REWARD_PROBABILITY');
      if (random.nextUnit().value.gte(probability)) {
        continue;
      }

      const minQuantity = BigInt(entry.minQuantity);
      const maxQuantity = BigInt(entry.maxQuantity ?? entry.minQuantity);
      if (maxQuantity < minQuantity) {
        throw new Error(`DUNGEON_REWARD_QUANTITY_INVALID:${entry.itemId}`);
      }
      const span = maxQuantity - minQuantity + 1n;
      const quantity = minQuantity + (span === 1n ? 0n : BigInt(random.nextUint32()) % span);
      items.push({
        assetId: entry.itemId,
        quantity: quantity.toString(),
        tableId: rewardTable.id,
        sourceRollIndex: index * entry.rolls + rollIndex,
      });
    }
  }

  return {
    outcome,
    routeId: choice.routeId,
    choiceId: choice.id,
    routeRisk: choice.risk,
    combat: combatResult,
    cultivationXp: rewardTable.cultivationXp,
    items,
    rewardTableId: rewardTable.id,
  };
}

function appendEvent(
  events: readonly DungeonRunEvent[],
  eventType: DungeonRunEvent['eventType'],
  nodeId: string,
  payload: JsonValue,
): readonly DungeonRunEvent[] {
  return [...events, {
    eventIndex: events.length,
    eventType,
    nodeId,
    payload: cloneJsonValue(payload),
  }];
}

function validateRunForRecovery(run: DungeonRunState): void {
  if (run.runId.trim().length === 0) {
    throw new Error('DUNGEON_RUN_ID_REQUIRED');
  }
  if (run.characterId.trim().length === 0) {
    throw new Error('DUNGEON_CHARACTER_ID_REQUIRED');
  }
  if (run.selectedChoiceId === null) {
    if (run.phase !== 'ENTERED') {
      throw new Error('DUNGEON_PHASE_MISMATCH');
    }
    return;
  }
  if (run.phase === 'ENTERED') {
    throw new Error('DUNGEON_PHASE_MISMATCH');
  }
  if (run.rewardCandidate === null) {
    throw new Error('DUNGEON_REWARD_CANDIDATE_MISSING');
  }
  if (run.phase === 'FINALIZED' && run.finalization === null) {
    throw new Error('DUNGEON_FINALIZATION_MISSING');
  }
}

export function prepareDungeonRun(input: DungeonPreparationInput): DungeonPreviewResult {
  validateDungeonConfig(input.dungeon);
  return {
    dungeonId: input.dungeon.id,
    configVersion: input.configVersion,
    formulaVersion: input.formulaVersion,
    recommendedPower: input.dungeon.successModel.recommendedPower,
    baseSuccessRate: input.dungeon.successModel.baseSuccessRate,
    estimatedSuccessRate: estimateSuccessRate(input.dungeon, input.playerPower),
    choiceTimeoutSeconds: input.dungeon.choiceTimeoutSeconds,
    opportunityCost: input.dungeon.opportunityCost,
    entryItems: input.dungeon.entryItems,
    choices: input.dungeon.choices.map((choice) => ({
      choiceId: choice.id,
      routeId: choice.routeId,
      risk: choice.risk,
      labelKey: choice.labelKey,
    })),
    coreRewards: input.dungeon.rewardTables.flatMap((table) => table.entries.map((entry) => entry.itemId)),
  };
}

export function enterDungeonRun(input: DungeonRunCreationInput & { readonly preview: DungeonPreviewResult }): DungeonRunState {
  validateDungeonConfig(input.dungeon);
  if (input.preview.dungeonId !== input.dungeon.id) {
    throw new Error('DUNGEON_PREVIEW_DUNGEON_MISMATCH');
  }
  if (input.preview.configVersion !== input.configVersion || input.preview.formulaVersion !== input.formulaVersion) {
    throw new Error('DUNGEON_PREVIEW_VERSION_MISMATCH');
  }
  const expectedChoiceCount = input.dungeon.choices.length;
  if (input.preview.choices.length !== expectedChoiceCount) {
    throw new Error('DUNGEON_PREVIEW_CHOICES_MISMATCH');
  }

  const choiceNode = input.dungeon.choiceNodeId;
  const events = appendEvent([], 'ENTERED', input.dungeon.entryNodeId, {
    startedAtUs: input.startedAtUs,
    configVersion: input.configVersion,
    formulaVersion: input.formulaVersion,
  });
  const withPresentation = appendEvent(events, 'CHOICE_PRESENTED', choiceNode, {
    deadlineAtUs: (
      BigInt(input.startedAtUs) + BigInt(input.dungeon.choiceTimeoutSeconds) * 1_000_000n
    ).toString(),
    defaultSafeChoiceId: input.dungeon.defaultSafeChoiceId,
  });

  return {
    runId: input.runId,
    characterId: input.characterId,
    dungeonId: input.dungeon.id,
    configVersion: input.configVersion,
    formulaVersion: input.formulaVersion,
    seedHex: input.seedHex,
    phase: 'ENTERED',
    outcome: 'PENDING',
    revision: 0,
    currentNodeId: choiceNode,
    choiceDeadlineAtUs: (BigInt(input.startedAtUs) + BigInt(input.dungeon.choiceTimeoutSeconds) * 1_000_000n).toString(),
    selectedChoiceId: null,
    selectedRouteId: null,
    selectedRouteRisk: null,
    selectedAtUs: null,
    combatResolvedAtUs: null,
    finalizedAtUs: null,
    loadoutSnapshot: cloneJsonValue(input.loadoutSnapshot),
    buffSnapshot: cloneJsonValue(input.buffSnapshot),
    strategySnapshot: cloneJsonValue(input.strategySnapshot),
    playerCombatSnapshot: input.playerCombatSnapshot,
    config: input.dungeon,
    combatResult: null,
    rewardCandidate: null,
    finalization: null,
    events: withPresentation,
  };
}

function resolveRewardTable(run: DungeonRunState, choice: DungeonChoiceConfig, outcome: DungeonOutcome): DungeonRewardTable {
  const tables = rewardTableMap(run.config);
  const tableId = outcome === 'SUCCESS' ? choice.successRewardTableId : choice.failureRewardTableId;
  const table = tables.get(tableId);
  if (table === undefined) {
    throw new Error(`DUNGEON_REWARD_TABLE_MISSING:${tableId}`);
  }
  return table;
}

export function submitDungeonChoice(input: DungeonChoiceInput): DungeonRunState {
  const { run } = input;
  validateRunForRecovery(run);
  if (run.selectedChoiceId !== null) {
    if (run.selectedChoiceId === input.choiceId) {
      return run;
    }
    throw new Error('DUNGEON_CHOICE_LOCKED');
  }
  if (run.phase !== 'ENTERED') {
    throw new Error('DUNGEON_CHOICE_INVALID_TRANSITION');
  }
  if (run.revision !== input.expectedRunVersion) {
    throw new Error('DUNGEON_RUN_VERSION_CONFLICT');
  }
  const choice = choiceMap(run.config).get(input.choiceId);
  if (choice === undefined) {
    throw new Error(`DUNGEON_CHOICE_MISSING:${input.choiceId}`);
  }

  const battleSeedHex = deriveSeedHex(run.seedHex, 'dungeon.combat', `${run.runId}:${choice.id}`, `${run.configVersion}:${run.formulaVersion}`);
  const combatInput: CombatSimulationInput = {
    seedHex: battleSeedHex,
    player: run.playerCombatSnapshot,
    enemy: choice.battleEnemy,
    ...(choice.maxEvents === undefined ? {} : { maxEvents: choice.maxEvents }),
    ...(choice.maxRounds === undefined ? {} : { maxRounds: choice.maxRounds }),
  };
  const combatResult = normalizeCombatResult(simulateCombatEncounter(combatInput));
  const outcome: DungeonOutcome =
    combatResult.terminationReason === 'ENEMY_DEFEATED'
      ? 'SUCCESS'
      : combatResult.terminationReason === 'DOUBLE_KO'
        ? 'DOUBLE_KO'
        : 'FAILURE';
  const rewardTable = resolveRewardTable(run, choice, outcome);
  const rewardCandidate = buildRewardCandidate(run, choice, combatResult, rewardTable, outcome);

  const updatedEvents = appendEvent(run.events, 'CHOICE_SELECTED', run.currentNodeId, {
    choiceId: choice.id,
    routeId: choice.routeId,
    risk: choice.risk,
    expectedRunVersion: input.expectedRunVersion,
  });
  const withCombat = appendEvent(updatedEvents, 'COMBAT_RESOLVED', run.config.battleNodeId, {
    outcome,
    terminationReason: combatResult.terminationReason,
    winner: combatResult.winner,
    elapsedUs: combatResult.elapsedUs,
  });
  const withReward = appendEvent(withCombat, 'REWARD_CANDIDATE', run.config.rewardNodeId, {
    rewardTableId: rewardTable.id,
    cultivationXp: rewardCandidate.cultivationXp,
    items: rewardCandidate.items,
  });

  return {
    ...run,
    phase: 'REWARD_CANDIDATE',
    outcome,
    revision: run.revision + 1,
    currentNodeId: run.config.rewardNodeId,
    selectedChoiceId: choice.id,
    selectedRouteId: choice.routeId,
    selectedRouteRisk: choice.risk,
    selectedAtUs: input.chosenAtUs,
    combatResolvedAtUs: input.chosenAtUs,
    finalizedAtUs: null,
    combatResult,
    rewardCandidate,
    finalization: null,
    events: withReward,
  };
}

export function resolveDungeonTimeout(input: DungeonTimeoutInput): DungeonRunState {
  const { run } = input;
  if (run.selectedChoiceId !== null) {
    return run;
  }
  if (run.phase !== 'ENTERED') {
    throw new Error('DUNGEON_TIMEOUT_INVALID_TRANSITION');
  }
  if (BigInt(input.chosenAtUs) < BigInt(run.choiceDeadlineAtUs)) {
    throw new Error('DUNGEON_CHOICE_NOT_EXPIRED');
  }
  const safeChoice = choiceMap(run.config).get(run.config.defaultSafeChoiceId);
  if (safeChoice === undefined) {
    throw new Error(`DUNGEON_DEFAULT_SAFE_CHOICE_MISSING:${run.config.defaultSafeChoiceId}`);
  }
  const timedOutEvents = appendEvent(run.events, 'CHOICE_TIMEOUT', run.currentNodeId, {
    chosenAtUs: input.chosenAtUs,
    defaultSafeChoiceId: safeChoice.id,
  });
  return submitDungeonChoice({
    run: {
      ...run,
      events: timedOutEvents,
    },
    choiceId: safeChoice.id,
    expectedRunVersion: run.revision,
    chosenAtUs: input.chosenAtUs,
  });
}

export function finalizeDungeonRun(input: DungeonFinalizeInput): DungeonRunState {
  const { run } = input;
  validateRunForRecovery(run);
  if (run.phase === 'FINALIZED') {
    return run;
  }
  if (run.phase !== 'REWARD_CANDIDATE' || run.rewardCandidate === null) {
    throw new Error('DUNGEON_FINALIZE_INVALID_TRANSITION');
  }
  const finalization: DungeonFinalization = {
    finalizedAtUs: input.finalizedAtUs,
    reward: run.rewardCandidate,
  };
  return {
    ...run,
    phase: 'FINALIZED',
    revision: run.revision + 1,
    finalizedAtUs: input.finalizedAtUs,
    finalization,
    events: appendEvent(run.events, 'FINALIZED', run.config.rewardNodeId, {
      finalizedAtUs: input.finalizedAtUs,
      outcome: run.outcome,
      rewardTableId: run.rewardCandidate.rewardTableId,
    }),
  };
}

export function restoreDungeonRunState(snapshot: DungeonRunState): DungeonRunState {
  validateDungeonConfig(snapshot.config);
  validateRunForRecovery(snapshot);
  return {
    ...snapshot,
    loadoutSnapshot: cloneJsonValue(snapshot.loadoutSnapshot),
    buffSnapshot: cloneJsonValue(snapshot.buffSnapshot),
    strategySnapshot: cloneJsonValue(snapshot.strategySnapshot),
    combatResult: snapshot.combatResult === null ? null : cloneJsonValue(snapshot.combatResult),
    rewardCandidate: snapshot.rewardCandidate === null ? null : cloneJsonValue(snapshot.rewardCandidate),
    finalization: snapshot.finalization === null ? null : cloneJsonValue(snapshot.finalization),
    events: snapshot.events.map((event) => ({
      ...event,
      payload: cloneJsonValue(event.payload),
    })),
  };
}
