CREATE SCHEMA IF NOT EXISTS reconciliation;
CREATE TABLE IF NOT EXISTS reconciliation.app_user (
  auth_user_id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('advisor','operations')),
  advisor_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'advisor' AND advisor_name IS NOT NULL) OR (role = 'operations' AND advisor_name IS NULL))
);
CREATE TABLE IF NOT EXISTS reconciliation.proposed_change (
  proposal_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('link_account','merge_household')),
  target_account_id text,
  source_household_id text,
  target_household_id text NOT NULL,
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','undone')),
  proposed_by text NOT NULL REFERENCES reconciliation.app_user(auth_user_id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by text REFERENCES reconciliation.app_user(auth_user_id),
  decided_at timestamptz,
  CHECK ((action='link_account' AND target_account_id IS NOT NULL AND source_household_id IS NULL)
      OR (action='merge_household' AND target_account_id IS NULL AND source_household_id IS NOT NULL AND source_household_id <> target_household_id))
);
CREATE TABLE IF NOT EXISTS reconciliation.account_household_resolution (
  custodian text NOT NULL CHECK (custodian IN ('Fidelity','Schwab')),
  account_number_key text NOT NULL,
  sf_household_id text NOT NULL,
  proposal_id bigint NOT NULL REFERENCES reconciliation.proposed_change(proposal_id),
  PRIMARY KEY (custodian,account_number_key)
);
CREATE TABLE IF NOT EXISTS reconciliation.household_merge_resolution (
  source_household_id text PRIMARY KEY,
  target_household_id text NOT NULL,
  proposal_id bigint NOT NULL REFERENCES reconciliation.proposed_change(proposal_id),
  CHECK (source_household_id <> target_household_id)
);
CREATE TABLE IF NOT EXISTS reconciliation.change_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposal_id bigint NOT NULL REFERENCES reconciliation.proposed_change(proposal_id),
  event text NOT NULL CHECK (event IN ('proposed','approved','rejected','undone')),
  actor_id text NOT NULL REFERENCES reconciliation.app_user(auth_user_id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  before_value jsonb,
  after_value jsonb,
  reason text,
  reverses_audit_id bigint REFERENCES reconciliation.change_audit(audit_id)
);
CREATE INDEX IF NOT EXISTS proposed_change_status_idx ON reconciliation.proposed_change(status,proposed_at DESC);
CREATE INDEX IF NOT EXISTS change_audit_proposal_idx ON reconciliation.change_audit(proposal_id,audit_id);

-- Core is rebuilt from source files. App decisions retain source IDs without foreign keys
-- into the disposable current snapshot; proposal validation checks current existence.
ALTER TABLE reconciliation.app_user DROP CONSTRAINT IF EXISTS app_user_advisor_name_fkey;
ALTER TABLE reconciliation.proposed_change DROP CONSTRAINT IF EXISTS proposed_change_target_household_id_fkey;
ALTER TABLE reconciliation.account_household_resolution DROP CONSTRAINT IF EXISTS account_household_resolution_sf_household_id_fkey;
ALTER TABLE reconciliation.household_merge_resolution DROP CONSTRAINT IF EXISTS household_merge_resolution_source_household_id_fkey;
ALTER TABLE reconciliation.household_merge_resolution DROP CONSTRAINT IF EXISTS household_merge_resolution_target_household_id_fkey;

-- A reasoned app disposition can close any source exception without changing its source finding.
ALTER TABLE reconciliation.proposed_change ADD COLUMN IF NOT EXISTS target_run_id bigint;
ALTER TABLE reconciliation.proposed_change ADD COLUMN IF NOT EXISTS target_source_kind text;
ALTER TABLE reconciliation.proposed_change ADD COLUMN IF NOT EXISTS target_source_file text;
ALTER TABLE reconciliation.proposed_change ADD COLUMN IF NOT EXISTS target_source_row integer;
ALTER TABLE reconciliation.proposed_change ALTER COLUMN target_household_id DROP NOT NULL;
ALTER TABLE reconciliation.proposed_change DROP CONSTRAINT IF EXISTS proposed_change_action_check;
ALTER TABLE reconciliation.proposed_change ADD CONSTRAINT proposed_change_action_check CHECK (action IN ('link_account','merge_household','resolve_exception'));
ALTER TABLE reconciliation.proposed_change DROP CONSTRAINT IF EXISTS proposed_change_check;
ALTER TABLE reconciliation.proposed_change ADD CONSTRAINT proposed_change_check CHECK (
  (action='link_account' AND target_account_id IS NOT NULL AND target_household_id IS NOT NULL AND source_household_id IS NULL AND target_source_kind IS NULL)
  OR (action='merge_household' AND target_account_id IS NULL AND source_household_id IS NOT NULL AND target_household_id IS NOT NULL AND source_household_id <> target_household_id AND target_source_kind IS NULL)
  OR (action='resolve_exception' AND target_account_id IS NULL AND source_household_id IS NULL AND target_household_id IS NULL AND target_run_id IS NOT NULL AND target_source_kind IS NOT NULL AND target_source_file IS NOT NULL AND target_source_row IS NOT NULL));
ALTER TABLE reconciliation.account_household_resolution ADD COLUMN IF NOT EXISTS source_run_id bigint;
CREATE TABLE IF NOT EXISTS reconciliation.exception_resolution (
  run_id bigint NOT NULL REFERENCES reconciliation.run(run_id),
  source_kind text NOT NULL,
  source_file text NOT NULL,
  source_row integer NOT NULL,
  proposal_id bigint NOT NULL REFERENCES reconciliation.proposed_change(proposal_id),
  rationale text NOT NULL,
  PRIMARY KEY(run_id,source_kind,source_file,source_row)
);

-- A reviewed exception needs a specific outcome; a note alone is not a source fix.
ALTER TABLE reconciliation.proposed_change ADD COLUMN IF NOT EXISTS review_outcome text;
ALTER TABLE reconciliation.exception_resolution ADD COLUMN IF NOT EXISTS review_outcome text;
ALTER TABLE reconciliation.proposed_change DROP CONSTRAINT IF EXISTS proposed_change_review_outcome_check;
ALTER TABLE reconciliation.proposed_change ADD CONSTRAINT proposed_change_review_outcome_check CHECK (
  (action='resolve_exception' AND review_outcome IN ('accepted_as_reported','needs_source_follow_up'))
  OR (action<>'resolve_exception' AND review_outcome IS NULL));
