import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DatabasePool } from './index.js';
import { createSkillToolAssignmentRepository } from './skill-tool-assignments.js';

describe('skill tool assignment repository', () => {
  it('reads assignments with their equipment item ids', async () => {
    const pool = {
      async query<T>(): Promise<{ readonly rows: T[] }> {
        return {
          rows: [{
            character_id: 'character-1',
            skill_id: 'skill.herbalism',
            equipment_instance_id: 'tool-1',
            item_id: 'item.t1.qingtong_yaochu',
            version: '2',
            updated_at: new Date('2026-08-16T00:00:00.000Z'),
          }] as T[],
        };
      },
    } as unknown as DatabasePool;

    await expect(createSkillToolAssignmentRepository(pool).getAssignments('character-1', 'account-1'))
      .resolves.toMatchObject([{
        characterId: 'character-1',
        skillId: 'skill.herbalism',
        equipmentInstanceId: 'tool-1',
        itemId: 'item.t1.qingtong_yaochu',
        version: 2n,
      }]);
  });

  it('replaces assignments atomically after locking the character and settlement state', async () => {
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
        if (sql.includes('RETURNING character_id, skill_id, equipment_instance_id')) {
          return {
            rows: [{
              character_id: 'character-1',
              skill_id: 'skill.herbalism',
              equipment_instance_id: 'tool-1',
              item_id: 'item.t1.qingtong_yaochu',
              version: '1',
              updated_at: new Date('2026-08-16T00:00:00.000Z'),
            }] as T[],
          };
        }
        if (sql.includes('FROM skill_tool_assignments sta') && sql.includes('equipment_instances ei')) {
          return {
            rows: [{
              character_id: 'character-1',
              skill_id: 'skill.herbalism',
              equipment_instance_id: 'tool-1',
              item_id: 'item.t1.qingtong_yaochu',
              version: '1',
              updated_at: new Date('2026-08-16T00:00:00.000Z'),
            }] as T[],
          };
        }
        return { rows: [] as T[] };
      },
      release: vi.fn(),
    } as unknown as PoolClient;

    const result = await createSkillToolAssignmentRepository({} as unknown as DatabasePool).replaceAssignments(client, {
      characterId: 'character-1',
      assignments: [{
        skillId: 'skill.herbalism',
        equipmentInstanceId: 'tool-1',
      }],
    });

    expect(result).toMatchObject([{
      skillId: 'skill.herbalism',
      equipmentInstanceId: 'tool-1',
      itemId: 'item.t1.qingtong_yaochu',
    }]);
    expect(queries.some((query) => query.includes('DELETE FROM skill_tool_assignments'))).toBe(true);
    expect(queries.some((query) => query.includes('ON CONFLICT (character_id, skill_id) DO UPDATE'))).toBe(true);
  });
});
