import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { AppModule } from './app.module.js';

export async function createOpenApiDocument(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  app.setGlobalPrefix('api/v1');

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('洞天 API')
      .setDescription('洞天服务端 REST API。')
      .setVersion('1.0.0')
      .build(),
  );

  document.openapi = '3.1.0';
  document.components = {
    ...(document.components ?? {}),
    schemas: {
      ...(document.components?.schemas ?? {}),
      ApiMeta: {
        type: 'object',
        required: ['request_id', 'server_time'],
        properties: {
          request_id: { type: 'string' },
          server_time: { type: 'string', format: 'date-time' },
          config_version: { type: 'string' },
          state_version: { type: 'integer' },
        },
      },
      SuccessEnvelope: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'object', additionalProperties: true },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        required: ['error', 'meta'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message_key', 'retryable'],
            properties: {
              code: { type: 'string' },
              message_key: { type: 'string' },
              retryable: { type: 'boolean' },
              details: { type: 'object', additionalProperties: true },
            },
          },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeManifest: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/Manifest' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeAuthAnonymous: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/AuthAnonymousSession' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeAuthSession: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/AuthSession' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeAuthLogout: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/AuthLogout' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeProgression: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/CharacterProgression' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeInventory: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/InventorySnapshot' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeBuffUse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/BuffUseResponse' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      DungeonOpportunityCharacter: {
        type: 'object',
        required: ['character_id', 'state_version', 'active_config_version'],
        properties: {
          character_id: { type: 'string', format: 'uuid' },
          state_version: { type: 'integer' },
          active_config_version: { type: 'string' },
        },
      },
      DungeonOpportunityDetails: {
        type: 'object',
        required: [
          'current_opportunities',
          'opportunity_cap',
          'recovery_anchor_at',
          'next_recovery_at',
          'recovery_interval_seconds',
          'is_capped',
        ],
        properties: {
          current_opportunities: { type: 'integer' },
          opportunity_cap: { type: 'integer' },
          recovery_anchor_at: { type: 'string', format: 'date-time' },
          next_recovery_at: { oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
          recovery_interval_seconds: { type: 'integer' },
          is_capped: { type: 'boolean' },
        },
      },
      DungeonTeachingGrantDetails: {
        type: 'object',
        required: ['source_tutorial_id', 'claimed_at', 'available', 'applied_quantity'],
        properties: {
          source_tutorial_id: { type: 'string' },
          claimed_at: { oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
          available: { type: 'boolean' },
          applied_quantity: { type: 'integer' },
        },
      },
      DungeonOpportunityResponse: {
        type: 'object',
        required: ['character', 'opportunity', 'teaching_grant', 'calculation_as_of', 'config_version'],
        properties: {
          character: { $ref: '#/components/schemas/DungeonOpportunityCharacter' },
          opportunity: { $ref: '#/components/schemas/DungeonOpportunityDetails' },
          teaching_grant: { $ref: '#/components/schemas/DungeonTeachingGrantDetails' },
          calculation_as_of: { type: 'string', format: 'date-time' },
          config_version: { type: 'string' },
        },
      },
      DungeonRunCreateRequest: {
        type: 'object',
        required: ['dungeon_id', 'loadout_preset_id', 'strategy_preset_id', 'initial_route_id', 'expected_state_version', 'config_version'],
        properties: {
          dungeon_id: { type: 'string' },
          loadout_preset_id: { type: 'string' },
          strategy_preset_id: { type: 'string' },
          initial_route_id: { type: 'string' },
          expected_state_version: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          config_version: { type: 'string' },
        },
      },
      DungeonRunDetails: {
        type: 'object',
        required: [
          'run_id',
          'dungeon_id',
          'status',
          'current_node_id',
          'phase',
          'outcome',
          'revision',
          'initial_route_id',
          'loadout_preset_id',
          'strategy_preset_id',
          'opportunity_cost',
          'config_version',
          'created_at',
          'choice_deadline_at',
          'selected_choice_id',
          'selected_route_id',
          'selected_route_risk',
          'selected_at',
          'combat_resolved_at',
          'finalized_at',
          'run_state',
        ],
        properties: {
          run_id: { type: 'string', format: 'uuid' },
          dungeon_id: { type: 'string' },
          status: { type: 'string' },
          current_node_id: { type: 'string' },
          phase: { type: 'string' },
          outcome: { type: 'string' },
          revision: { type: 'integer' },
          initial_route_id: { type: 'string' },
          loadout_preset_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          strategy_preset_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          opportunity_cost: { type: 'integer' },
          config_version: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          choice_deadline_at: { type: 'string', format: 'date-time' },
          selected_choice_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          selected_route_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          selected_route_risk: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          selected_at: { oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
          combat_resolved_at: { oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
          finalized_at: { oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
          run_state: { type: 'object', additionalProperties: true },
        },
      },
      DungeonPreviewRequest: {
        type: 'object',
        required: ['character_id', 'loadout_preset_id', 'strategy_preset_id', 'initial_route_id'],
        properties: {
          character_id: { type: 'string' },
          loadout_preset_id: { type: 'string' },
          strategy_preset_id: { type: 'string' },
          initial_route_id: { type: 'string' },
        },
      },
      DungeonChoiceRequest: {
        type: 'object',
        required: ['choice_id', 'expected_run_version'],
        properties: {
          choice_id: { type: 'string' },
          expected_run_version: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
        },
      },
      DungeonPreviewResponse: {
        type: 'object',
        required: ['character', 'dungeon', 'config_version', 'calculation_as_of'],
        properties: {
          character: { $ref: '#/components/schemas/DungeonOpportunityCharacter' },
          dungeon: {
            type: 'object',
            required: ['dungeon_id', 'recommended_power', 'base_success_rate', 'estimated_success_rate', 'choice_timeout_seconds', 'opportunity_cost', 'entry_items', 'choices', 'core_rewards'],
            properties: {
              dungeon_id: { type: 'string' },
              recommended_power: { type: 'string' },
              base_success_rate: { type: 'string' },
              estimated_success_rate: { type: 'string' },
              choice_timeout_seconds: { type: 'integer' },
              opportunity_cost: { type: 'integer' },
              entry_items: { type: 'array', items: { type: 'object', additionalProperties: true } },
              choices: { type: 'array', items: { type: 'object', additionalProperties: true } },
              core_rewards: { type: 'array', items: { type: 'string' } },
            },
          },
          config_version: { type: 'string' },
          calculation_as_of: { type: 'string', format: 'date-time' },
        },
      },
      DungeonRunResponse: {
        type: 'object',
        required: ['character', 'opportunity', 'teaching_grant', 'calculation_as_of', 'config_version', 'run'],
        properties: {
          character: { $ref: '#/components/schemas/DungeonOpportunityCharacter' },
          opportunity: { $ref: '#/components/schemas/DungeonOpportunityDetails' },
          teaching_grant: { $ref: '#/components/schemas/DungeonTeachingGrantDetails' },
          calculation_as_of: { type: 'string', format: 'date-time' },
          config_version: { type: 'string' },
          run: { $ref: '#/components/schemas/DungeonRunDetails' },
        },
      },
      SuccessEnvelopeDungeonOpportunity: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/DungeonOpportunityResponse' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeDungeonRun: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/DungeonRunResponse' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SettlementRewardItem: {
        type: 'object',
        required: ['item_id', 'quantity'],
        properties: {
          item_id: { type: 'string' },
          quantity: { type: 'string' },
        },
      },
      SettlementRewards: {
        type: 'object',
        required: ['cultivation_xp', 'skill_xp', 'items'],
        properties: {
          cultivation_xp: { type: 'string' },
          skill_xp: { type: 'string' },
          items: { type: 'array', items: { $ref: '#/components/schemas/SettlementRewardItem' } },
        },
      },
      SettlementTimelineEntry: {
        type: 'object',
        required: [
          'segment_index',
          'queue_entry_id',
          'action_config_id',
          'from_at',
          'to_at',
          'completed_cycles',
          'inputs',
          'outputs',
          'xp_changes',
          'transition_reason',
          'snapshot',
        ],
        properties: {
          segment_index: { type: 'integer' },
          queue_entry_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          action_config_id: { type: 'string' },
          from_at: { type: 'string', format: 'date-time' },
          to_at: { type: 'string', format: 'date-time' },
          completed_cycles: { type: 'string' },
          inputs: { type: 'object', additionalProperties: true },
          outputs: { type: 'object', additionalProperties: true },
          xp_changes: { type: 'object', additionalProperties: true },
          transition_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          snapshot: { type: 'object', additionalProperties: true },
        },
      },
      SettlementLedgerEntry: {
        type: 'object',
        required: [
          'entry_id',
          'transaction_id',
          'asset_type',
          'asset_id',
          'delta',
          'balance_after',
          'reason_code',
          'reference_type',
          'reference_id',
          'config_version',
          'created_at',
        ],
        properties: {
          entry_id: { type: 'string', format: 'uuid' },
          transaction_id: { type: 'string', format: 'uuid' },
          asset_type: { type: 'string' },
          asset_id: { type: 'string' },
          delta: { type: 'string' },
          balance_after: { type: 'string' },
          reason_code: { type: 'string' },
          reference_type: { type: 'string' },
          reference_id: { type: 'string' },
          config_version: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      LatestSettlementSummary: {
        type: 'object',
        required: [
          'settlement_id',
          'character_id',
          'as_of',
          'from_at',
          'requested_until',
          'effective_until',
          'effective_time_us',
          'capped_time_us',
          'continuation_required',
          'status',
          'summary',
          'rewards',
          'timeline',
          'ledger_entries',
        ],
        properties: {
          settlement_id: { type: 'string', format: 'uuid' },
          character_id: { type: 'string', format: 'uuid' },
          as_of: { type: 'string', format: 'date-time' },
          from_at: { type: 'string', format: 'date-time' },
          requested_until: { type: 'string', format: 'date-time' },
          effective_until: { type: 'string', format: 'date-time' },
          effective_time_us: { type: 'string' },
          capped_time_us: { type: 'string' },
          continuation_required: { type: 'boolean' },
          status: { type: 'string' },
          summary: { type: 'object', additionalProperties: true },
          rewards: { $ref: '#/components/schemas/SettlementRewards' },
          timeline: { type: 'array', items: { $ref: '#/components/schemas/SettlementTimelineEntry' } },
          ledger_entries: { type: 'array', items: { $ref: '#/components/schemas/SettlementLedgerEntry' } },
        },
      },
      LatestSettlementResponse: {
        type: 'object',
        required: ['settlement'],
        properties: {
          settlement: { oneOf: [{ $ref: '#/components/schemas/LatestSettlementSummary' }, { type: 'null' }] },
        },
      },
      SuccessEnvelopeSettlementSummary: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/LatestSettlementResponse' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      LoadoutPresetSaveRequest: {
        type: 'object',
        required: ['expected_state_version', 'name', 'strategy_id'],
        properties: {
          expected_state_version: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          name: { type: 'string' },
          weapon_instance_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          armor_instance_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          accessory_instance_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          combat_consumables: {
            type: 'array',
            items: {
              type: 'object',
              required: ['item_id', 'quantity'],
              properties: {
                item_id: { type: 'string' },
                quantity: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
              },
            },
          },
          strategy_id: { type: 'string' },
        },
      },
      LoadoutPreset: {
        type: 'object',
        required: [
          'character_id',
          'preset_id',
          'name',
          'active',
          'complete',
          'state_version',
          'weapon_instance_id',
          'armor_instance_id',
          'accessory_instance_id',
          'combat_consumables',
          'strategy_id',
          'version',
        ],
        properties: {
          character_id: { type: 'string', format: 'uuid' },
          preset_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          active: { type: 'boolean' },
          complete: { type: 'boolean' },
          effective_next_cycle: { type: 'boolean' },
          state_version: { type: 'integer' },
          weapon_instance_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          armor_instance_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          accessory_instance_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          combat_consumables: {
            type: 'array',
            items: {
              type: 'object',
              required: ['item_id', 'quantity'],
              properties: {
                item_id: { type: 'string' },
                quantity: { type: 'string' },
              },
            },
          },
          strategy_id: { type: 'string' },
          version: { type: 'string' },
        },
      },
      LoadoutPresetEnvelope: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/LoadoutPreset' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      AuthAnonymousSession: {
        type: 'object',
        required: ['account_id', 'character_id', 'account_type', 'csrf_token', 'session_expires_at'],
        properties: {
          account_id: { type: 'string', format: 'uuid' },
          character_id: { type: 'string', format: 'uuid' },
          account_type: { type: 'string', enum: ['ANONYMOUS', 'REGISTERED'] },
          csrf_token: { type: 'string' },
          session_expires_at: { type: 'string', format: 'date-time' },
        },
      },
      AuthSession: {
        oneOf: [
          {
            type: 'object',
            required: ['authenticated'],
            properties: { authenticated: { type: 'boolean', enum: [false] } },
          },
          {
            type: 'object',
            required: [
              'authenticated',
              'account_id',
              'character_id',
              'account_type',
              'account_status',
              'csrf_token',
              'session_expires_at',
            ],
            properties: {
              authenticated: { type: 'boolean', enum: [true] },
              account_id: { type: 'string', format: 'uuid' },
              character_id: { type: 'string', format: 'uuid' },
              account_type: { type: 'string', enum: ['ANONYMOUS', 'REGISTERED'] },
              account_status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'DELETED'] },
              csrf_token: { type: 'string' },
              session_expires_at: { type: 'string', format: 'date-time' },
            },
          },
        ],
      },
      AuthLogout: {
        type: 'object',
        required: ['logged_out'],
        properties: { logged_out: { type: 'boolean', enum: [true] } },
      },
      CharacterProgression: {
        type: 'object',
        required: [
          'character',
          'cultivation',
          'skills',
          'feature_permissions',
          'calculation_as_of',
          'config_version',
        ],
        properties: {
          character: {
            type: 'object',
            required: ['character_id', 'name', 'state_version', 'active_config_version'],
            properties: {
              character_id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              state_version: { type: 'integer' },
              active_config_version: { type: 'string' },
            },
          },
          cultivation: {
            type: 'object',
            required: [
              'xp',
              'realm_stage_id',
              'stage_start_xp',
              'stage_required_xp',
              'stage_progress_xp',
              'remaining_xp',
              'progress_ratio',
            ],
            properties: {
              xp: { type: 'string' },
              realm_stage_id: { type: 'string' },
              stage_start_xp: { type: 'string' },
              stage_required_xp: { type: 'string' },
              stage_progress_xp: { type: 'string' },
              remaining_xp: { type: 'string' },
              progress_ratio: { type: 'string' },
            },
          },
          skills: {
            type: 'array',
            items: { $ref: '#/components/schemas/SkillProgression' },
          },
          feature_permissions: {
            type: 'array',
            items: { $ref: '#/components/schemas/FeaturePermission' },
          },
          calculation_as_of: { type: 'string', format: 'date-time' },
          config_version: { type: 'string' },
        },
      },
      SkillProgression: {
        type: 'object',
        required: [
          'skill_id',
          'level',
          'xp',
          'xp_to_next',
          'remaining_xp',
          'next_level',
          'speed_modifier',
          'efficiency_modifier',
          'stage_node',
          'realm_required',
          'character_state_version',
        ],
        properties: {
          skill_id: { type: 'string' },
          level: { type: 'integer' },
          xp: { type: 'string' },
          xp_to_next: { type: 'string' },
          remaining_xp: { type: 'string' },
          next_level: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          speed_modifier: { type: 'string' },
          efficiency_modifier: { type: 'string' },
          stage_node: { type: 'boolean' },
          realm_required: { type: 'string' },
          character_state_version: { type: 'integer' },
        },
      },
      FeaturePermission: {
        type: 'object',
        required: ['feature_id', 'enabled', 'visible', 'usable', 'optimized_ui', 'locked_reason_key'],
        properties: {
          feature_id: { type: 'string' },
          enabled: { type: 'boolean' },
          visible: { type: 'boolean' },
          usable: { type: 'boolean' },
          optimized_ui: { type: 'boolean' },
          locked_reason_key: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      InventorySnapshot: {
        type: 'object',
        required: ['items', 'currencies', 'equipment_instances', 'total_count'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/InventoryAsset' } },
          currencies: { type: 'array', items: { $ref: '#/components/schemas/InventoryAsset' } },
          equipment_instances: { type: 'array', items: { $ref: '#/components/schemas/EquipmentInstance' } },
          total_count: { type: 'integer' },
        },
      },
      BuffUseRequest: {
        type: 'object',
        required: ['item_id', 'quantity', 'target_slot_index', 'expected_state_version'],
        properties: {
          item_id: { type: 'string' },
          quantity: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          target_slot_index: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          expected_state_version: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
        },
      },
      BuffUseResponse: {
        type: 'object',
        required: [
          'character_id',
          'item_id',
          'quantity',
          'target_slot_index',
          'buff_instance',
          'replaced_buff_instance_id',
          'effective_next_cycle',
          'state_version',
        ],
        properties: {
          character_id: { type: 'string', format: 'uuid' },
          item_id: { type: 'string' },
          quantity: { type: 'string' },
          target_slot_index: { type: 'integer' },
          buff_instance: {
            type: 'object',
            required: [
              'buff_instance_id',
              'buff_config_id',
              'source_item_id',
              'slot_index',
              'stack_group',
              'started_at',
              'expires_at',
            ],
            properties: {
              buff_instance_id: { type: 'string', format: 'uuid' },
              buff_config_id: { type: 'string' },
              source_item_id: { type: 'string' },
              slot_index: { type: 'integer' },
              stack_group: { type: 'string' },
              started_at: { type: 'string', format: 'date-time' },
              expires_at: { type: 'string', format: 'date-time' },
            },
          },
          replaced_buff_instance_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          effective_next_cycle: { type: 'boolean' },
          state_version: { type: 'integer' },
        },
      },
      SuccessEnvelopeQueue: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/Queue' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeQueuePreview: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/QueuePreview' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeQueueMutation: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/QueueMutation' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      QueuePlanRequest: {
        type: 'object',
        required: ['expected_queue_version', 'entries', 'fallback'],
        properties: {
          expected_queue_version: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string', pattern: '^(?:0|[1-9]\\d*)$' }] },
          entries: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              required: ['client_entry_id', 'action_id', 'mode', 'on_blocked'],
              properties: {
                client_entry_id: { type: 'string' },
                action_id: { type: 'string' },
                mode: { type: 'string', enum: ['COUNT', 'DURATION', 'UNTIL_INVENTORY', 'INFINITE'] },
                target_value: { oneOf: [{ type: 'number' }, { type: 'string' }] },
                condition_item_id: { type: 'string' },
                condition_operator: { type: 'string' },
                on_blocked: { type: 'string', enum: ['SKIP', 'FALLBACK'] },
              },
            },
          },
          fallback: {
            type: 'object',
            required: ['action_id', 'mode'],
            properties: {
              action_id: { type: 'string' },
              mode: { type: 'string', enum: ['INFINITE'] },
            },
          },
        },
      },
      QueueVersionRequest: {
        type: 'object',
        required: ['expected_queue_version'],
        properties: {
          expected_queue_version: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string', pattern: '^(?:0|[1-9]\\d*)$' }] },
        },
      },
      Queue: {
        type: 'object',
        required: ['queue_version', 'paused', 'pending_replace_after_cycle', 'fallback', 'current', 'entries', 'as_of'],
        properties: {
          queue_version: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          paused: { type: 'boolean' },
          pending_replace_after_cycle: { type: 'boolean' },
          fallback: { type: 'object', required: ['action_id', 'mode'], properties: { action_id: { type: 'string' }, mode: { type: 'string', enum: ['INFINITE'] } } },
          current: { oneOf: [{ $ref: '#/components/schemas/QueueEntry' }, { type: 'null' }] },
          entries: { type: 'array', items: { $ref: '#/components/schemas/QueueEntry' } },
          as_of: { type: 'string', format: 'date-time' },
        },
      },
      QueueEntry: {
        type: 'object',
        required: ['entry_id', 'position', 'action_id', 'mode', 'target_value', 'on_blocked', 'status', 'completed_cycles', 'progress_time_us'],
        properties: {
          entry_id: { type: 'string', format: 'uuid' },
          client_entry_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          position: { type: 'integer', minimum: 0 },
          action_id: { type: 'string' },
          mode: { type: 'string', enum: ['COUNT', 'DURATION', 'UNTIL_INVENTORY', 'INFINITE'] },
          target_value: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          condition_item_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          condition_operator: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          on_blocked: { type: 'string', enum: ['SKIP', 'FALLBACK'] },
          status: { type: 'string', enum: ['QUEUED', 'RUNNING', 'BLOCKED', 'DONE', 'DONE_INCOMPLETE', 'DONE_CONDITION_MET', 'CANCELLED'] },
          completed_cycles: { type: 'string' },
          progress_time_us: { type: 'string' },
          blocked_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          snapshot_config_version: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      QueuePreview: {
        type: 'object',
        required: ['queue_version', 'expected_queue_version', 'entries', 'fallback', 'total_duration_us', 'warnings', 'calculation_as_of', 'config_version'],
        properties: {
          queue_version: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          expected_queue_version: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          entries: { type: 'array', items: { type: 'object', additionalProperties: true } },
          fallback: { type: 'object', additionalProperties: true },
          total_duration_us: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          warnings: { type: 'array', items: { type: 'object', additionalProperties: true } },
          calculation_as_of: { type: 'string', format: 'date-time' },
          config_version: { type: 'string' },
        },
      },
      QueueMutation: {
        type: 'object',
        required: ['queue_version', 'effective_at', 'pending_replace_after_cycle', 'paused', 'queue'],
        properties: {
          queue_version: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          effective_at: { type: 'string' },
          pending_replace_after_cycle: { type: 'boolean' },
          paused: { type: 'boolean' },
          queue: { $ref: '#/components/schemas/Queue' },
        },
      },
      InventoryAsset: {
        type: 'object',
        required: [
          'asset_type',
          'asset_id',
          'quantity',
          'reserved_quantity',
          'available_quantity',
        ],
        properties: {
          asset_type: { type: 'string', enum: ['ITEM', 'CURRENCY'] },
          asset_id: { type: 'string' },
          category: { type: 'string' },
          quantity: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          reserved_quantity: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          available_quantity: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          source_routes: { type: 'array', items: { $ref: '#/components/schemas/ContentRoute' } },
          usage_routes: { type: 'array', items: { $ref: '#/components/schemas/ContentRoute' } },
        },
      },
      ContentRoute: {
        type: 'object',
        required: ['route_type', 'target_id', 'name_key', 'description_key', 'source_note'],
        properties: {
          route_type: { type: 'string', enum: ['ACTION', 'RECIPE'] },
          target_id: { type: 'string' },
          name_key: { type: 'string' },
          description_key: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          source_note: { type: 'string' },
        },
      },
      ContentUnlockState: {
        type: 'object',
        required: ['enabled', 'visible', 'usable', 'optimized_ui', 'reason_key', 'reason', 'blockers'],
        properties: {
          enabled: { type: 'boolean' },
          visible: { type: 'boolean' },
          usable: { type: 'boolean' },
          optimized_ui: { type: 'boolean' },
          reason_key: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          reason: { type: 'string' },
          blockers: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      ContentItemQuantity: {
        type: 'object',
        required: ['item_id', 'quantity', 'source_routes', 'usage_routes'],
        properties: {
          item_id: { type: 'string' },
          quantity: { type: 'string' },
          source_routes: { type: 'array', items: { $ref: '#/components/schemas/ContentRoute' } },
          usage_routes: { type: 'array', items: { $ref: '#/components/schemas/ContentRoute' } },
          available_quantity: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          reserved_quantity: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          quantity_owned: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          missing_quantity: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
      ContentCharacterSummary: {
        type: 'object',
        required: ['character_id', 'name', 'realm_stage_id'],
        properties: {
          character_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          realm_stage_id: { type: 'string' },
        },
      },
      ActionCatalogEntry: {
        type: 'object',
        required: [
          'action_id',
          'name_key',
          'description_key',
          'skill_id',
          'enabled',
          'unlocked',
          'unlock_state',
          'queue_action_id',
          'can_add_to_queue',
          'base_duration_us',
          'skill_xp',
          'cultivation_xp',
          'allowed_queue_modes',
          'required_tool_tag',
          'modifier_tags',
          'tags',
          'inputs',
          'outputs',
        ],
        properties: {
          action_id: { type: 'string' },
          name_key: { type: 'string' },
          description_key: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          skill_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          enabled: { type: 'boolean' },
          unlocked: { type: 'boolean' },
          unlock_state: { $ref: '#/components/schemas/ContentUnlockState' },
          queue_action_id: { type: 'string' },
          can_add_to_queue: { type: 'boolean' },
          base_duration_us: { type: 'string' },
          skill_xp: { type: 'string' },
          cultivation_xp: { type: 'string' },
          allowed_queue_modes: { type: 'array', items: { type: 'string' } },
          required_tool_tag: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          modifier_tags: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          inputs: { type: 'array', items: { $ref: '#/components/schemas/ContentItemQuantity' } },
          outputs: { type: 'array', items: { $ref: '#/components/schemas/ContentItemQuantity' } },
        },
      },
      RecipeCatalogEntry: {
        type: 'object',
        required: [
          'recipe_id',
          'action_id',
          'name_key',
          'description_key',
          'craft_skill_id',
          'result_item_id',
          'result_quantity',
          'required_level',
          'required_facility_id',
          'enabled',
          'unlocked',
          'unlock_state',
          'queue_action_id',
          'can_add_to_queue',
          'base_duration_us',
          'skill_xp',
          'tags',
          'ingredients',
          'result_item',
        ],
        properties: {
          recipe_id: { type: 'string' },
          action_id: { type: 'string' },
          name_key: { type: 'string' },
          description_key: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          craft_skill_id: { type: 'string' },
          result_item_id: { type: 'string' },
          result_quantity: { type: 'string' },
          required_level: { type: 'integer' },
          required_facility_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          enabled: { type: 'boolean' },
          unlocked: { type: 'boolean' },
          unlock_state: { $ref: '#/components/schemas/ContentUnlockState' },
          queue_action_id: { type: 'string' },
          can_add_to_queue: { type: 'boolean' },
          base_duration_us: { type: 'string' },
          skill_xp: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          ingredients: { type: 'array', items: { $ref: '#/components/schemas/ContentItemQuantity' } },
          result_item: { $ref: '#/components/schemas/ContentItemQuantity' },
        },
      },
      ContentActionsResponse: {
        type: 'object',
        required: ['character', 'actions', 'calculation_as_of', 'config_version'],
        properties: {
          character: { $ref: '#/components/schemas/ContentCharacterSummary' },
          actions: { type: 'array', items: { $ref: '#/components/schemas/ActionCatalogEntry' } },
          calculation_as_of: { type: 'string', format: 'date-time' },
          config_version: { type: 'string' },
        },
      },
      ContentRecipesResponse: {
        type: 'object',
        required: ['character', 'recipes', 'calculation_as_of', 'config_version'],
        properties: {
          character: { $ref: '#/components/schemas/ContentCharacterSummary' },
          recipes: { type: 'array', items: { $ref: '#/components/schemas/RecipeCatalogEntry' } },
          calculation_as_of: { type: 'string', format: 'date-time' },
          config_version: { type: 'string' },
        },
      },
      SuccessEnvelopeActions: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/ContentActionsResponse' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      SuccessEnvelopeRecipes: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/ContentRecipesResponse' },
          meta: { $ref: '#/components/schemas/ApiMeta' },
        },
      },
      EquipmentInstance: {
        type: 'object',
        required: ['instance_id', 'item_id', 'temper_level', 'bound', 'created_config_version'],
        properties: {
          instance_id: { type: 'string', format: 'uuid' },
          item_id: { type: 'string' },
          temper_level: { type: 'integer', minimum: 0 },
          bound: { type: 'boolean' },
          created_config_version: { type: 'string' },
        },
      },
      Manifest: {
        type: 'object',
        required: [
          'config_version',
          'schema_version',
          'formula_version',
          'created_at',
          'min_client_version',
          'content_hash',
          'previous_version',
        ],
        properties: {
          config_version: { type: 'string' },
          schema_version: { type: 'integer' },
          formula_version: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
          min_client_version: { type: 'string' },
          content_hash: { type: 'string' },
          previous_version: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
  };

  document.paths = {
    ...(document.paths ?? {}),
    '/api/v1/actions': {
      get: {
        tags: ['content'],
        summary: '读取当前角色可见行动与来源用途',
        responses: {
          200: {
            description: '当前角色可见行动列表。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessEnvelopeActions' },
              },
            },
          },
        },
      },
    },
    '/api/v1/recipes': {
      get: {
        tags: ['content'],
        summary: '读取当前角色可见配方与来源用途',
        responses: {
          200: {
            description: '当前角色可见配方列表。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessEnvelopeRecipes' },
              },
            },
          },
        },
      },
    },
    '/api/v1/characters/{character_id}/loadouts/{preset_id}': {
      get: {
        tags: ['characters'],
        summary: '读取装备预设',
        parameters: [
          { name: 'character_id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'preset_id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: '装备预设详情。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoadoutPresetEnvelope' },
              },
            },
          },
        },
      },
      put: {
        tags: ['characters'],
        summary: '保存装备预设',
        parameters: [
          { name: 'character_id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'preset_id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoadoutPresetSaveRequest' },
            },
          },
        },
        responses: {
          200: {
            description: '保存后的装备预设。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoadoutPresetEnvelope' },
              },
            },
          },
        },
      },
    },
    '/api/v1/characters/{character_id}/loadouts/{preset_id}/equip': {
      post: {
        tags: ['characters'],
        summary: '启用装备预设',
        parameters: [
          { name: 'character_id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'preset_id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: '启用后的装备预设。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoadoutPresetEnvelope' },
              },
            },
          },
        },
      },
    },
    '/api/v1/characters/{character_id}/dungeon-opportunities': {
      get: {
        tags: ['dungeon'],
        summary: '读取角色秘境机会',
        parameters: [{ name: 'character_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: '角色秘境机会信息。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonOpportunity' },
              },
            },
          },
        },
      },
    },
    '/api/v1/characters/{character_id}/dungeon-opportunities/teaching-grant': {
      post: {
        tags: ['dungeon'],
        summary: '领取教学赠送的秘境机会',
        parameters: [{ name: 'character_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: '教学赠送结果。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonOpportunity' },
              },
            },
          },
        },
      },
    },
    '/api/v1/characters/{character_id}/dungeon-runs': {
      post: {
        tags: ['dungeon'],
        summary: '创建秘境运行并消耗一次机会',
        parameters: [{ name: 'character_id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DungeonRunCreateRequest' },
            },
          },
        },
        responses: {
          201: {
            description: '秘境运行已创建。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' },
              },
            },
          },
        },
      },
    },
    '/api/v1/dungeons/{dungeon_id}/preview': {
      post: {
        tags: ['dungeon'],
        summary: '预览秘境运行',
        parameters: [{ name: 'dungeon_id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DungeonPreviewRequest' },
            },
          },
        },
        responses: {
          200: {
            description: '秘境预览结果。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DungeonPreviewResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/dungeon-runs/{run_id}': {
      get: {
        tags: ['dungeon'],
        summary: '读取秘境运行当前状态',
        parameters: [{ name: 'run_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: '秘境运行详情。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' },
              },
            },
          },
        },
      },
    },
    '/api/v1/dungeon-runs/{run_id}/choices': {
      post: {
        tags: ['dungeon'],
        summary: '选择秘境路线',
        parameters: [{ name: 'run_id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DungeonChoiceRequest' },
            },
          },
        },
        responses: {
          200: {
            description: '秘境运行已更新。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' },
              },
            },
          },
        },
      },
    },
    '/api/v1/dungeon-runs/{run_id}/finalize': {
      post: {
        tags: ['dungeon'],
        summary: '结算秘境运行',
        parameters: [{ name: 'run_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: '秘境运行已结算。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' },
              },
            },
          },
        },
      },
    },
    '/api/v1/characters/{character_id}/dungeon-runs/{run_id}': {
      get: {
        tags: ['dungeon'],
        summary: '读取秘境运行',
        parameters: [
          { name: 'character_id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'run_id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: '秘境运行详情。',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessEnvelopeDungeonRun' },
              },
            },
          },
        },
      },
    },
  };

  return document;
}
