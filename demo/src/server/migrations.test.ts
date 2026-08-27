import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMigrations, migrationFiles } from './migrations.ts';
import type { AsyncSqlClient, SqlResult } from './postgres-repository.ts';

class FakeMigrationClient implements AsyncSqlClient {
  readonly sql: string[] = [];
  failOn: string | null = null;
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string): Promise<SqlResult<Row>> {
    this.sql.push(text);
    if (this.failOn && text.includes(this.failOn)) throw new Error(`forced migration failure: ${this.failOn}`);
    return { rows: [], rowCount: 0 } as SqlResult<Row>;
  }
}

test('startup applies checked-in migrations in order and releases a connected client', async () => {
  const client = new FakeMigrationClient();
  let released = false;
  await applyMigrations({ connect: async () => ({ query: client.query.bind(client), release: () => { released = true; } }) });
  assert.equal(client.sql.length, migrationFiles.length + 3);
  assert.equal(client.sql[0], 'BEGIN');
  assert.match(client.sql[1], /pg_advisory_xact_lock/);
  assert.match(client.sql[2], /create table if not exists player_state/);
  assert.match(client.sql[3], /create table if not exists config_release/);
  assert.equal(client.sql.at(-1), 'COMMIT');
  assert.equal(released, true);
});

test('startup rolls back a partially applied migration batch and releases the client', async () => {
  const client = new FakeMigrationClient();
  client.failOn = 'config_release';
  let released = false;
  await assert.rejects(() => applyMigrations({ connect: async () => ({ query: client.query.bind(client), release: () => { released = true; } }) }), /forced migration failure/);
  assert.equal(client.sql[0], 'BEGIN');
  assert.match(client.sql[1]!, /pg_advisory_xact_lock/);
  assert.match(client.sql[2]!, /player_state/);
  assert.match(client.sql[3]!, /config_release/);
  assert.equal(client.sql[4], 'ROLLBACK');
  assert.equal(released, true);
});
