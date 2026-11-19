import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let url = process.env.DATABASE_URL;
if (!url) {
  const env = await fs.readFile(path.join(root, '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((item) => /^DATABASE_URL\s*=/.test(item));
  if (!line) throw new Error('DATABASE_URL is missing');
  url = line.replace(/^DATABASE_URL\s*=\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
}

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query(await fs.readFile(path.join(root, 'sql', '002_core_model.sql'), 'utf8'));
  await client.query(await fs.readFile(path.join(root, 'sql', '003_refresh_core.sql'), 'utf8'));
  const counts = await client.query(`
    SELECT 'advisor' AS table_name, count(*)::int AS rows FROM core.advisor
    UNION ALL SELECT 'rep_code', count(*)::int FROM core.rep_code
    UNION ALL SELECT 'household', count(*)::int FROM core.household
    UNION ALL SELECT 'salesforce_account', count(*)::int FROM core.salesforce_account
    UNION ALL SELECT 'custodian_account', count(*)::int FROM core.custodian_account
  `);
  for (const row of counts.rows) console.log(`core.${row.table_name}: ${row.rows}`);
} catch (error) {
  console.error(`Core refresh failed: ${error.name}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
