import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './web-client.js';

describe('createApiClient', () => {
  it('sends credentials and csrf headers for mutating requests', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('include');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-csrf-token')).toBe('csrf-token');

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          return {
            data: { logged_out: true },
            meta: { request_id: 'req-1', server_time: '2026-08-16T00:00:00.000Z' },
          };
        },
        async text() {
          return '';
        },
      } as Response;
    });

    const client = createApiClient({ baseUrl: 'https://example.test', fetchImpl: fetchImpl as typeof fetch });
    client.setCsrfToken('csrf-token');

    await expect(client.logout()).resolves.toEqual({ logged_out: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads content catalogs and inventory route metadata', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          if (url.endsWith('/api/v1/actions')) {
            return {
              data: {
                character: { character_id: 'character-1', name: '洞天散修', realm_stage_id: 'realm.qi.early' },
                actions: [
                  {
                    action_id: 'action.cultivation.qi',
                    name_key: 'action.cultivation.qi.name',
                    description_key: null,
                    skill_id: 'skill.cultivation',
                    enabled: true,
                    unlocked: true,
                    unlock_state: {
                      enabled: true,
                      visible: true,
                      usable: true,
                      optimized_ui: true,
                      reason_key: null,
                      reason: '可用',
                      blockers: [],
                    },
                    queue_action_id: 'action.cultivation.qi',
                    can_add_to_queue: true,
                    base_duration_us: '60000000',
                    skill_xp: '5',
                    cultivation_xp: '4.5',
                    allowed_queue_modes: ['COUNT', 'INFINITE'],
                    required_tool_tag: null,
                    modifier_tags: [],
                    tags: [],
                    inputs: [],
                    outputs: [],
                  },
                ],
                calculation_as_of: '2026-08-16T00:00:00.000Z',
                config_version: '2026.08.16.1',
              },
              meta: { request_id: 'req-3', server_time: '2026-08-16T00:00:00.000Z' },
            };
          }

          if (url.endsWith('/api/v1/recipes')) {
            return {
              data: {
                character: { character_id: 'character-1', name: '洞天散修', realm_stage_id: 'realm.qi.early' },
                recipes: [
                  {
                    recipe_id: 'recipe.t1.qi_gathering_pill',
                    action_id: 'action.t1.qi_gathering_pill',
                    name_key: 'recipe.t1.qi_gathering_pill.name',
                    description_key: null,
                    craft_skill_id: 'skill.alchemy',
                    result_item_id: 'item.t1.qi_gathering_pill',
                    result_quantity: '1',
                    required_level: 1,
                    required_facility_id: null,
                    enabled: true,
                    unlocked: false,
                    unlock_state: {
                      enabled: true,
                      visible: true,
                      usable: false,
                      optimized_ui: false,
                      reason_key: 'content.locked.skill_level',
                      reason: '技能等级不足',
                      blockers: [],
                    },
                    queue_action_id: 'action.t1.qi_gathering_pill',
                    can_add_to_queue: false,
                    base_duration_us: '120000000',
                    skill_xp: '8',
                    tags: [],
                    ingredients: [],
                    result_item: {
                      item_id: 'item.t1.qi_gathering_pill',
                      quantity: '1',
                      source_routes: [],
                      usage_routes: [],
                    },
                  },
                ],
                calculation_as_of: '2026-08-16T00:00:00.000Z',
                config_version: '2026.08.16.1',
              },
              meta: { request_id: 'req-4', server_time: '2026-08-16T00:00:00.000Z' },
            };
          }

          if (url.endsWith('/api/v1/characters/character-1/skill-tool-assignments')) {
            return {
              data: {
                character_id: 'character-1',
                state_version: 8,
                config_version: '2026.08.16.1',
                as_of: '2026-08-16T00:00:00.000Z',
                assignments: [],
              },
              meta: { request_id: 'req-5', server_time: '2026-08-16T00:00:00.000Z' },
            };
          }

          return {
            data: {
              items: [
                {
                  asset_type: 'ITEM',
                  asset_id: 'item.t1.qingling_herb',
                  category: 'herb',
                  quantity: 5,
                  reserved_quantity: 2,
                  available_quantity: 3,
                  source_routes: [
                    {
                      route_type: 'ACTION',
                      target_id: 'action.t1.herb_baicao_valley',
                      name_key: 'action.t1.herb_baicao_valley.name',
                      description_key: null,
                      source_note: '采药',
                    },
                  ],
                  usage_routes: [
                    {
                      route_type: 'RECIPE',
                      target_id: 'recipe.t1.qi_gathering_pill',
                      name_key: 'recipe.t1.qi_gathering_pill.name',
                      description_key: null,
                      source_note: '炼丹',
                    },
                  ],
                },
              ],
              currencies: [],
              equipment_instances: [],
              total_count: 1,
            },
            meta: { request_id: 'req-6', server_time: '2026-08-16T00:00:00.000Z' },
          };
        },
        async text() {
          return '';
        },
      } as Response;
    });

    const client = createApiClient({ baseUrl: 'https://example.test', fetchImpl: fetchImpl as typeof fetch });

    await expect(client.getActions()).resolves.toMatchObject({
      actions: [{ action_id: 'action.cultivation.qi', unlocked: true }],
    });
    await expect(client.getRecipes()).resolves.toMatchObject({
      recipes: [{ recipe_id: 'recipe.t1.qi_gathering_pill', unlocked: false }],
    });
    await expect(client.getSkillToolAssignments('character-1')).resolves.toMatchObject({
      character_id: 'character-1',
      assignments: [],
    });
    await expect(client.getInventory('character-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          asset_id: 'item.t1.qingling_herb',
          source_routes: [expect.objectContaining({ route_type: 'ACTION' })],
          usage_routes: [expect.objectContaining({ route_type: 'RECIPE' })],
        }),
      ],
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('surfaces retryable network errors as api errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const client = createApiClient({ baseUrl: 'https://example.test', fetchImpl: fetchImpl as typeof fetch });

    await expect(client.getSession()).rejects.toMatchObject({
      name: 'ApiClientError',
      retryable: true,
      status: 0,
    });
  });

  it('adds idempotency keys to queue writes', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const url = String(_input);

      if (url.endsWith('/api/v1/characters/character-1/skill-tool-assignments')) {
        expect(headers.get('idempotency-key')).toBe('key-2');
        expect(headers.get('x-csrf-token')).toBe('csrf-token');
      } else {
        expect(headers.get('idempotency-key')).toBe('key-1');
        expect(headers.get('x-csrf-token')).toBe('csrf-token');
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          if (String(_input).endsWith('/api/v1/characters/character-1/skill-tool-assignments')) {
            expect(headers.get('idempotency-key')).toBe('key-2');
            expect(headers.get('x-csrf-token')).toBe('csrf-token');
            return {
              data: {
                character_id: 'character-1',
                state_version: 9,
                config_version: '2026.08.16.1',
                as_of: '2026-08-16T00:00:00.000Z',
                assignments: [],
              },
              meta: { request_id: 'req-2b', server_time: '2026-08-16T00:00:00.000Z' },
            };
          }

          return {
            data: {
              queue_version: '8',
              effective_at: '2026-08-16T00:00:00.000Z',
              pending_replace_after_cycle: false,
              paused: false,
              queue: {
                queue_version: '8',
                paused: false,
                pending_replace_after_cycle: false,
                fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
                current: null,
                entries: [],
                as_of: '2026-08-16T00:00:00.000Z',
              },
            },
            meta: { request_id: 'req-2', server_time: '2026-08-16T00:00:00.000Z' },
          };
        },
        async text() {
          return '';
        },
      } as Response;
    });

    const client = createApiClient({ baseUrl: 'https://example.test', fetchImpl: fetchImpl as typeof fetch });
    client.setCsrfToken('csrf-token');

    await expect(
      client.saveQueue(
        'character-1',
        {
          expected_queue_version: '7',
          entries: [
            {
              client_entry_id: 'tmp-1',
              action_id: 'action.cultivation.qi',
              mode: 'INFINITE',
              on_blocked: 'FALLBACK',
            },
          ],
          fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
        },
        'key-1',
      ),
    ).resolves.toMatchObject({
      queue_version: '8',
    });

    await expect(
      client.saveSkillToolAssignments(
        'character-1',
        {
          expected_state_version: 8,
          assignments: [],
        },
        'key-2',
      ),
    ).resolves.toMatchObject({
      state_version: 9,
    });
  });

  it('reads and writes cave builds with the real wire contract', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);

      if (url.endsWith('/api/v1/characters/character-1/cave/builds')) {
        expect(headers.get('idempotency-key')).toBe('cave-key-1');
        expect(headers.get('x-csrf-token')).toBe('csrf-token');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          facility_id: 'cave_facility.juling_room',
          target_level: 2,
          expected_state_version: 12,
          config_version: '2026.08.16.1',
        });
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          return {
            data: {
              character: {
                character_id: 'character-1',
                state_version: 13,
                active_config_version: '2026.08.16.1',
              },
              cave: {
                as_of: '2026-08-16T00:00:00.000Z',
                config_version: '2026.08.16.1',
                facilities: [
                  {
                    facility_config_id: 'cave_facility.juling_room',
                    facility_kind: 'JULING_ROOM',
                    name_key: 'cave.facility.juling_room.name',
                    description_key: 'cave.facility.juling_room.description',
                    level: 1,
                    current_modifier: null,
                    next_level_rule: {
                      level: 2,
                      required_realm_group: 'QI',
                      spirit_stone_cost: '200',
                      material_costs: [{ itemId: 'item.t1.cave_stone', quantity: '3' }],
                      build_duration_us: '3600000000',
                      modifier: { stat: 'cultivation_xp', operation: 'MULTIPLY', value: '1.05' },
                      scope: 'MVP',
                    },
                    build_task: {
                      build_task_id: 'task-1',
                      facility_config_id: 'cave_facility.juling_room',
                      from_level: 1,
                      target_level: 2,
                      started_at: '2026-08-16T00:00:00.000Z',
                      projected_completion_at: '2026-08-16T01:00:00.000Z',
                      completed_at: null,
                      status: 'RUNNING',
                      cost_snapshot: {
                        facility_config_id: 'cave_facility.juling_room',
                        facility_kind: 'JULING_ROOM',
                        name_key: 'cave.facility.juling_room.name',
                        description_key: 'cave.facility.juling_room.description',
                        level: 2,
                        required_realm_group: 'QI',
                        spirit_stone_cost: '200',
                        material_costs: [{ itemId: 'item.t1.cave_stone', quantity: '3' }],
                        build_duration_us: '3600000000',
                        modifier: { stat: 'cultivation_xp', operation: 'MULTIPLY', value: '1.05' },
                        scope: 'MVP',
                      },
                      completion_reached: false,
                      completion_boundary: { currentCycleApplies: true, nextCycleApplies: false },
                    },
                  },
                ],
              },
            },
            meta: { request_id: 'req-cave', server_time: '2026-08-16T00:00:00.000Z' },
          };
        },
        async text() {
          return '';
        },
      } as Response;
    });

    const client = createApiClient({ baseUrl: 'https://example.test', fetchImpl: fetchImpl as typeof fetch });
    client.setCsrfToken('csrf-token');

    await expect(client.getCave('character-1')).resolves.toMatchObject({
      character: { character_id: 'character-1', state_version: 13 },
      cave: { facilities: [expect.objectContaining({ facility_config_id: 'cave_facility.juling_room' })] },
    });

    await expect(
      client.buildCaveFacility(
        'character-1',
        {
          facility_id: 'cave_facility.juling_room',
          target_level: 2,
          expected_state_version: 12,
          config_version: '2026.08.16.1',
        },
        'cave-key-1',
      ),
    ).resolves.toMatchObject({
      character: { state_version: 13 },
      cave: { as_of: '2026-08-16T00:00:00.000Z' },
    });
  });

  it('reads and writes loadout presets with idempotency and csrf headers', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const url = String(_input);

      if (init?.method === 'GET') {
        expect(url).toContain('/api/v1/characters/character-1/loadouts/preset-1');
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          async json() {
            return {
              data: {
                character_id: 'character-1',
                preset_id: 'preset-1',
                name: '均衡',
                active: false,
                complete: false,
                state_version: 7,
                weapon_instance_id: 'weapon-1',
                armor_instance_id: null,
                accessory_instance_id: null,
                combat_consumables: [{ item_id: 'item.t1.qi', quantity: '2' }],
                strategy_id: 'strategy.safe',
                version: '1',
              },
              meta: { request_id: 'req-7', server_time: '2026-08-16T00:00:00.000Z' },
            };
          },
          async text() {
            return '';
          },
        } as Response;
      }

      expect(headers.get('idempotency-key')).toBe('key-2');
      expect(headers.get('x-csrf-token')).toBe('csrf-token');
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          return {
            data: {
              character_id: 'character-1',
              preset_id: 'preset-1',
              name: '均衡',
              active: true,
              complete: true,
              effective_next_cycle: true,
              state_version: 8,
              weapon_instance_id: 'weapon-1',
              armor_instance_id: 'armor-1',
              accessory_instance_id: 'accessory-1',
              combat_consumables: [],
              strategy_id: 'strategy.safe',
              version: '2',
            },
            meta: { request_id: 'req-8', server_time: '2026-08-16T00:00:00.000Z' },
          };
        },
        async text() {
          return '';
        },
      } as Response;
    });

    const client = createApiClient({ baseUrl: 'https://example.test', fetchImpl: fetchImpl as typeof fetch });
    client.setCsrfToken('csrf-token');

    await expect(client.getLoadoutPreset('character-1', 'preset-1')).resolves.toMatchObject({
      preset_id: 'preset-1',
      combat_consumables: [{ item_id: 'item.t1.qi' }],
    });

    await expect(
      client.saveLoadoutPreset(
        'character-1',
        'preset-1',
        {
          expected_state_version: 7,
          name: '均衡',
          weapon_instance_id: 'weapon-1',
          armor_instance_id: 'armor-1',
          accessory_instance_id: 'accessory-1',
          combat_consumables: [],
          strategy_id: 'strategy.safe',
        },
        'key-2',
      ),
    ).resolves.toMatchObject({
      active: true,
      effective_next_cycle: true,
      state_version: 8,
    });
  });

  it('supports dungeon opportunities and lifecycle writes', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);

      if (url.endsWith('/api/v1/characters/character-1/dungeon-opportunities')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          async json() {
            return {
              data: {
                character: { character_id: 'character-1', state_version: 42, active_config_version: '2026.08.16.1' },
                opportunity: {
                  current_opportunities: 5,
                  opportunity_cap: 6,
                  recovery_anchor_at: '2026-08-16T00:00:00.000Z',
                  next_recovery_at: '2026-08-16T12:00:00.000Z',
                  recovery_interval_seconds: 43_200,
                  is_capped: false,
                },
                teaching_grant: {
                  source_tutorial_id: 'TUT-007',
                  claimed_at: null,
                  available: true,
                  applied_quantity: 1,
                },
                calculation_as_of: '2026-08-16T00:00:00.000Z',
                config_version: '2026.08.16.1',
              },
              meta: { request_id: 'req-dungeon-1', server_time: '2026-08-16T00:00:00.000Z' },
            };
          },
          async text() {
            return '';
          },
        } as Response;
      }

      if (url.includes('/api/v1/dungeons/dungeon.t1.qingshe_cave/preview')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          async json() {
            return {
              data: {
                character: { character_id: 'character-1', state_version: 42, active_config_version: '2026.08.16.1' },
                dungeon: {
                  dungeon_id: 'dungeon.t1.qingshe_cave',
                  recommended_power: '80',
                  base_success_rate: '0.9',
                  estimated_success_rate: '0.9',
                  choice_timeout_seconds: 60,
                  opportunity_cost: 1,
                  entry_items: [],
                  choices: [],
                  core_rewards: ['item.t2.lingsui'],
                },
                config_version: '2026.08.16.1',
                calculation_as_of: '2026-08-16T00:00:00.000Z',
              },
              meta: { request_id: 'req-dungeon-2', server_time: '2026-08-16T00:00:00.000Z' },
            };
          },
          async text() {
            return '';
          },
        } as Response;
      }

      if (headers.get('idempotency-key') !== null && url.endsWith('/api/v1/characters/character-1/dungeon-runs')) {
        expect(headers.get('x-csrf-token')).toBe('csrf-token');
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          async json() {
            return {
              data: {
                character: { character_id: 'character-1', state_version: 43, active_config_version: '2026.08.16.1' },
                opportunity: {
                  current_opportunities: 4,
                  opportunity_cap: 6,
                  recovery_anchor_at: '2026-08-16T00:00:00.000Z',
                  next_recovery_at: '2026-08-16T12:00:00.000Z',
                  recovery_interval_seconds: 43_200,
                  is_capped: false,
                },
                teaching_grant: {
                  source_tutorial_id: 'TUT-007',
                  claimed_at: '2026-08-16T00:00:00.000Z',
                  available: false,
                  applied_quantity: 1,
                },
                calculation_as_of: '2026-08-16T00:00:00.000Z',
                config_version: '2026.08.16.1',
                run: {
                  run_id: 'run-1',
                  dungeon_id: 'dungeon.t1.qingshe_cave',
                  status: 'ENTERED',
                  current_node_id: 'node.t1.qingshe_cave.choice',
                  phase: 'ENTERED',
                  outcome: 'PENDING',
                  revision: 0,
                  initial_route_id: 'route.t1.qingshe_cave.safe_exit',
                  loadout_preset_id: 'preset-1',
                  strategy_preset_id: 'strategy.safe',
                  opportunity_cost: 1,
                  config_version: '2026.08.16.1',
                  created_at: '2026-08-16T00:00:00.000Z',
                  choice_deadline_at: '2026-08-16T00:01:00.000Z',
                  selected_choice_id: null,
                  selected_route_id: null,
                  selected_route_risk: null,
                  selected_at: null,
                  combat_resolved_at: null,
                  finalized_at: null,
                  run_state: {},
                },
              },
              meta: { request_id: 'req-dungeon-3', server_time: '2026-08-16T00:00:00.000Z' },
            };
          },
          async text() {
            return '';
          },
        } as Response;
      }

      if (headers.get('idempotency-key') !== null && url.endsWith('/api/v1/dungeon-runs/run-1/choices')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          async json() {
            return {
              data: {
                character: { character_id: 'character-1', state_version: 43, active_config_version: '2026.08.16.1' },
                opportunity: {
                  current_opportunities: 4,
                  opportunity_cap: 6,
                  recovery_anchor_at: '2026-08-16T00:00:00.000Z',
                  next_recovery_at: '2026-08-16T12:00:00.000Z',
                  recovery_interval_seconds: 43_200,
                  is_capped: false,
                },
                teaching_grant: {
                  source_tutorial_id: 'TUT-007',
                  claimed_at: '2026-08-16T00:00:00.000Z',
                  available: false,
                  applied_quantity: 1,
                },
                calculation_as_of: '2026-08-16T00:00:00.000Z',
                config_version: '2026.08.16.1',
                run: {
                  run_id: 'run-1',
                  dungeon_id: 'dungeon.t1.qingshe_cave',
                  status: 'REWARD_CANDIDATE',
                  current_node_id: 'node.t1.qingshe_cave.reward',
                  phase: 'REWARD_CANDIDATE',
                  outcome: 'SUCCESS',
                  revision: 1,
                  initial_route_id: 'route.t1.qingshe_cave.safe_exit',
                  loadout_preset_id: 'preset-1',
                  strategy_preset_id: 'strategy.safe',
                  opportunity_cost: 1,
                  config_version: '2026.08.16.1',
                  created_at: '2026-08-16T00:00:00.000Z',
                  choice_deadline_at: '2026-08-16T00:01:00.000Z',
                  selected_choice_id: 'choice.t1.qingshe_cave.safe_exit',
                  selected_route_id: 'route.t1.qingshe_cave.safe_exit',
                  selected_route_risk: 'SAFE',
                  selected_at: '2026-08-16T00:00:10.000Z',
                  combat_resolved_at: '2026-08-16T00:00:11.000Z',
                  finalized_at: null,
                  run_state: {},
                },
              },
              meta: { request_id: 'req-dungeon-4', server_time: '2026-08-16T00:00:00.000Z' },
            };
          },
          async text() {
            return '';
          },
        } as Response;
      }

      if (headers.get('idempotency-key') !== null && url.endsWith('/api/v1/dungeon-runs/run-1/finalize')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          async json() {
            return {
              data: {
                character: { character_id: 'character-1', state_version: 44, active_config_version: '2026.08.16.1' },
                opportunity: {
                  current_opportunities: 4,
                  opportunity_cap: 6,
                  recovery_anchor_at: '2026-08-16T00:00:00.000Z',
                  next_recovery_at: '2026-08-16T12:00:00.000Z',
                  recovery_interval_seconds: 43_200,
                  is_capped: false,
                },
                teaching_grant: {
                  source_tutorial_id: 'TUT-007',
                  claimed_at: '2026-08-16T00:00:00.000Z',
                  available: false,
                  applied_quantity: 1,
                },
                calculation_as_of: '2026-08-16T00:00:00.000Z',
                config_version: '2026.08.16.1',
                run: {
                  run_id: 'run-1',
                  dungeon_id: 'dungeon.t1.qingshe_cave',
                  status: 'FINALIZED',
                  current_node_id: 'node.t1.qingshe_cave.reward',
                  phase: 'FINALIZED',
                  outcome: 'SUCCESS',
                  revision: 2,
                  initial_route_id: 'route.t1.qingshe_cave.safe_exit',
                  loadout_preset_id: 'preset-1',
                  strategy_preset_id: 'strategy.safe',
                  opportunity_cost: 1,
                  config_version: '2026.08.16.1',
                  created_at: '2026-08-16T00:00:00.000Z',
                  choice_deadline_at: '2026-08-16T00:01:00.000Z',
                  selected_choice_id: 'choice.t1.qingshe_cave.safe_exit',
                  selected_route_id: 'route.t1.qingshe_cave.safe_exit',
                  selected_route_risk: 'SAFE',
                  selected_at: '2026-08-16T00:00:10.000Z',
                  combat_resolved_at: '2026-08-16T00:00:11.000Z',
                  finalized_at: '2026-08-16T00:00:12.000Z',
                  run_state: {},
                },
              },
              meta: { request_id: 'req-dungeon-5', server_time: '2026-08-16T00:00:00.000Z' },
            };
          },
          async text() {
            return '';
          },
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          return {
            data: {
              character: { character_id: 'character-1', state_version: 42, active_config_version: '2026.08.16.1' },
              opportunity: {
                current_opportunities: 5,
                opportunity_cap: 6,
                recovery_anchor_at: '2026-08-16T00:00:00.000Z',
                next_recovery_at: '2026-08-16T12:00:00.000Z',
                recovery_interval_seconds: 43_200,
                is_capped: false,
              },
              teaching_grant: {
                source_tutorial_id: 'TUT-007',
                claimed_at: null,
                available: true,
                applied_quantity: 1,
              },
              calculation_as_of: '2026-08-16T00:00:00.000Z',
              config_version: '2026.08.16.1',
              run: {
                run_id: 'run-1',
                dungeon_id: 'dungeon.t1.qingshe_cave',
                status: 'FINALIZED',
                current_node_id: 'node.t1.qingshe_cave.reward',
                phase: 'FINALIZED',
                outcome: 'SUCCESS',
                revision: 2,
                initial_route_id: 'route.t1.qingshe_cave.safe_exit',
                loadout_preset_id: 'preset-1',
                strategy_preset_id: 'strategy.safe',
                opportunity_cost: 1,
                config_version: '2026.08.16.1',
                created_at: '2026-08-16T00:00:00.000Z',
                choice_deadline_at: '2026-08-16T00:01:00.000Z',
                selected_choice_id: 'choice.t1.qingshe_cave.safe_exit',
                selected_route_id: 'route.t1.qingshe_cave.safe_exit',
                selected_route_risk: 'SAFE',
                selected_at: '2026-08-16T00:00:10.000Z',
                combat_resolved_at: '2026-08-16T00:00:11.000Z',
                finalized_at: '2026-08-16T00:00:12.000Z',
                run_state: {},
              },
            },
            meta: { request_id: 'req-dungeon-6', server_time: '2026-08-16T00:00:00.000Z' },
          };
        },
        async text() {
          return '';
        },
      } as Response;
    });

    const client = createApiClient({ baseUrl: 'https://example.test', fetchImpl: fetchImpl as typeof fetch });
    client.setCsrfToken('csrf-token');

    await expect(client.getDungeonOpportunities('character-1')).resolves.toMatchObject({ opportunity: { current_opportunities: 5 } });
    await expect(
      client.previewDungeon('dungeon.t1.qingshe_cave', {
        character_id: 'character-1',
        loadout_preset_id: 'preset-1',
        strategy_preset_id: 'strategy.safe',
        initial_route_id: 'route.t1.qingshe_cave.safe_exit',
      }),
    ).resolves.toMatchObject({ dungeon: { dungeon_id: 'dungeon.t1.qingshe_cave' } });
    await expect(
      client.enterDungeonRun(
        'character-1',
        {
          dungeon_id: 'dungeon.t1.qingshe_cave',
          loadout_preset_id: 'preset-1',
          strategy_preset_id: 'strategy.safe',
          initial_route_id: 'route.t1.qingshe_cave.safe_exit',
          expected_state_version: 42,
          config_version: '2026.08.16.1',
        },
        'key-enter',
      ),
    ).resolves.toMatchObject({ run: { run_id: 'run-1', phase: 'ENTERED' } });
    await expect(client.chooseDungeonRun('run-1', { choice_id: 'choice.t1.qingshe_cave.safe_exit', expected_run_version: 0 }, 'key-choice')).resolves.toMatchObject({
      run: { phase: 'REWARD_CANDIDATE' },
    });
    await expect(client.finalizeDungeonRun('run-1', 'key-finalize')).resolves.toMatchObject({
      run: { phase: 'FINALIZED', outcome: 'SUCCESS' },
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('sends tempering attempts with idempotency and returns audit metadata', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe('https://example.test/api/v1/characters/character-1/equipment/equipment-1/temper');
      const headers = new Headers(init?.headers);
      expect(headers.get('idempotency-key')).toBe('attempt-1');
      expect(headers.get('x-csrf-token')).toBe('csrf-token');

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          return {
            data: {
              character_id: 'character-1',
              equipment_instance_id: 'equipment-1',
              attempt_id: 'attempt-1',
              from_level: 5,
              target_level: 6,
              level_before: 5,
              level_after: 6,
              status: 'APPLIED',
              outcome: 'SUCCESS',
              success: true,
              success_probability: '0.34',
              attribute_increase: '0.065',
              random_audit: {
                namespace: 'equipment.tempering',
                attempt_key: 'attempt-1',
                seed_hex: '0123456789abcdef0123456789abcdef',
                roll: '0.12',
                success_probability: '0.34',
                formula_version: 1,
              },
              cost_snapshot: {
                tempering_stone_cost: '3',
                spirit_stone_cost: '283.97139999999996',
                same_equipment_cost: '100',
                protection_material_cost_requested: '0',
                protection_material_cost_spent: '0',
              },
              equipment: {
                instance_id: 'equipment-1',
                item_id: 'item.t1.cuizhi_jian',
                temper_level: 6,
                bound: false,
                created_config_version: '2026.08.16.1',
              },
              asset_transaction_id: 'tx-1',
              temper_audit_id: 'audit-1',
              state_version: 9,
              config_version: '2026.08.16.1',
            },
            meta: { request_id: 'req-7', server_time: '2026-08-16T00:00:00.000Z' },
          };
        },
        async text() {
          return '';
        },
      } as Response;
    });

    const client = createApiClient({ baseUrl: 'https://example.test', fetchImpl: fetchImpl as typeof fetch });
    client.setCsrfToken('csrf-token');

    await expect(
      client.temperEquipment(
        'character-1',
        'equipment-1',
        {
          attempt_id: 'attempt-1',
          expected_state_version: 8,
          target_level: 6,
          use_protection_material: false,
          config_version: '2026.08.16.1',
        },
        'attempt-1',
      ),
    ).resolves.toMatchObject({
      attempt_id: 'attempt-1',
      temper_audit_id: 'audit-1',
      asset_transaction_id: 'tx-1',
      random_audit: { namespace: 'equipment.tempering' },
    });
  });

  it('reads the latest settlement summary without triggering settlement', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/api/v1/characters/character-1/settlements/latest');
      expect(init?.method).toBe('GET');

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        async json() {
          return {
            data: {
              settlement: {
                settlement_id: 'settlement-1',
                character_id: 'character-1',
                as_of: '2026-08-16T02:00:06.000Z',
                from_at: '2026-08-16T00:00:00.000Z',
                requested_until: '2026-08-16T02:30:00.000Z',
                effective_until: '2026-08-16T02:00:00.000Z',
                effective_time_us: '7200000',
                capped_time_us: '1800000',
                continuation_required: false,
                status: 'COMPLETED',
                summary: { status: 'COMPLETED' },
                rewards: {
                  cultivation_xp: '2.5',
                  skill_xp: '1.0',
                  items: [{ item_id: 'item.t1.qingling_herb', quantity: '4' }],
                },
                timeline: [
                  {
                    segment_index: 0,
                    queue_entry_id: 'entry-1',
                    action_config_id: 'action.t1.herb_baicao_valley',
                    from_at: '2026-08-16T00:00:00.000Z',
                    to_at: '2026-08-16T01:00:00.000Z',
                    completed_cycles: '60',
                    inputs: [],
                    outputs: [],
                    xp_changes: [],
                    transition_reason: 'ACTION_SWITCH',
                    snapshot: {},
                  },
                ],
                ledger_entries: [
                  {
                    entry_id: 'ledger-1',
                    transaction_id: 'txn-1',
                    asset_type: 'ITEM',
                    asset_id: 'item.t1.qingling_herb',
                    delta: '-4',
                    balance_after: '12',
                    reason_code: 'settlement.consume',
                    reference_type: 'SETTLEMENT',
                    reference_id: 'settlement-1',
                    config_version: '2026.08.16.1',
                    created_at: '2026-08-16T02:00:06.000Z',
                  },
                ],
              },
            },
            meta: { request_id: 'req-6', server_time: '2026-08-16T00:00:00.000Z' },
          };
        },
        async text() {
          return '';
        },
      } as Response;
    });

    const client = createApiClient({ baseUrl: 'https://example.test', fetchImpl: fetchImpl as typeof fetch });

    await expect(client.getLatestSettlement('character-1')).resolves.toMatchObject({
      settlement: {
        settlement_id: 'settlement-1',
        continuation_required: false,
        rewards: { cultivation_xp: '2.5' },
        timeline: [{ segment_index: 0 }],
      },
    });
  });
});
