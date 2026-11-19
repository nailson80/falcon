import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
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
const coverage = [
  { label: 'Fidelity', file: 'fidelity_accounts_2026-11-06.csv', raw: 'raw.fidelity_accounts', core: 'core.custodian_account', filter: "AND c.custodian = 'Fidelity'", columns: ['acct_number', 'registration', 'primary_owner', 'joint_owner', 'tax_id', 'market_value', 'as_of', 'rep_code'] },
  { label: 'Schwab', file: 'schwab_balances_20261030.csv', raw: 'raw.schwab_balances', core: 'core.custodian_account', filter: "AND c.custodian = 'Schwab'", columns: ['account_id', 'account_title', 'account_type', 'total_value', 'value_date', 'advisor_code', 'ssn_last4'] },
  { label: 'Salesforce households', file: 'sf_households.csv', raw: 'raw.sf_households', core: 'core.household', filter: '', columns: ['id', 'name', 'primary_advisor', 'primary_email', 'created_date'] },
  { label: 'Salesforce accounts', file: 'sf_financial_accounts.csv', raw: 'raw.sf_financial_accounts', core: 'core.salesforce_account', filter: '', columns: ['id', 'household_id', 'account_number', 'custodian', 'registration_type', 'status', 'notes'] },
  { label: 'Rep codes', file: 'rep_codes.csv', raw: 'raw.rep_codes', core: 'core.rep_code', filter: '', columns: ['rep_code', 'custodian', 'advisor_name'] },
];

try {
  await client.connect();
  let failures = 0;
  for (const { label, file, raw: rawTable, core: coreTable, filter, columns } of coverage) {
    // All identifiers here are code constants. No CSV or environment value enters SQL text.
    const result = await client.query(`
      SELECT (SELECT count(*)::int FROM ${rawTable}) AS raw_rows,
             (SELECT count(*)::int FROM ${coreTable} ${filter ? `WHERE custodian = '${label}'` : ''}) AS core_rows,
             (SELECT count(*)::int FROM ${rawTable} r
              WHERE NOT EXISTS (SELECT 1 FROM ${coreTable} c
                                WHERE c.source_file = r.source_file AND c.source_row = r.source_row ${filter})) AS omitted_rows
    `);
    const { raw_rows: rawRows, core_rows: coreRows, omitted_rows: omittedRows } = result.rows[0];
    console.log(`${label}: raw=${rawRows}, core=${coreRows}, omitted=${omittedRows}`);
    if (rawRows !== coreRows || omittedRows !== 0) failures++;

    const csv = parse(await fs.readFile(path.join(root, 'data', file), 'utf8'), { bom: true, skip_empty_lines: false });
    const raw = await client.query(`SELECT source_row, ${columns.join(', ')} FROM ${rawTable} WHERE source_file = $1 ORDER BY source_row`, [file]);
    let mismatches = Math.abs(csv.length - 1 - raw.rows.length);
    for (let index = 0; index < Math.min(csv.length - 1, raw.rows.length); index++) {
      const source = csv[index + 1];
      const stored = raw.rows[index];
      if (stored.source_row !== index + 2 || columns.some((column, cell) => stored[column] !== source[cell])) mismatches++;
    }
    console.log(`${label}: local CSV to raw mismatched rows=${mismatches}`);
    if (mismatches) failures++;
  }

  const quality = await client.query(`
    SELECT
      (SELECT count(*)::int FROM core.custodian_account WHERE account_number_key IS NULL) AS missing_account_keys,
      (SELECT count(*)::int FROM core.salesforce_account WHERE account_number_key IS NULL) AS missing_salesforce_keys,
      (SELECT count(*)::int FROM core.custodian_account WHERE registration_type IS NULL) AS unmapped_custodian_registration,
      (SELECT count(*)::int FROM core.salesforce_account WHERE registration_type IS NULL) AS unmapped_salesforce_registration,
      (SELECT count(*)::int FROM core.custodian_account WHERE value_date IS NULL) AS missing_value_dates,
      (SELECT count(*)::int FROM core.custodian_account c JOIN raw.fidelity_accounts r USING (source_file, source_row)
       WHERE c.custodian = 'Fidelity' AND NULLIF(btrim(r.market_value), '') IS NOT NULL AND c.market_value IS NULL) AS unparsed_fidelity_values,
      (SELECT count(*)::int FROM core.custodian_account c JOIN raw.schwab_balances r USING (source_file, source_row)
       WHERE c.custodian = 'Schwab' AND NULLIF(btrim(r.total_value), '') IS NOT NULL AND c.market_value IS NULL) AS unparsed_schwab_values,
      (SELECT count(*)::int FROM core.salesforce_account a LEFT JOIN core.household h USING (sf_household_id)
       WHERE h.sf_household_id IS NULL) AS orphan_salesforce_accounts,
      (SELECT count(*)::int FROM core.custodian_account WHERE market_value IS NULL) AS blank_or_unparsed_values,
      (SELECT count(*)::int FROM core.custodian_account WHERE advisor_name IS NULL) AS unmapped_advisor_codes,
      (SELECT count(*)::int FROM (SELECT custodian, account_number_key FROM core.custodian_account
       GROUP BY 1,2 HAVING count(*) > 1) duplicates) AS duplicate_custodian_account_keys,
      (SELECT count(*)::int FROM core.custodian_account WHERE market_value < 0) AS negative_market_values
  `);
  const row = quality.rows[0];
  for (const [metric, count] of Object.entries(row)) console.log(`${metric}: ${count}`);
  const hardFailures = ['missing_account_keys', 'missing_salesforce_keys', 'unmapped_custodian_registration',
    'unmapped_salesforce_registration', 'missing_value_dates', 'unparsed_fidelity_values',
    'unparsed_schwab_values', 'orphan_salesforce_accounts'];
  if (hardFailures.some((metric) => row[metric] !== 0)) failures++;
  if (failures) {
    console.error(`Core quality check failed: ${failures} coverage or transformation checks`);
    process.exitCode = 1;
  } else console.log('Core quality gate passed; unresolved source anomalies remain visible above.');
} catch (error) {
  console.error(`Core quality check failed: ${error.name}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
