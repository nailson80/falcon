import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadLocalEnv() {
  if (process.env.DATABASE_URL) return;
  let text;
  try { text = await fs.readFile(path.join(root, '.env'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const line = text.split(/\r?\n/).find((entry) => /^DATABASE_URL\s*=/.test(entry));
  if (!line) return;
  const value = line.replace(/^DATABASE_URL\s*=\s*/, '').trim();
  process.env.DATABASE_URL = value.replace(/^(['"])(.*)\1$/, '$2');
}

await loadLocalEnv();
const checkOnly = process.argv.includes('--check');
if (!checkOnly && !process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL in the environment or an ignored .env file.');
  process.exit(1);
}

const sources = [
  { file: 'fidelity_accounts_2026-11-06.csv', table: 'fidelity_accounts', headers: ['Acct Number', 'Registration', 'Primary Owner', 'Joint Owner', 'Tax ID', 'Market Value', 'As Of', 'Rep Code'], columns: ['acct_number', 'registration', 'primary_owner', 'joint_owner', 'tax_id', 'market_value', 'as_of', 'rep_code'] },
  { file: 'schwab_balances_20261030.csv', table: 'schwab_balances', headers: ['account_id', 'account_title', 'account_type', 'total_value', 'value_date', 'advisor_code', 'ssn_last4'], columns: ['account_id', 'account_title', 'account_type', 'total_value', 'value_date', 'advisor_code', 'ssn_last4'] },
  { file: 'sf_households.csv', table: 'sf_households', headers: ['Id', 'Name', 'Primary_Advisor__c', 'Primary_Email__c', 'CreatedDate'], columns: ['id', 'name', 'primary_advisor', 'primary_email', 'created_date'] },
  { file: 'sf_financial_accounts.csv', table: 'sf_financial_accounts', headers: ['Id', 'Household__c', 'Account_Number__c', 'Custodian__c', 'Registration_Type__c', 'Status__c', 'Notes__c'], columns: ['id', 'household_id', 'account_number', 'custodian', 'registration_type', 'status', 'notes'] },
  { file: 'rep_codes.csv', table: 'rep_codes', headers: ['rep_code', 'custodian', 'advisor_name'], columns: ['rep_code', 'custodian', 'advisor_name'] },
];

const client = checkOnly ? null : new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  const prepared = [];
  for (const source of sources) {
    const csv = await fs.readFile(path.join(root, 'data', source.file), 'utf8');
    const records = parse(csv, { bom: true, relax_quotes: false, skip_empty_lines: false, record_delimiter: ['\r\n', '\n'] });
    const [header, ...rows] = records;
    if (JSON.stringify(header) !== JSON.stringify(source.headers)) throw new Error(`Unexpected headers in ${source.file}`);
    if (rows.some((row) => row.length !== source.columns.length)) throw new Error(`Unexpected row width in ${source.file}`);
    prepared.push({ ...source, rows });
  }

  if (checkOnly) {
    for (const source of prepared) console.log(`${source.table}: ${source.rows.length} rows validated`);
    process.exit(0);
  }

  await client.connect();
  await client.query('BEGIN');
  await client.query(await fs.readFile(path.join(root, 'sql', '001_raw_import.sql'), 'utf8'));
  for (const source of prepared) {
    // Table and column names are fixed above, never derived from CSV contents.
    await client.query(`DELETE FROM raw.${source.table} WHERE source_file = $1`, [source.file]);
    const columns = ['source_file', 'source_row', ...source.columns];
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    for (const [index, row] of source.rows.entries()) {
      await client.query(`INSERT INTO raw.${source.table} (${columns.join(', ')}) VALUES (${placeholders})`, [source.file, index + 2, ...row]);
    }
    console.log(`${source.table}: ${source.rows.length} rows imported`);
  }
  await client.query('COMMIT');
} catch (error) {
  await client?.query('ROLLBACK').catch(() => {});
  // Error messages can contain sensitive row values; report only the error type.
  console.error(`Import failed: ${error.name}`);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
