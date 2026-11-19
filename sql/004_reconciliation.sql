CREATE SCHEMA IF NOT EXISTS reconciliation;

CREATE TABLE IF NOT EXISTS reconciliation.run (
  run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT now(),
  custodian_rows integer NOT NULL,
  salesforce_rows integer NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation.account_status (
  run_id bigint NOT NULL REFERENCES reconciliation.run(run_id),
  source_kind text NOT NULL CHECK (source_kind IN ('custodian', 'salesforce')),
  source_file text NOT NULL,
  source_row integer NOT NULL,
  custodian text NOT NULL,
  account_number_key text NOT NULL,
  sf_account_id text,
  status text NOT NULL CHECK (status IN ('matched', 'custodian_only', 'salesforce_only', 'conflicting')),
  reason_codes text[] NOT NULL DEFAULT '{}',
  counterpart_source_file text,
  counterpart_source_row integer,
  PRIMARY KEY (run_id, source_kind, source_file, source_row)
);
CREATE INDEX IF NOT EXISTS account_status_lookup_idx
  ON reconciliation.account_status (run_id, status, custodian);

CREATE TABLE IF NOT EXISTS reconciliation.aum_account (
  run_id bigint NOT NULL REFERENCES reconciliation.run(run_id),
  custodian text NOT NULL,
  account_number_key text NOT NULL,
  advisor_name text,
  value_date date NOT NULL,
  market_value numeric(20,2),
  source_rows integer NOT NULL CHECK (source_rows >= 1),
  disposition text NOT NULL CHECK (disposition IN ('included', 'excluded_missing_value', 'excluded_inconsistent_duplicate')),
  reason_codes text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, custodian, account_number_key)
);

CREATE OR REPLACE VIEW reconciliation.current_account_status AS
SELECT s.* FROM reconciliation.account_status s
WHERE s.run_id = (SELECT max(run_id) FROM reconciliation.run);

CREATE OR REPLACE VIEW reconciliation.current_exceptions AS
SELECT * FROM reconciliation.current_account_status WHERE status <> 'matched';

CREATE OR REPLACE VIEW reconciliation.current_aum_by_advisor_custodian AS
SELECT coalesce(advisor_name, 'Unmapped') AS advisor,
       custodian, value_date AS as_of_date,
       sum(market_value)::numeric(20,2) AS aum,
       count(*)::integer AS included_accounts
FROM reconciliation.aum_account
WHERE run_id = (SELECT max(run_id) FROM reconciliation.run)
  AND disposition = 'included'
GROUP BY 1,2,3;

CREATE OR REPLACE VIEW reconciliation.current_aum_by_custodian AS
SELECT custodian, value_date AS as_of_date,
       sum(market_value)::numeric(20,2) AS aum,
       count(*)::integer AS included_accounts
FROM reconciliation.aum_account
WHERE run_id = (SELECT max(run_id) FROM reconciliation.run)
  AND disposition = 'included'
GROUP BY 1,2;
