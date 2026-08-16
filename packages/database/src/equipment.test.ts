import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './index.js';
import { createEquipmentRepository } from './equipment.js';

function poolForResponses(
  responses: readonly (readonly Record<string, unknown>[] | undefined)[],
): DatabasePool & { readonly queries: string[] } {
  const queries: string[] = [];
  let responseIndex = 0;
  const client = {
    async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
      queries.push(sql);
      const rows = responses[responseIndex++] ?? [];
      return { rows: rows as T[] };
    },
    release: vi.fn(),
  } as unknown as PoolClient;
  return {
    queries,
    connect: vi.fn(async () => client),
  } as unknown as DatabasePool & { readonly queries: string[] };
}

describe('equipment repository', () => {
  it('reads a character-owned preset with its active flag', async () => {
    const pool = {
      async query<T>(): Promise<{ readonly rows: T[] }> {
        return {
          rows: [{
            id: 'preset-1',
            character_id: 'character-1',
            name: '默认',
            weapon_instance_id: 'weapon-1',
            armor_instance_id: 'armor-1',
            accessory_instance_id: 'accessory-1',
            combat_consumables: [],
            strategy_id: 'strategy.safe',
            version: '2',
            created_at: new Date('2026-08-16T00:00:00.000Z'),
            updated_at: new Date('2026-08-16T00:00:00.000Z'),
            active: true,
          }] as T[],
        };
      },
    } as unknown as DatabasePool;

    await expect(createEquipmentRepository(pool).getLoadoutPreset('character-1', 'account-1', 'preset-1'))
      .resolves.toMatchObject({
        presetId: 'preset-1',
        characterId: 'character-1',
        active: true,
        version: 2n,
      });
  });

  it('rejects saving a preset that belongs to another character', async () => {
    const pool = poolForResponses([
      [{ id: 'character-1' }],
      [{ continuation_required: false }],
      [{ character_id: 'character-2' }],
    ]);
    const client = (await (pool as unknown as { connect: () => Promise<PoolClient> }).connect());

    await expect(createEquipmentRepository(pool).saveLoadoutPreset(client, {
      characterId: 'character-1',
      presetId: 'preset-1',
      name: '默认',
      weaponInstanceId: null,
      armorInstanceId: null,
      accessoryInstanceId: null,
      combatConsumables: [],
      strategyId: 'strategy.safe',
    })).rejects.toThrow('EQUIPMENT_PRESET_FORBIDDEN');
  });

  it('activates an owned preset in the caller transaction', async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string): Promise<{ readonly rows: T[] }> {
        queries.push(sql);
        if (sql.includes('FROM characters') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 'character-1' }] as T[] };
        }
        if (sql.includes('SELECT continuation_required')) {
          return { rows: [{ continuation_required: false }] as T[] };
        }
        if (sql.includes('SELECT p.id, p.character_id')) {
          return {
            rows: [{
              id: 'preset-1',
              character_id: 'character-1',
              name: '默认',
              weapon_instance_id: null,
              armor_instance_id: null,
              accessory_instance_id: null,
              combat_consumables: [],
              strategy_id: 'strategy.safe',
              version: '0',
              created_at: new Date('2026-08-16T00:00:00.000Z'),
              updated_at: new Date('2026-08-16T00:00:00.000Z'),
              active: false,
            }] as T[],
          };
        }
        if (sql.includes('UPDATE characters')) {
          return { rows: [{ active: true }] as T[] };
        }
        return { rows: [] as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;

    const preset = await createEquipmentRepository({} as unknown as DatabasePool).activateLoadoutPreset(client, {
      characterId: 'character-1',
      presetId: 'preset-1',
    });
    expect(preset).toMatchObject({
      presetId: 'preset-1',
      active: true,
    });
    expect(queries.some((query) => query.includes('UPDATE characters'))).toBe(true);
  });
});
