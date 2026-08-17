import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';
import type { JsonValue } from './outbox.js';

export type DungeonOpportunityStateRecord = {
  readonly characterId: string;
  readonly opportunityCount: number;
  readonly opportunityCap: number;
  readonly recoveryAnchorAt: Date;
  readonly nextRecoveryAt: Date | null;
  readonly teachingGrantTutorialId: string | null;
  readonly teachingGrantClaimedAt: Date | null;
};

export type DungeonOpportunitySnapshot = DungeonOpportunityStateRecord & {
  readonly availableOpportunities: number;
  readonly isCapped: boolean;
  readonly recoveryIntervalSeconds: number;
  readonly calculationAsOf: Date;
};

export type DungeonOpportunityMutationResult = {
  readonly state: DungeonOpportunitySnapshot;
  readonly ledgerEntryId: string;
  readonly appliedQuantity: number;
  readonly wasAlreadyClaimed?: boolean;
};

export type DungeonRunRecord = {
  readonly runId: string;
  readonly characterId: string;
  readonly dungeonId: string;
  readonly status: string;
  readonly currentNodeId: string;
  readonly phase: string;
  readonly outcome: string;
  readonly revision: string;
  readonly initialRouteId: string;
  readonly loadoutPresetId: string | null;
  readonly strategyPresetId: string | null;
  readonly opportunityCost: number;
  readonly stateVersion: string;
  readonly configVersion: string;
  readonly choiceDeadlineAt: Date;
  readonly selectedChoiceId: string | null;
  readonly selectedRouteId: string | null;
  readonly selectedRouteRisk: string | null;
  readonly selectedAt: Date | null;
  readonly combatResolvedAt: Date | null;
  readonly finalizedAt: Date | null;
  readonly runState: JsonValue;
  readonly rewardIntent: JsonValue | null;
  readonly resultSnapshot: JsonValue | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type DungeonRunCreateInput = {
  readonly runId?: string;
  readonly characterId: string;
  readonly dungeonId: string;
  readonly status: string;
  readonly currentNodeId: string;
  readonly phase: string;
  readonly outcome: string;
  readonly revision: string;
  readonly initialRouteId: string;
  readonly loadoutPresetId: string | null;
  readonly strategyPresetId: string | null;
  readonly opportunityCost: number;
  readonly stateVersion: string;
  readonly configVersion: string;
  readonly choiceDeadlineAt: Date;
  readonly selectedChoiceId: string | null;
  readonly selectedRouteId: string | null;
  readonly selectedRouteRisk: string | null;
  readonly selectedAt: Date | null;
  readonly combatResolvedAt: Date | null;
  readonly finalizedAt: Date | null;
  readonly runState: JsonValue;
  readonly rewardIntent: JsonValue | null;
  readonly resultSnapshot: JsonValue | null;
};

export type DungeonRunUpdateInput = {
  readonly runId: string;
  readonly characterId: string;
  readonly currentNodeId: string;
  readonly phase: string;
  readonly outcome: string;
  readonly revision: string;
  readonly stateVersion: string;
  readonly choiceDeadlineAt: Date;
  readonly selectedChoiceId: string | null;
  readonly selectedRouteId: string | null;
  readonly selectedRouteRisk: string | null;
  readonly selectedAt: Date | null;
  readonly combatResolvedAt: Date | null;
  readonly finalizedAt: Date | null;
  readonly runState: JsonValue;
  readonly rewardIntent: JsonValue | null;
  readonly resultSnapshot: JsonValue | null;
};

export type DungeonTeachingGrantInput = {
  readonly characterId: string;
  readonly sourceTutorialId: string;
  readonly reasonCode: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly configVersion: string;
  readonly now: Date;
};

export type DungeonOpportunityConsumeInput = {
  readonly characterId: string;
  readonly reasonCode: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly configVersion: string;
  readonly now: Date;
  readonly quantity?: number;
};

type DungeonOpportunityStateRow = {
  character_id: string;
  opportunity_count: number;
  opportunity_cap: number;
  recovery_anchor_at: Date;
  next_recovery_at: Date | null;
  teaching_grant_tutorial_id: string | null;
  teaching_grant_claimed_at: Date | null;
};

type DungeonOpportunityLedgerRow = {
  entry_id: string;
};

type DungeonRunRow = {
  id: string;
  character_id: string;
  dungeon_id: string;
  status: string;
  current_node_id: string;
  phase: string;
  outcome: string;
  revision: string;
  initial_route_id: string;
  loadout_preset_id: string | null;
  strategy_preset_id: string | null;
  opportunity_cost: number;
  state_version: string;
  config_version: string;
  choice_deadline_at: Date;
  selected_choice_id: string | null;
  selected_route_id: string | null;
  selected_route_risk: string | null;
  selected_at: Date | null;
  combat_resolved_at: Date | null;
  finalized_at: Date | null;
  run_state: JsonValue;
  reward_intent: JsonValue | null;
  result_snapshot: JsonValue | null;
  created_at: Date;
  updated_at: Date;
};

const RECOVERY_INTERVAL_SECONDS = 12 * 60 * 60;
const RECOVERY_INTERVAL_MS = RECOVERY_INTERVAL_SECONDS * 1_000;
const DEFAULT_OPPORTUNITY_CAP = 6;

function ensurePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`DUNGEON_${field}_INVALID`);
  }
}

function ensureNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`DUNGEON_${field}_REQUIRED`);
  }
}

function json(value: JsonValue): string {
  return JSON.stringify(value);
}

function toSnapshot(row: DungeonOpportunityStateRow, asOf: Date): DungeonOpportunitySnapshot {
  const projected = projectState(row, asOf);
  return {
    characterId: row.character_id,
    opportunityCount: projected.opportunityCount,
    opportunityCap: row.opportunity_cap,
    recoveryAnchorAt: row.recovery_anchor_at,
    nextRecoveryAt: projected.nextRecoveryAt,
    teachingGrantTutorialId: row.teaching_grant_tutorial_id,
    teachingGrantClaimedAt: row.teaching_grant_claimed_at,
    availableOpportunities: projected.opportunityCount,
    isCapped: projected.opportunityCount >= row.opportunity_cap,
    recoveryIntervalSeconds: RECOVERY_INTERVAL_SECONDS,
    calculationAsOf: asOf,
  };
}

function projectState(
  row: DungeonOpportunityStateRow,
  asOf: Date,
): {
  readonly opportunityCount: number;
  readonly nextRecoveryAt: Date | null;
} {
  let opportunityCount = row.opportunity_count;
  let nextRecoveryAt = row.next_recovery_at;

  while (
    opportunityCount < row.opportunity_cap
    && nextRecoveryAt !== null
    && nextRecoveryAt.getTime() <= asOf.getTime()
  ) {
    opportunityCount += 1;
    if (opportunityCount >= row.opportunity_cap) {
      nextRecoveryAt = null;
      break;
    }
    nextRecoveryAt = new Date(nextRecoveryAt.getTime() + RECOVERY_INTERVAL_MS);
  }

  return { opportunityCount, nextRecoveryAt };
}

function rowToState(row: DungeonOpportunityStateRow): DungeonOpportunityStateRecord {
  return {
    characterId: row.character_id,
    opportunityCount: row.opportunity_count,
    opportunityCap: row.opportunity_cap,
    recoveryAnchorAt: row.recovery_anchor_at,
    nextRecoveryAt: row.next_recovery_at,
    teachingGrantTutorialId: row.teaching_grant_tutorial_id,
    teachingGrantClaimedAt: row.teaching_grant_claimed_at,
  };
}

async function selectState(
  client: Pick<PoolClient, 'query'>,
  characterId: string,
  lock: boolean,
): Promise<DungeonOpportunityStateRecord | null> {
  const result = await client.query<DungeonOpportunityStateRow>(
    `SELECT character_id, opportunity_count, opportunity_cap,
            recovery_anchor_at, next_recovery_at,
            teaching_grant_tutorial_id, teaching_grant_claimed_at
       FROM dungeon_opportunity_states
      WHERE character_id = $1
      ${lock ? 'FOR UPDATE' : ''}`,
    [characterId],
  );
  const row = result.rows[0];
  return row ? rowToState(row) : null;
}

async function ensureStateOnTransaction(
  client: PoolClient,
  characterId: string,
  now: Date,
): Promise<DungeonOpportunityStateRecord> {
  await client.query(
    `INSERT INTO dungeon_opportunity_states (
       character_id, opportunity_count, opportunity_cap,
       recovery_anchor_at, next_recovery_at,
       teaching_grant_tutorial_id, teaching_grant_claimed_at
     )
     VALUES ($1, 0, $2, $3, $4, NULL, NULL)
     ON CONFLICT (character_id) DO NOTHING`,
    [characterId, DEFAULT_OPPORTUNITY_CAP, now, new Date(now.getTime() + RECOVERY_INTERVAL_MS)],
  );
  const state = await selectState(client, characterId, true);
  if (!state) {
    throw new Error('DUNGEON_OPPORTUNITY_STATE_NOT_FOUND');
  }
  return state;
}

type DungeonOpportunityLedgerInput = Pick<
  DungeonOpportunityConsumeInput,
  'characterId' | 'reasonCode' | 'referenceType' | 'referenceId' | 'configVersion'
>;

async function writeLedgerEntry(
  client: PoolClient,
  input: DungeonOpportunityLedgerInput,
  delta: number,
  balanceAfter: number,
): Promise<string> {
  const result = await client.query<DungeonOpportunityLedgerRow>(
    `INSERT INTO dungeon_opportunity_ledger (
       character_id, delta, balance_after, reason_code,
       reference_type, reference_id, config_version
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING entry_id`,
    [
      input.characterId,
      delta,
      balanceAfter,
      input.reasonCode,
      input.referenceType,
      input.referenceId,
      input.configVersion,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('DUNGEON_OPPORTUNITY_LEDGER_NOT_CREATED');
  }
  return row.entry_id;
}

async function updateState(
  client: PoolClient,
  characterId: string,
  nextState: {
    readonly opportunityCount: number;
    readonly recoveryAnchorAt: Date;
    readonly nextRecoveryAt: Date | null;
    readonly teachingGrantTutorialId: string | null;
    readonly teachingGrantClaimedAt: Date | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE dungeon_opportunity_states
        SET opportunity_count = $2,
            recovery_anchor_at = $3,
            next_recovery_at = $4,
            teaching_grant_tutorial_id = $5,
            teaching_grant_claimed_at = $6,
            updated_at = CURRENT_TIMESTAMP
      WHERE character_id = $1`,
    [
      characterId,
      nextState.opportunityCount,
      nextState.recoveryAnchorAt,
      nextState.nextRecoveryAt,
      nextState.teachingGrantTutorialId,
      nextState.teachingGrantClaimedAt,
    ],
  );
}

function toDungeonRunRecord(row: DungeonRunRow): DungeonRunRecord {
  return {
    runId: row.id,
    characterId: row.character_id,
    dungeonId: row.dungeon_id,
    status: row.status,
    currentNodeId: row.current_node_id,
    phase: row.phase,
    outcome: row.outcome,
    revision: row.revision,
    initialRouteId: row.initial_route_id,
    loadoutPresetId: row.loadout_preset_id,
    strategyPresetId: row.strategy_preset_id,
    opportunityCost: row.opportunity_cost,
    stateVersion: row.state_version,
    configVersion: row.config_version,
    choiceDeadlineAt: row.choice_deadline_at,
    selectedChoiceId: row.selected_choice_id,
    selectedRouteId: row.selected_route_id,
    selectedRouteRisk: row.selected_route_risk,
    selectedAt: row.selected_at,
    combatResolvedAt: row.combat_resolved_at,
    finalizedAt: row.finalized_at,
    runState: row.run_state,
    rewardIntent: row.reward_intent,
    resultSnapshot: row.result_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function settleOpportunityStateOnTransaction(
  client: PoolClient,
  characterId: string,
  now: Date,
): Promise<{ readonly state: DungeonOpportunityStateRecord; readonly recovered: number; readonly snapshot: DungeonOpportunitySnapshot }> {
  const state = await ensureStateOnTransaction(client, characterId, now);
  const projected = projectState({
    character_id: state.characterId,
    opportunity_count: state.opportunityCount,
    opportunity_cap: state.opportunityCap,
    recovery_anchor_at: state.recoveryAnchorAt,
    next_recovery_at: state.nextRecoveryAt,
    teaching_grant_tutorial_id: state.teachingGrantTutorialId,
    teaching_grant_claimed_at: state.teachingGrantClaimedAt,
  }, now);
  const recovered = projected.opportunityCount - state.opportunityCount;

  if (recovered > 0) {
    const nextState = {
      opportunityCount: projected.opportunityCount,
      recoveryAnchorAt: state.recoveryAnchorAt,
      nextRecoveryAt: projected.nextRecoveryAt,
      teachingGrantTutorialId: state.teachingGrantTutorialId,
      teachingGrantClaimedAt: state.teachingGrantClaimedAt,
    };
    await updateState(client, characterId, nextState);
    await writeLedgerEntry(
      client,
      {
        characterId,
        reasonCode: 'DUNGEON_OPPORTUNITY_RECOVERY',
        referenceType: 'DUNGEON_OPPORTUNITY_STATE',
        referenceId: characterId,
        configVersion: 'system',
      },
      recovered,
      projected.opportunityCount,
    );
  }

  const currentState = recovered > 0
    ? {
        ...state,
        opportunityCount: projected.opportunityCount,
        nextRecoveryAt: projected.nextRecoveryAt,
      }
    : state;

  return {
    state: currentState,
    recovered,
    snapshot: toSnapshot({
      character_id: currentState.characterId,
      opportunity_count: currentState.opportunityCount,
      opportunity_cap: currentState.opportunityCap,
      recovery_anchor_at: currentState.recoveryAnchorAt,
      next_recovery_at: currentState.nextRecoveryAt,
      teaching_grant_tutorial_id: currentState.teachingGrantTutorialId,
      teaching_grant_claimed_at: currentState.teachingGrantClaimedAt,
    }, now),
  };
}

export type DungeonRepository = {
  readonly getOpportunitySnapshot: (characterId: string, asOf?: Date) => Promise<DungeonOpportunitySnapshot | null>;
  readonly settleOpportunityStateOnTransaction: (
    client: PoolClient,
    characterId: string,
    now: Date,
  ) => Promise<{ readonly state: DungeonOpportunityStateRecord; readonly recovered: number; readonly snapshot: DungeonOpportunitySnapshot }>;
  readonly grantTeachingOpportunityOnTransaction: (
    client: PoolClient,
    input: DungeonTeachingGrantInput,
  ) => Promise<DungeonOpportunityMutationResult>;
  readonly consumeOpportunityOnTransaction: (
    client: PoolClient,
    input: DungeonOpportunityConsumeInput,
  ) => Promise<DungeonOpportunityMutationResult>;
  readonly createDungeonRunOnTransaction: (
    client: PoolClient,
    input: DungeonRunCreateInput,
  ) => Promise<DungeonRunRecord>;
  readonly updateDungeonRunOnTransaction: (
    client: PoolClient,
    input: DungeonRunUpdateInput,
  ) => Promise<DungeonRunRecord>;
  readonly getDungeonRun: (characterId: string, runId: string) => Promise<DungeonRunRecord | null>;
  readonly getDungeonRunById: (runId: string) => Promise<DungeonRunRecord | null>;
  readonly getActiveDungeonRun: (characterId: string, dungeonId: string) => Promise<DungeonRunRecord | null>;
};

export function createDungeonRepository(pool: DatabasePool): DungeonRepository {
  async function getOpportunitySnapshot(characterId: string, asOf = new Date()): Promise<DungeonOpportunitySnapshot | null> {
    const state = await selectState(pool, characterId, false);
    if (!state) {
      return {
        characterId,
        opportunityCount: 0,
        opportunityCap: DEFAULT_OPPORTUNITY_CAP,
        recoveryAnchorAt: asOf,
        nextRecoveryAt: new Date(asOf.getTime() + RECOVERY_INTERVAL_MS),
        teachingGrantTutorialId: null,
        teachingGrantClaimedAt: null,
        availableOpportunities: 0,
        isCapped: false,
        recoveryIntervalSeconds: RECOVERY_INTERVAL_SECONDS,
        calculationAsOf: asOf,
      };
    }
    return toSnapshot({
      character_id: state.characterId,
      opportunity_count: state.opportunityCount,
      opportunity_cap: state.opportunityCap,
      recovery_anchor_at: state.recoveryAnchorAt,
      next_recovery_at: state.nextRecoveryAt,
      teaching_grant_tutorial_id: state.teachingGrantTutorialId,
      teaching_grant_claimed_at: state.teachingGrantClaimedAt,
    }, asOf);
  }

  async function grantTeachingOpportunityOnTransaction(
    client: PoolClient,
    input: DungeonTeachingGrantInput,
  ): Promise<DungeonOpportunityMutationResult> {
    ensureNonEmpty(input.characterId, 'CHARACTER_ID');
    ensureNonEmpty(input.sourceTutorialId, 'SOURCE_TUTORIAL_ID');
    ensureNonEmpty(input.reasonCode, 'REASON_CODE');
    ensureNonEmpty(input.referenceType, 'REFERENCE_TYPE');
    ensureNonEmpty(input.referenceId, 'REFERENCE_ID');
    ensureNonEmpty(input.configVersion, 'CONFIG_VERSION');
    const settled = await settleOpportunityStateOnTransaction(client, input.characterId, input.now);
    const alreadyClaimed = settled.state.teachingGrantClaimedAt !== null;
    const nextState = {
      opportunityCount: settled.state.opportunityCount,
      recoveryAnchorAt: settled.state.recoveryAnchorAt,
      nextRecoveryAt: settled.state.nextRecoveryAt,
      teachingGrantTutorialId: settled.state.teachingGrantTutorialId,
      teachingGrantClaimedAt: settled.state.teachingGrantClaimedAt,
    };
    let appliedQuantity = 0;
    if (!alreadyClaimed) {
      const nextCount = Math.min(settled.state.opportunityCap, settled.state.opportunityCount + 1);
      appliedQuantity = nextCount - settled.state.opportunityCount;
      nextState.opportunityCount = nextCount;
      nextState.teachingGrantTutorialId = input.sourceTutorialId;
      nextState.teachingGrantClaimedAt = input.now;
      nextState.nextRecoveryAt = nextCount >= settled.state.opportunityCap ? null : settled.state.nextRecoveryAt;
      await updateState(client, input.characterId, nextState);
      const ledgerEntryId = await writeLedgerEntry(
        client,
        input,
        appliedQuantity,
        nextCount,
      );
      return {
        state: {
          ...settled.snapshot,
          opportunityCount: nextCount,
          nextRecoveryAt: nextState.nextRecoveryAt,
          teachingGrantTutorialId: input.sourceTutorialId,
          teachingGrantClaimedAt: input.now,
          availableOpportunities: nextCount,
          isCapped: nextCount >= settled.state.opportunityCap,
          calculationAsOf: input.now,
        },
        ledgerEntryId,
        appliedQuantity,
        wasAlreadyClaimed: false,
      };
    }

    const ledgerEntryId = await writeLedgerEntry(
      client,
      input,
      0,
      settled.state.opportunityCount,
    );
    return { state: settled.snapshot, ledgerEntryId, appliedQuantity, wasAlreadyClaimed: true };
  }

  async function consumeOpportunityOnTransaction(
    client: PoolClient,
    input: DungeonOpportunityConsumeInput,
  ): Promise<DungeonOpportunityMutationResult> {
    ensureNonEmpty(input.characterId, 'CHARACTER_ID');
    ensureNonEmpty(input.reasonCode, 'REASON_CODE');
    ensureNonEmpty(input.referenceType, 'REFERENCE_TYPE');
    ensureNonEmpty(input.referenceId, 'REFERENCE_ID');
    ensureNonEmpty(input.configVersion, 'CONFIG_VERSION');
    ensurePositiveInteger(input.quantity ?? 1, 'QUANTITY');
    const quantity = input.quantity ?? 1;
    const settled = await settleOpportunityStateOnTransaction(client, input.characterId, input.now);
    if (settled.state.opportunityCount < quantity) {
      throw new Error('INSUFFICIENT_OPPORTUNITY');
    }

    const nextCount = settled.state.opportunityCount - quantity;
    const nextRecoveryAt = settled.state.opportunityCount >= settled.state.opportunityCap && settled.state.nextRecoveryAt === null
      ? new Date(input.now.getTime() + RECOVERY_INTERVAL_MS)
      : settled.state.nextRecoveryAt;
    const nextState = {
      opportunityCount: nextCount,
      recoveryAnchorAt: settled.state.opportunityCount >= settled.state.opportunityCap && settled.state.nextRecoveryAt === null
        ? input.now
        : settled.state.recoveryAnchorAt,
      nextRecoveryAt,
      teachingGrantTutorialId: settled.state.teachingGrantTutorialId,
      teachingGrantClaimedAt: settled.state.teachingGrantClaimedAt,
    };
    await updateState(client, input.characterId, nextState);
    const ledgerEntryId = await writeLedgerEntry(
      client,
      input,
      -quantity,
      nextCount,
    );
    return {
      state: {
        ...settled.snapshot,
        opportunityCount: nextCount,
        nextRecoveryAt,
        recoveryAnchorAt: nextState.recoveryAnchorAt,
        availableOpportunities: nextCount,
        isCapped: nextCount >= settled.state.opportunityCap,
        calculationAsOf: input.now,
      },
      ledgerEntryId,
      appliedQuantity: quantity,
      wasAlreadyClaimed: false,
    };
  }

  async function createDungeonRunOnTransaction(
    client: PoolClient,
    input: DungeonRunCreateInput,
  ): Promise<DungeonRunRecord> {
  ensureNonEmpty(input.characterId, 'CHARACTER_ID');
  ensureNonEmpty(input.dungeonId, 'DUNGEON_ID');
  ensureNonEmpty(input.status, 'STATUS');
  ensureNonEmpty(input.currentNodeId, 'CURRENT_NODE_ID');
    ensureNonEmpty(input.initialRouteId, 'INITIAL_ROUTE_ID');
    ensureNonEmpty(input.stateVersion, 'STATE_VERSION');
    ensureNonEmpty(input.configVersion, 'CONFIG_VERSION');
    ensurePositiveInteger(input.opportunityCost, 'OPPORTUNITY_COST');
    const result = input.runId === undefined
      ? await client.query<DungeonRunRow>(
          `INSERT INTO dungeon_runs (
             character_id, dungeon_id, status, current_node_id,
             phase, outcome, revision, initial_route_id,
             loadout_preset_id, strategy_preset_id, opportunity_cost,
             state_version, config_version, choice_deadline_at,
             selected_choice_id, selected_route_id, selected_route_risk,
             selected_at, combat_resolved_at, finalized_at,
             run_state, reward_intent, result_snapshot
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                  $15, $16, $17, $18, $19, $20, $21::jsonb, $22::jsonb, $23::jsonb)
           RETURNING id, character_id, dungeon_id, status, current_node_id,
                     phase, outcome, revision::text AS revision,
                     initial_route_id, loadout_preset_id, strategy_preset_id,
                     opportunity_cost, state_version::text AS state_version,
                     config_version, choice_deadline_at, selected_choice_id,
                     selected_route_id, selected_route_risk, selected_at,
                     combat_resolved_at, finalized_at, run_state, reward_intent,
                     result_snapshot, created_at, updated_at`,
          [
            input.characterId,
            input.dungeonId,
            input.status,
            input.currentNodeId,
            input.phase,
            input.outcome,
            input.revision,
            input.initialRouteId,
            input.loadoutPresetId,
            input.strategyPresetId,
            input.opportunityCost,
            input.stateVersion,
            input.configVersion,
            input.choiceDeadlineAt,
            input.selectedChoiceId,
            input.selectedRouteId,
            input.selectedRouteRisk,
            input.selectedAt,
            input.combatResolvedAt,
            input.finalizedAt,
            json(input.runState),
            input.rewardIntent === null ? null : json(input.rewardIntent),
            input.resultSnapshot === null ? null : json(input.resultSnapshot),
          ],
        )
      : await client.query<DungeonRunRow>(
          `INSERT INTO dungeon_runs (
             id, character_id, dungeon_id, status, current_node_id,
             phase, outcome, revision, initial_route_id,
             loadout_preset_id, strategy_preset_id, opportunity_cost,
             state_version, config_version, choice_deadline_at,
             selected_choice_id, selected_route_id, selected_route_risk,
             selected_at, combat_resolved_at, finalized_at,
             run_state, reward_intent, result_snapshot
           )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                  $15, $16, $17, $18, $19, $20, $21, $22::jsonb, $23::jsonb, $24::jsonb)
           RETURNING id, character_id, dungeon_id, status, current_node_id,
                     phase, outcome, revision::text AS revision,
                     initial_route_id, loadout_preset_id, strategy_preset_id,
                     opportunity_cost, state_version::text AS state_version,
                     config_version, choice_deadline_at, selected_choice_id,
                     selected_route_id, selected_route_risk, selected_at,
                     combat_resolved_at, finalized_at, run_state, reward_intent,
                     result_snapshot, created_at, updated_at`,
          [
            input.runId,
            input.characterId,
            input.dungeonId,
            input.status,
            input.currentNodeId,
            input.phase,
            input.outcome,
            input.revision,
            input.initialRouteId,
            input.loadoutPresetId,
            input.strategyPresetId,
            input.opportunityCost,
            input.stateVersion,
            input.configVersion,
            input.choiceDeadlineAt,
            input.selectedChoiceId,
            input.selectedRouteId,
            input.selectedRouteRisk,
            input.selectedAt,
            input.combatResolvedAt,
            input.finalizedAt,
            json(input.runState),
            input.rewardIntent === null ? null : json(input.rewardIntent),
            input.resultSnapshot === null ? null : json(input.resultSnapshot),
          ],
        );
    const row = result.rows[0];
    if (!row) {
      throw new Error('DUNGEON_RUN_NOT_CREATED');
    }
    return toDungeonRunRecord(row);
  }

  async function updateDungeonRunOnTransaction(
    client: PoolClient,
    input: DungeonRunUpdateInput,
  ): Promise<DungeonRunRecord> {
    ensureNonEmpty(input.runId, 'RUN_ID');
    ensureNonEmpty(input.characterId, 'CHARACTER_ID');
    ensureNonEmpty(input.currentNodeId, 'CURRENT_NODE_ID');
    ensureNonEmpty(input.phase, 'PHASE');
    ensureNonEmpty(input.outcome, 'OUTCOME');
    ensureNonEmpty(input.revision, 'REVISION');
    ensureNonEmpty(input.stateVersion, 'STATE_VERSION');
    const result = await client.query<DungeonRunRow>(
      `UPDATE dungeon_runs
          SET current_node_id = $3,
              phase = $4,
              outcome = $5,
              revision = $6,
              state_version = $7,
              choice_deadline_at = $8,
              selected_choice_id = $9,
              selected_route_id = $10,
              selected_route_risk = $11,
              selected_at = $12,
              combat_resolved_at = $13,
              finalized_at = $14,
              run_state = $15::jsonb,
              reward_intent = $16::jsonb,
              result_snapshot = $17::jsonb,
              status = $4,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND character_id = $2
        RETURNING id, character_id, dungeon_id, status, current_node_id,
                  phase, outcome, revision::text AS revision,
                  initial_route_id, loadout_preset_id, strategy_preset_id,
                  opportunity_cost, state_version::text AS state_version,
                  config_version, choice_deadline_at, selected_choice_id,
                  selected_route_id, selected_route_risk, selected_at,
                  combat_resolved_at, finalized_at, run_state, reward_intent,
                  result_snapshot, created_at, updated_at`,
      [
        input.runId,
        input.characterId,
        input.currentNodeId,
        input.phase,
        input.outcome,
        input.revision,
        input.stateVersion,
        input.choiceDeadlineAt,
        input.selectedChoiceId,
        input.selectedRouteId,
        input.selectedRouteRisk,
        input.selectedAt,
        input.combatResolvedAt,
        input.finalizedAt,
        json(input.runState),
        input.rewardIntent === null ? null : json(input.rewardIntent),
        input.resultSnapshot === null ? null : json(input.resultSnapshot),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('DUNGEON_RUN_NOT_UPDATED');
    }
    return toDungeonRunRecord(row);
  }

  async function getDungeonRun(characterId: string, runId: string): Promise<DungeonRunRecord | null> {
    const result = await pool.query<DungeonRunRow>(
      `SELECT id, character_id, dungeon_id, status, current_node_id,
              phase, outcome, revision::text AS revision,
              initial_route_id, loadout_preset_id, strategy_preset_id,
              opportunity_cost, state_version::text AS state_version,
              config_version, choice_deadline_at, selected_choice_id,
              selected_route_id, selected_route_risk, selected_at,
              combat_resolved_at, finalized_at, run_state, reward_intent,
              result_snapshot, created_at, updated_at
         FROM dungeon_runs
        WHERE character_id = $1 AND id = $2
        LIMIT 1`,
      [characterId, runId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return toDungeonRunRecord(row);
  }

  async function getDungeonRunById(runId: string): Promise<DungeonRunRecord | null> {
    const result = await pool.query<DungeonRunRow>(
      `SELECT id, character_id, dungeon_id, status, current_node_id,
              phase, outcome, revision::text AS revision,
              initial_route_id, loadout_preset_id, strategy_preset_id,
              opportunity_cost, state_version::text AS state_version,
              config_version, choice_deadline_at, selected_choice_id,
              selected_route_id, selected_route_risk, selected_at,
              combat_resolved_at, finalized_at, run_state, reward_intent,
              result_snapshot, created_at, updated_at
         FROM dungeon_runs
        WHERE id = $1
        LIMIT 1`,
      [runId],
    );
    const row = result.rows[0];
    return row ? toDungeonRunRecord(row) : null;
  }

  async function getActiveDungeonRun(characterId: string, dungeonId: string): Promise<DungeonRunRecord | null> {
    const result = await pool.query<DungeonRunRow>(
      `SELECT id, character_id, dungeon_id, status, current_node_id,
              phase, outcome, revision::text AS revision,
              initial_route_id, loadout_preset_id, strategy_preset_id,
              opportunity_cost, state_version::text AS state_version,
              config_version, choice_deadline_at, selected_choice_id,
              selected_route_id, selected_route_risk, selected_at,
              combat_resolved_at, finalized_at, run_state, reward_intent,
              result_snapshot, created_at, updated_at
         FROM dungeon_runs
        WHERE character_id = $1
          AND dungeon_id = $2
          AND phase <> 'FINALIZED'
        ORDER BY created_at DESC
        LIMIT 1`,
      [characterId, dungeonId],
    );
    const row = result.rows[0];
    return row ? toDungeonRunRecord(row) : null;
  }

  return {
    getOpportunitySnapshot,
    settleOpportunityStateOnTransaction,
    grantTeachingOpportunityOnTransaction,
    consumeOpportunityOnTransaction,
    createDungeonRunOnTransaction,
    updateDungeonRunOnTransaction,
    getDungeonRun,
    getDungeonRunById,
    getActiveDungeonRun,
  };
}
