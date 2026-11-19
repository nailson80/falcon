CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS reconciliation;

-- Pure normalization functions. Raw strings remain available in the raw schema.
CREATE OR REPLACE FUNCTION core.account_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(upper(regexp_replace(btrim(value), '[^[:alnum:]]', '', 'g')), '')
$$;

CREATE OR REPLACE FUNCTION core.registration_type(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE upper(regexp_replace(btrim(value), '[^[:alnum:]]', '', 'g'))
    WHEN 'JTWROS' THEN 'Joint'
    WHEN 'JTTENWROS' THEN 'Joint'
    WHEN 'JOINTTENANTSWROS' THEN 'Joint'
    WHEN 'JOINT' THEN 'Joint'
    WHEN 'IRA' THEN 'IRA'
    WHEN 'IRATRADITIONAL' THEN 'IRA'
    WHEN 'TRADIRA' THEN 'IRA'
    WHEN 'CONTRIBUTORYIRA' THEN 'IRA'
    WHEN 'ROTH' THEN 'Roth IRA'
    WHEN 'ROTHIRA' THEN 'Roth IRA'
    WHEN 'ROTHCONTRIBUTORYIRA' THEN 'Roth IRA'
    WHEN 'SEP' THEN 'SEP IRA'
    WHEN 'SEPIRA' THEN 'SEP IRA'
    WHEN 'TRUST' THEN 'Trust'
    WHEN 'TRUSTREVOCABLE' THEN 'Trust'
    WHEN 'REVTRUST' THEN 'Trust'
    WHEN 'LIVINGTRUST' THEN 'Trust'
    WHEN 'INDV' THEN 'Individual'
    WHEN 'INDIVIDUAL' THEN 'Individual'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION core.money_amount(value text) RETURNS numeric(20,2)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN btrim(value) ~ '^(-?\$?|\$-?)([0-9]+|[0-9]{1,3}(,[0-9]{3})+)(\.[0-9]{1,2})?$'
    THEN replace(replace(btrim(value), '$', ''), ',', '')::numeric(20,2)
    ELSE NULL
  END
$$;

CREATE TABLE IF NOT EXISTS core.advisor (
  advisor_name text PRIMARY KEY CHECK (btrim(advisor_name) <> '')
);

CREATE TABLE IF NOT EXISTS core.rep_code (
  custodian text NOT NULL CHECK (custodian IN ('Fidelity', 'Schwab')),
  rep_code text NOT NULL,
  advisor_name text NOT NULL REFERENCES core.advisor(advisor_name),
  source_file text NOT NULL,
  source_row integer NOT NULL,
  PRIMARY KEY (custodian, rep_code)
);

CREATE TABLE IF NOT EXISTS core.household (
  sf_household_id text PRIMARY KEY,
  household_name text NOT NULL,
  primary_advisor_name text REFERENCES core.advisor(advisor_name),
  primary_email text,
  created_date date,
  source_file text NOT NULL,
  source_row integer NOT NULL,
  UNIQUE (source_file, source_row)
);

CREATE TABLE IF NOT EXISTS core.salesforce_account (
  sf_account_id text PRIMARY KEY,
  sf_household_id text NOT NULL REFERENCES core.household(sf_household_id),
  custodian text NOT NULL CHECK (custodian IN ('Fidelity', 'Schwab')),
  account_number_raw text NOT NULL,
  account_number_key text NOT NULL,
  registration_raw text,
  registration_type text,
  sf_status text NOT NULL,
  notes text,
  source_file text NOT NULL,
  source_row integer NOT NULL,
  UNIQUE (source_file, source_row)
);
CREATE INDEX IF NOT EXISTS salesforce_account_match_idx
  ON core.salesforce_account (custodian, account_number_key);

-- One canonical custodian table for both files. Its key identifies a source
-- observation, so duplicate account numbers remain visible for reconciliation.
CREATE TABLE IF NOT EXISTS core.custodian_account (
  custodian text NOT NULL CHECK (custodian IN ('Fidelity', 'Schwab')),
  source_file text NOT NULL,
  source_row integer NOT NULL,
  account_number_raw text NOT NULL,
  account_number_key text NOT NULL,
  registration_raw text,
  registration_type text,
  account_title text,
  primary_owner text,
  joint_owner text,
  tax_id_last4 text,
  rep_code text,
  advisor_name text REFERENCES core.advisor(advisor_name),
  market_value numeric(20,2),
  value_date date NOT NULL,
  imported_at timestamptz NOT NULL,
  PRIMARY KEY (custodian, source_file, source_row)
);
CREATE INDEX IF NOT EXISTS custodian_account_match_idx
  ON core.custodian_account (custodian, account_number_key);
CREATE INDEX IF NOT EXISTS custodian_account_aum_idx
  ON core.custodian_account (advisor_name, custodian, value_date);
