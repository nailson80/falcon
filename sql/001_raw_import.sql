CREATE SCHEMA IF NOT EXISTS raw;

CREATE TABLE IF NOT EXISTS raw.fidelity_accounts (
  source_file text NOT NULL,
  source_row integer NOT NULL CHECK (source_row >= 2),
  acct_number text,
  registration text,
  primary_owner text,
  joint_owner text,
  tax_id text,
  market_value text,
  as_of text,
  rep_code text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_file, source_row)
);

CREATE TABLE IF NOT EXISTS raw.schwab_balances (
  source_file text NOT NULL,
  source_row integer NOT NULL CHECK (source_row >= 2),
  account_id text,
  account_title text,
  account_type text,
  total_value text,
  value_date text,
  advisor_code text,
  ssn_last4 text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_file, source_row)
);

CREATE TABLE IF NOT EXISTS raw.sf_households (
  source_file text NOT NULL,
  source_row integer NOT NULL CHECK (source_row >= 2),
  id text,
  name text,
  primary_advisor text,
  primary_email text,
  created_date text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_file, source_row)
);

CREATE TABLE IF NOT EXISTS raw.sf_financial_accounts (
  source_file text NOT NULL,
  source_row integer NOT NULL CHECK (source_row >= 2),
  id text,
  household_id text,
  account_number text,
  custodian text,
  registration_type text,
  status text,
  notes text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_file, source_row)
);

CREATE TABLE IF NOT EXISTS raw.rep_codes (
  source_file text NOT NULL,
  source_row integer NOT NULL CHECK (source_row >= 2),
  rep_code text,
  custodian text,
  advisor_name text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_file, source_row)
);
