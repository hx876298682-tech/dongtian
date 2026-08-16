import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { ConfigRegistry, EquipmentConfig, ItemConfig } from '@dongtian/config-schema';
import type {
  AssetRepository,
  DatabasePool,
  InventorySnapshot,
  PoolClient,
  JsonValue,
  SkillToolAssignmentRecord,
  SkillToolAssignmentRepository,
} from '@dongtian/database';
import {
  compareToolLoadouts,
  createToolLoadout,
  projectToolHourlyThroughput,
  resolveToolProfileFromItemId,
  microseconds,
  type ToolLoadout,
  type ToolTag,
} from '@dongtian/game-rules';

import { assetRepositoryToken } from '../asset/asset.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { databasePoolToken } from '../auth/auth.tokens.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { buildContentRouteIndexes } from '../content/content-metadata.js';
import { SettlementService } from '../settlement/settlement.service.js';
import { skillToolAssignmentRepositoryToken } from './skill-tool-assignments.tokens.js';

type JsonRecord = Record<string, unknown>;

type ParsedAssignment = {
  readonly skillId: string;
  readonly equipmentInstanceId: string | null;
};

type ParsedSaveRequest = {
  readonly expectedStateVersion: bigint;
  readonly assignments: readonly ParsedAssignment[];
};

type CharacterStateRow = {
  readonly state_version: string;
  readonly realm_stage_id: string;
};

type ToolOptionResponse = {
  readonly equipment_instance_id: string;
  readonly item_id: string;
  readonly item_name_key: string;
  readonly source_note: string;
  readonly required_realm: string;
  readonly required_tags: readonly string[];
  readonly tool_tag: ToolTag;
  readonly speed_multiplier: string;
  readonly efficiency_multiplier: string;
  readonly cycles_per_hour: string;
  readonly effective_throughput_per_hour: string;
  readonly source_routes: readonly JsonValue[];
  readonly usage_routes: readonly JsonValue[];
  readonly comparison: {
    readonly preferred_equipment_instance_id: string;
    readonly throughput_delta_per_hour: string;
    readonly cycles_delta_per_hour: string;
  } | null;
};

type SkillToolAssignmentView = {
  readonly skill_id: string;
  readonly current: ToolOptionResponse | null;
  readonly options: readonly ToolOptionResponse[];
};

type SkillToolAssignmentsResponse = {
  readonly character_id: string;
  readonly state_version: number;
  readonly config_version: string;
  readonly as_of: string;
  readonly effective_next_cycle?: boolean;
  readonly assignments: readonly SkillToolAssignmentView[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function badRequest(reason: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message_key: 'error.validation_error',
    details: { reason },
  });
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message_key: 'error.resource_not_found',
  });
}

function conflict(reason: string): ConflictException {
  return new ConflictException({
    code: 'STATE_VERSION_CONFLICT',
    message_key: 'error.validation_error',
    details: { reason },
  });
}

function requiredString(record: JsonRecord, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field}_REQUIRED`);
  }
  return value;
}

function optionalString(record: JsonRecord, field: string): string | null {
  const value = record[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field}_INVALID`);
  }
  return value;
}

function parseNonNegativeInteger(value: unknown, field: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }
  throw badRequest(`${field}_INVALID`);
}

function parseRequest(body: unknown): ParsedSaveRequest {
  if (!isRecord(body)) {
    throw badRequest('BODY_INVALID');
  }
  const assignments = body['assignments'];
  if (!Array.isArray(assignments)) {
    throw badRequest('assignments_REQUIRED');
  }
  return {
    expectedStateVersion: parseNonNegativeInteger(body['expected_state_version'], 'expected_state_version'),
    assignments: assignments.map((assignment, index) => {
      if (!isRecord(assignment)) {
        throw badRequest(`assignments.${index}_INVALID`);
      }
      return {
        skillId: requiredString(assignment, 'skill_id'),
        equipmentInstanceId: optionalString(assignment, 'equipment_instance_id'),
      };
    }),
  };
}

function stateVersionAsNumber(stateVersion: string): number {
  const parsed = Number(stateVersion);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('STATE_VERSION_OUT_OF_RANGE');
  }
  return parsed;
}

function toToolLoadout(itemId: string, equipment: EquipmentConfig): ToolLoadout {
  const profile = resolveToolProfileFromItemId(itemId);
  const effects = equipment.tool_effects ?? [];
  return createToolLoadout({
    itemId,
    toolTag: profile.toolTag,
    skillId: profile.skillId,
    speedModifiers: effects.map((effect) => ({
      stat: 'action_speed',
      operation: 'ADD' as const,
      value: effect.action_speed_bonus,
    })),
    efficiencyModifiers: effects.map((effect) => ({
      stat: 'action_efficiency',
      operation: 'ADD' as const,
      value: effect.action_efficiency_bonus,
    })),
  });
}

function toolTagFromItem(item: ItemConfig): ToolTag {
  return resolveToolProfileFromItemId(item.id).toolTag;
}

function buildToolOption(
  item: ItemConfig,
  equipment: EquipmentConfig,
  instanceId: string,
  compareAgainst: ToolLoadout | null | undefined,
  routeIndexes: ReturnType<typeof buildContentRouteIndexes>,
): ToolOptionResponse {
  const loadout = toToolLoadout(item.id, equipment);
  const projection = projectToolHourlyThroughput({
    requiredToolTag: toolTagFromItem(item),
    baseDurationUs: microseconds(60_000_000n),
    currentLoadout: loadout,
  });
  const comparison = compareAgainst === undefined
    ? null
    : compareToolLoadouts({
        requiredToolTag: toolTagFromItem(item),
        baseDurationUs: microseconds(60_000_000n),
        currentLoadout: compareAgainst,
        candidateLoadout: loadout,
      });
  return {
    equipment_instance_id: instanceId,
    item_id: item.id,
    item_name_key: item.name_key,
    source_note: item.source_note,
    required_realm: equipment.equip_requirements.required_realm ?? item.realm_required,
    required_tags: equipment.equip_requirements.required_tags,
    tool_tag: toolTagFromItem(item),
    speed_multiplier: loadout.speedMultiplier,
    efficiency_multiplier: loadout.efficiencyMultiplier,
    cycles_per_hour: projection.cyclesPerHour,
    effective_throughput_per_hour: projection.effectiveThroughputPerHour,
    source_routes: routeIndexes.sourceRoutesByItemId.get(item.id) ?? [],
    usage_routes: routeIndexes.usageRoutesByItemId.get(item.id) ?? [],
    comparison: comparison === null ? null : {
      preferred_equipment_instance_id: comparison.preferredItemId,
      throughput_delta_per_hour: comparison.throughputDeltaPerHour,
      cycles_delta_per_hour: comparison.cyclesDeltaPerHour,
    },
  };
}

function skillFromEquipment(equipment: EquipmentConfig): string | null {
  const effect = equipment.tool_effects?.[0];
  return effect?.skill_id ?? null;
}

@Injectable()
export class SkillToolAssignmentsService {
  public constructor(
    @Inject(SettlementService) private readonly settlementService: SettlementService,
    @Inject(assetRepositoryToken) private readonly assetRepository: AssetRepository,
    @Inject(skillToolAssignmentRepositoryToken) private readonly repository: SkillToolAssignmentRepository,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(databasePoolToken) private readonly pool: DatabasePool,
  ) {}

  public async getAssignments(
    request: FastifyRequest,
    characterId: string,
  ): Promise<SkillToolAssignmentsResponse> {
    const accountId = await this.authService.requireCurrentAccountId(request);
    const [state, inventory, assignments] = await Promise.all([
      this.loadCharacterState(characterId, accountId),
      this.assetRepository.getInventory(characterId, accountId),
      this.repository.getAssignments(characterId, accountId),
    ]);
    if (state === null || inventory === null) {
      throw notFound();
    }
    return this.toResponse(characterId, state, inventory, assignments, false);
  }

  public async saveAssignments(
    request: FastifyRequest,
    characterId: string,
    body: unknown,
  ): Promise<SkillToolAssignmentsResponse> {
    const parsed = parseRequest(body);
    const result = await this.settlementService.executeSettledWrite<SkillToolAssignmentsResponse>(request, characterId, {
      operationType: 'SKILL_TOOL_ASSIGNMENTS_SAVE',
      request: body,
      execute: async ({ client, settlement }) => {
        const accountId = await this.authService.requireWriteAccess(request);
        const state = await this.loadCharacterStateOnTransaction(client, characterId, accountId);
        if (state === null) {
          throw notFound();
        }
        if (state.state_version !== parsed.expectedStateVersion.toString()) {
          throw conflict('expected_state_version');
        }

        const inventory = await this.assetRepository.getInventoryOnTransaction(client, characterId, accountId);
        if (inventory === null) {
          throw notFound();
        }

        const validated = this.validateAssignments({
          state,
          inventory,
          assignments: parsed.assignments,
        });
        const updatedAssignments = await this.repository.replaceAssignments(client, {
          characterId,
          assignments: validated,
        });

        const transactionId = await this.createAuditTransaction(client, {
          characterId,
          referenceId: settlement.settlement_id,
          operationType: 'SKILL_TOOL_ASSIGNMENTS_SAVE',
        });
        const nextStateVersion = await this.bumpStateVersion(client, characterId, state.state_version);

        return {
          statusCode: 200,
          response: this.toResponse(
            characterId,
            { ...state, state_version: nextStateVersion },
            inventory,
            updatedAssignments,
            true,
          ),
          transactionId,
          outboxEvents: [{
            eventType: 'SKILL_TOOL_ASSIGNMENTS_UPDATED',
            aggregateType: 'CHARACTER',
            aggregateId: characterId,
            payload: {
              character_id: characterId,
              state_version: stateVersionAsNumber(nextStateVersion),
              effective_next_cycle: true,
              assignment_count: updatedAssignments.length,
            },
          }],
        };
      },
    });
    return result.response;
  }

  private validateAssignments(input: {
    readonly state: CharacterStateRow;
    readonly inventory: InventorySnapshot;
    readonly assignments: readonly ParsedAssignment[];
  }): readonly { readonly skillId: string; readonly equipmentInstanceId: string }[] {
    const realm = this.configRegistry.getRealm(input.state.realm_stage_id);
    const owned = new Map(input.inventory.equipmentInstances.map((instance) => [instance.instanceId, instance] as const));
    const seenSkills = new Set<string>();
    const seenInstances = new Set<string>();
    const validAssignments: Array<{ readonly skillId: string; readonly equipmentInstanceId: string }> = [];

    for (const assignment of input.assignments) {
      if (seenSkills.has(assignment.skillId)) {
        throw badRequest('skill_id_DUPLICATE');
      }
      seenSkills.add(assignment.skillId);
      if (assignment.equipmentInstanceId === null) {
        continue;
      }
      if (seenInstances.has(assignment.equipmentInstanceId)) {
        throw badRequest('equipment_instance_id_DUPLICATE');
      }
      seenInstances.add(assignment.equipmentInstanceId);
      const instance = owned.get(assignment.equipmentInstanceId);
      if (!instance) {
        throw notFound();
      }
      const item = this.configRegistry.getItem(instance.itemId);
      const equipment = this.configRegistry.getEquipment(instance.itemId);
      const matchedSkillId = skillFromEquipment(equipment);
      if (equipment.slot !== 'TOOL') {
        throw badRequest('skill_tool_assignment_SLOT_MISMATCH');
      }
      if (matchedSkillId !== assignment.skillId) {
        throw badRequest('skill_tool_assignment_SKILL_MISMATCH');
      }
      if (!item.tags.includes(toolTagFromItem(item))) {
        throw badRequest('skill_tool_assignment_TAG_MISMATCH');
      }
      if (this.configRegistry.getRealm(item.realm_required).stage_order > realm.stage_order) {
        throw badRequest('skill_tool_assignment_REALM_LOCKED');
      }
      if (equipment.equip_requirements.required_realm !== null
        && this.configRegistry.getRealm(equipment.equip_requirements.required_realm).stage_order > realm.stage_order) {
        throw badRequest('skill_tool_assignment_REALM_LOCKED');
      }
      if (equipment.equip_requirements.required_tags.some((tag) => !item.tags.includes(tag))) {
        throw badRequest('skill_tool_assignment_TAG_MISMATCH');
      }
      if (!equipment.tool_effects?.some((effect) => effect.skill_id === assignment.skillId)) {
        throw badRequest('skill_tool_assignment_SKILL_MISMATCH');
      }
      validAssignments.push({
        skillId: assignment.skillId,
        equipmentInstanceId: assignment.equipmentInstanceId,
      });
    }

    return validAssignments;
  }

  private async loadCharacterState(
    characterId: string,
    accountId: string,
  ): Promise<CharacterStateRow | null> {
    const result = await this.pool.query<CharacterStateRow>(
      `SELECT c.state_version::text AS state_version,
              c.realm_stage_id
         FROM characters c
        WHERE c.id = $1
          AND c.account_id = $2`,
      [characterId, accountId],
    );
    return result.rows[0] ?? null;
  }

  private async loadCharacterStateOnTransaction(
    client: PoolClient,
    characterId: string,
    accountId: string,
  ): Promise<CharacterStateRow | null> {
    const result = await client.query<CharacterStateRow>(
      `SELECT c.state_version::text AS state_version,
              c.realm_stage_id
         FROM characters c
        WHERE c.id = $1
          AND c.account_id = $2
        FOR UPDATE`,
      [characterId, accountId],
    );
    return result.rows[0] ?? null;
  }

  private async createAuditTransaction(
    client: PoolClient,
    input: {
      readonly characterId: string;
      readonly referenceId: string;
      readonly operationType: string;
    },
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO asset_transactions (
         character_id, operation_type, reason_code, reference_type, reference_id, config_version
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.characterId,
        input.operationType,
        input.operationType,
        'SKILL_TOOL_ASSIGNMENTS',
        input.referenceId,
        this.configRegistry.manifest.config_version,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('SKILL_TOOL_ASSIGNMENT_TRANSACTION_NOT_CREATED');
    }
    return row.id;
  }

  private async bumpStateVersion(client: PoolClient, characterId: string, stateVersion: string): Promise<string> {
    const result = await client.query<{ state_version: string }>(
      `UPDATE characters
          SET state_version = state_version + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND state_version::text = $2
        RETURNING state_version::text AS state_version`,
      [characterId, stateVersion],
    );
    const row = result.rows[0];
    if (!row) {
      throw conflict('state_version_changed');
    }
    return row.state_version;
  }

  private toResponse(
    characterId: string,
    state: CharacterStateRow,
    inventory: InventorySnapshot,
    assignments: readonly SkillToolAssignmentRecord[],
    effectiveNextCycle: boolean,
  ): SkillToolAssignmentsResponse {
    const routeIndexes = buildContentRouteIndexes(this.configRegistry);
    const assignedBySkill = new Map(assignments.map((assignment) => [assignment.skillId, assignment] as const));
    const supportedSkills = new Map<string, { readonly skillId: string; toolItems: { readonly item: ItemConfig; readonly equipment: EquipmentConfig }[] }>();

    for (const equipment of this.configRegistry.equipments) {
      const skillId = skillFromEquipment(equipment);
      if (skillId === null) {
        continue;
      }
      const item = this.configRegistry.getItem(equipment.item_id);
      const current = supportedSkills.get(skillId);
      if (current) {
        current.toolItems.push({ item, equipment });
      } else {
        supportedSkills.set(skillId, { skillId, toolItems: [{ item, equipment }] });
      }
    }

    const view: SkillToolAssignmentView[] = [];
    for (const [skillId, skill] of [...supportedSkills.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const currentAssignment = assignedBySkill.get(skillId) ?? null;
      const currentLoadout = currentAssignment === null
        ? null
        : toToolLoadout(currentAssignment.itemId, this.configRegistry.getEquipment(currentAssignment.itemId));
      const current = currentAssignment === null
        ? null
        : buildToolOption(
            this.configRegistry.getItem(currentAssignment.itemId),
            this.configRegistry.getEquipment(currentAssignment.itemId),
            currentAssignment.equipmentInstanceId,
            undefined,
            routeIndexes,
          );
      const options = skill.toolItems.flatMap(({ item, equipment }) => {
        return inventory.equipmentInstances
          .filter((instance) => instance.itemId === item.id && instance.instanceId !== currentAssignment?.equipmentInstanceId)
          .map((instance) => buildToolOption(item, equipment, instance.instanceId, currentLoadout, routeIndexes));
      });
      view.push({ skill_id: skillId, current, options });
    }

    return {
      character_id: characterId,
      state_version: stateVersionAsNumber(state.state_version),
      config_version: this.configRegistry.manifest.config_version,
      as_of: new Date().toISOString(),
      ...(effectiveNextCycle ? { effective_next_cycle: true } : {}),
      assignments: view,
    };
  }
}
