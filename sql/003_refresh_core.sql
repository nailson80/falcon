BEGIN;

-- This refresh is an atomic rebuild of the current source snapshot. Reconciliation
-- tables are intentionally separate and have not been created yet.
DELETE FROM core.custodian_account;
DELETE FROM core.salesforce_account;
DELETE FROM core.household;
DELETE FROM core.rep_code;
DELETE FROM core.advisor;

INSERT INTO core.advisor (advisor_name)
SELECT DISTINCT btrim(advisor_name) FROM raw.rep_codes WHERE NULLIF(btrim(advisor_name), '') IS NOT NULL
UNION
SELECT DISTINCT btrim(primary_advisor) FROM raw.sf_households WHERE NULLIF(btrim(primary_advisor), '') IS NOT NULL;

INSERT INTO core.rep_code (custodian, rep_code, advisor_name, source_file, source_row)
SELECT btrim(custodian), btrim(rep_code), btrim(advisor_name), source_file, source_row
FROM raw.rep_codes;

INSERT INTO core.household (sf_household_id, household_name, primary_advisor_name, primary_email, created_date, source_file, source_row)
SELECT btrim(id), btrim(name), NULLIF(btrim(primary_advisor), ''), NULLIF(btrim(primary_email), ''), NULLIF(btrim(created_date), '')::date, source_file, source_row
FROM raw.sf_households;

INSERT INTO core.salesforce_account (sf_account_id, sf_household_id, custodian, account_number_raw, account_number_key, registration_raw, registration_type, sf_status, notes, source_file, source_row)
SELECT btrim(id), btrim(household_id), btrim(custodian), btrim(account_number), core.account_key(account_number),
       registration_type, core.registration_type(registration_type), btrim(status), NULLIF(notes, ''), source_file, source_row
FROM raw.sf_financial_accounts;

INSERT INTO core.custodian_account
  (custodian, source_file, source_row, account_number_raw, account_number_key,
   registration_raw, registration_type, account_title, primary_owner, joint_owner,
   tax_id_last4, rep_code, advisor_name, market_value, value_date, imported_at)
SELECT 'Fidelity', f.source_file, f.source_row, f.acct_number, core.account_key(f.acct_number),
       f.registration, core.registration_type(f.registration), NULL, f.primary_owner, NULLIF(f.joint_owner, ''),
       right(regexp_replace(coalesce(f.tax_id, ''), '[^0-9]', '', 'g'), 4),
       f.rep_code, r.advisor_name, core.money_amount(f.market_value), to_date(f.as_of, 'MM/DD/YYYY'), f.imported_at
FROM raw.fidelity_accounts f
LEFT JOIN core.rep_code r ON r.custodian = 'Fidelity' AND r.rep_code = btrim(f.rep_code)
UNION ALL
SELECT 'Schwab', s.source_file, s.source_row, s.account_id, core.account_key(s.account_id),
       s.account_type, core.registration_type(s.account_type), s.account_title, NULL, NULL,
       NULLIF(btrim(s.ssn_last4), ''), s.advisor_code, r.advisor_name,
       core.money_amount(s.total_value), NULLIF(btrim(s.value_date), '')::date, s.imported_at
FROM raw.schwab_balances s
LEFT JOIN core.rep_code r ON r.custodian = 'Schwab' AND r.rep_code = btrim(s.advisor_code);

COMMIT;
