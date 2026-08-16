import { Client } from 'pg';

const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed the database.');
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('SELECT 1');
} finally {
  await client.end();
}
