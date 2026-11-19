import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildReconciliation } from '../src/reconcile.mjs';

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
  await client.query('BEGIN');
  await client.query(await fs.readFile(path.join(root, 'sql', '004_reconciliation.sql'), 'utf8'));
  const custodians = await client.query(`SELECT custodian, source_file, source_row, account_number_raw, account_number_key,
    registration_type, account_title, primary_owner, joint_owner, tax_id_last4, rep_code, advisor_name,
    market_value::text, value_date::text FROM core.custodian_account ORDER BY custodian, source_file, source_row`);
  const salesforce = await client.query(`SELECT a.custodian, a.source_file, a.source_row, a.sf_account_id, a.account_number_key,
    a.registration_type, a.sf_status, h.primary_advisor_name AS household_advisor_name
    FROM core.salesforce_account a JOIN core.household h USING (sf_household_id)
    ORDER BY a.source_file, a.source_row`);
  const { statuses, aumAccounts } = buildReconciliation(custodians.rows, salesforce.rows);
  if (statuses.length !== custodians.rowCount + salesforce.rowCount) throw new Error('Status coverage failure');
  const run = await client.query('INSERT INTO reconciliation.run (custodian_rows, salesforce_rows) VALUES ($1,$2) RETURNING run_id',
    [custodians.rowCount, salesforce.rowCount]);
  const runId = run.rows[0].run_id;
  for (const row of statuses) {
    await client.query(`INSERT INTO reconciliation.account_status
      (run_id, source_kind, source_file, source_row, custodian, account_number_key, sf_account_id,
       status, reason_codes, counterpart_source_file, counterpart_source_row)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [runId, row.source_kind, row.source_file, row.source_row, row.custodian, row.account_number_key,
      row.sf_account_id, row.status, row.reason_codes, row.counterpart_source_file, row.counterpart_source_row]);
  }
  for (const row of aumAccounts) {
    await client.query(`INSERT INTO reconciliation.aum_account
      (run_id, custodian, account_number_key, advisor_name, value_date, market_value, source_rows, disposition, reason_codes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [runId, row.custodian, row.account_number_key, row.advisor_name, row.value_date, row.market_value,
      row.source_rows, row.disposition, row.reason_codes]);
  }
  await client.query('COMMIT');
  console.log(`Reconciliation run ${runId}: ${statuses.length} source accounts assigned a status; ${aumAccounts.length} custodian account keys evaluated for AUM.`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Reconciliation failed: ${error.name}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
