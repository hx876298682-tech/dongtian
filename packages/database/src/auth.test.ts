import { describe, expect, it } from 'vitest';

import { createAuthRepository } from './auth.js';

function makePool(existingCharacter = false) {
  const queries: string[] = [];
  let equipmentId = 0;
  const client = {
    async query<T>(sql: string): Promise<{ readonly rows: T[]; readonly rowCount: number }> {
      queries.push(sql);
      if (existingCharacter && sql.includes('SELECT id FROM characters WHERE account_id')) {
        return { rows: [{ id: 'character-1' } as T], rowCount: 1 };
      }
      if (existingCharacter && sql.includes('SELECT id FROM loadout_presets')) {
        return { rows: [{ id: 'preset-1' } as T], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO accounts')) return { rows: [{ id: 'account-1' } as T], rowCount: 1 };
      if (sql.includes('INSERT INTO characters')) return { rows: [{ id: 'character-1' } as T], rowCount: 1 };
      if (sql.includes('INSERT INTO asset_transactions')) return { rows: [{ id: 'transaction-1' } as T], rowCount: 1 };
      if (sql.includes('INSERT INTO equipment_instances')) {
        equipmentId += 1;
        return { rows: [{ id: `equipment-${equipmentId}` } as T], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO sessions')) return { rows: [{ id: 'session-1', expires_at: new Date('2026-01-01') } as T], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return {
    queries,
    pool: {
      async connect() {
        return client;
      },
    } as never,
  };
}

describe('auth starter kit', () => {
  it('creates a dungeon-ready starter kit for a new anonymous character', async () => {
    const fixture = makePool();
    const repository = createAuthRepository(fixture.pool);

    await repository.createAnonymousSession({
      sessionTokenHash: 'session-hash',
      csrfTokenHash: 'csrf-hash',
      expiresAt: new Date('2026-01-01'),
      defaultCharacter: {
        name: '洞天散修',
        realmStageId: 'realm.mortal.entry',
        activeConfigVersion: '2026.08.16.1',
        skillIds: ['skill.herbalism', 'skill.alchemy'],
      },
    });

    expect(fixture.queries.filter((query) => query.includes('INSERT INTO equipment_instances'))).toHaveLength(5);
    expect(fixture.queries.some((query) => query.includes('INSERT INTO skill_tool_assignments'))).toBe(true);
    expect(fixture.queries.some((query) => query.includes('INSERT INTO loadout_presets'))).toBe(true);
    expect(fixture.queries.some((query) => query.includes("'AUTH_STARTER_KIT'"))).toBe(true);
  });

  it('does not duplicate the starter kit when ensuring an existing character', async () => {
    const fixture = makePool(true);
    const repository = createAuthRepository(fixture.pool);

    await repository.ensureDefaultCharacter('account-1', {
      name: '洞天散修',
      realmStageId: 'realm.mortal.entry',
      activeConfigVersion: '2026.08.16.1',
      skillIds: ['skill.herbalism', 'skill.alchemy'],
    });

    expect(fixture.queries.filter((query) => query.includes('INSERT INTO equipment_instances'))).toHaveLength(0);
    expect(fixture.queries.filter((query) => query.includes('INSERT INTO asset_transactions'))).toHaveLength(0);
  });
});
