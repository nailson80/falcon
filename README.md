# Falcon account reconciliation

Work in progress for the Falcon Wealth Planning full-stack take-home assessment.

## Run

The five source CSV files belong in `data/`, which is ignored by Git. Do not commit source data, database dumps, or credentials.

1. Run `npm install`.
2. Run `npm run db:check` to validate CSV headers and row widths locally.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` to the Neon PostgreSQL connection string.
4. Run `npm run db:import` from the project root.
5. Run `npm run db:core` to create and refresh the typed `core` model.
6. Run `npm run db:quality` to check row coverage and typed transformations after each refresh.
7. Run `npm test`, then `npm run db:reconcile` to create a new reconciliation run. Query the `reconciliation.current_*` views for current statuses, exceptions, and AUM. The complete source-row exception list from the first run is in [RECONCILIATION.md](RECONCILIATION.md).

The import creates five tables in the `raw` schema, one per CSV. Every source field is stored as text, alongside the source filename, CSV row number, and import timestamp. The import validates exact headers and row widths before connecting. It replaces rows for these five source filenames in one transaction, so rerunning it does not duplicate rows. Reconciliation and the Netlify exception review app are implemented below.

The initial Neon import completed on 2026-11-18 PST. Read-only count queries confirmed:

| Raw table | Rows |
| --- | ---: |
| `raw.fidelity_accounts` | 45 |
| `raw.schwab_balances` | 20 |
| `raw.sf_households` | 34 |
| `raw.sf_financial_accounts` | 63 |
| `raw.rep_codes` | 8 |

## Data model

Data layers:

1. Preserve each source row and its source file, row number, and import time in the five `raw` schema tables.
2. `core.custodian_account` is the shared, typed model for Fidelity and Schwab observations. The primary key is `(custodian, source_file, source_row)`, so duplicate account numbers remain visible. It retains raw and normalized account numbers and registration labels, typed `numeric(20,2)` market value and `date` value date, advisor code and mapped advisor, owner/title context, and source lineage. The full tax ID stays only in `raw`; `core` stores at most the last four digits.
3. `core.advisor` and `core.rep_code` provide advisor lookup by custodian and code. `core.household` and `core.salesforce_account` hold typed Salesforce entities with a household foreign key. Account numbers are indexed by custodian and normalized key for later matching. No account-to-household link is inferred in `core`.
4. `reconciliation` holds run snapshots, a status and reason for each source account, and one AUM decision per custodian account key. Its `current_*` views expose the latest run. App proposals, approved resolutions, and audit history also live there.

This is a clean **current-snapshot warehouse foundation**, with shared custodian facts, typed values, source lineage, and separate reconciliation decisions. It is not yet a complete weekly historical warehouse: the raw importer replaces rows for the same filenames, and `db:core` atomically rebuilds the current snapshot. Before loading recurring weekly files or adding downstream foreign keys, introduce immutable import batches and an incremental, versioned core load. Advisor names serve as the available business key because the exports contain no advisor ID; a production warehouse should add a durable advisor identifier. Access controls for sensitive `raw` fields also remain to be established.

After the initial refresh, read-only checks found 65 custodian observations (45 Fidelity, 20 Schwab), 63 Salesforce accounts, 34 households, 8 rep-code mappings, and 4 advisors. The quality gate compares every cell in each local CSV row with its `raw` row, then checks each `raw` row by filename and CSV row number against `core`. It found **zero CSV-to-raw mismatches and zero raw-to-core omissions** in all five sources, zero missing account keys, zero unmapped registration types, zero failed nonblank value parses, zero missing value dates, and zero orphan Salesforce accounts.

### Data quality and handling

| Finding | Current handling | Reconciliation consequence |
| --- | --- | --- |
| Fidelity uses several labels for the same registration type; Schwab has different labels again. | Keep the original label in `registration_raw` and map known labels to one of `Individual`, `Joint`, `IRA`, `Roth IRA`, `SEP IRA`, or `Trust`. Unknown labels remain null and fail `db:quality`. | Compare standardized types without losing source wording. |
| One Fidelity market value is blank. | Keep the account row and set typed `market_value` to null. `db:quality` reports it separately from parse failures. | Do not treat it as zero or silently include it in AUM. Flag it for review. |
| One Fidelity market value is negative, formatted with the minus sign before the currency symbol. | Parse it as a negative `numeric(20,2)` value; the parser rejects malformed grouping. | Preserve its effect on AUM and review whether it is expected. |
| One Schwab advisor code has no entry in the rep-code file. | Keep the source code and account row; leave `advisor_name` null. | Show an unmapped-advisor exception. Do not assign it by guesswork. |
| One Fidelity account key occurs in two source rows. The two observations agree on value, registration, advisor code, owner, last four tax digits, and date. | Preserve both rows with separate source-row keys. No row is discarded or merged in `core`. | Resolve duplicate treatment before computing AUM so the amount is not double counted. |
| Fidelity values are dated 2026-11-06; Schwab values are dated 2026-10-30. | Store each row's typed `value_date`; do not overwrite with import time or a shared date. | Report AUM by custodian with its own as-of date; label any combined figure as mixed-date. |
| Salesforce includes 61 `Open`, one `Closed`, and one `Transferring` financial account. | Keep all 63 records and their original status in `core.salesforce_account`. | Apply explicit status rules during reconciliation; do not silently drop non-open records. |
| Custodian identifiers and names may contain formatting differences. | Keep raw account identifiers and owner/title text; create a case-folded alphanumeric account key for candidate matching. | A normalized key is only a candidate key. Validate custodian and uniqueness before declaring a match. |
| Source files contain full or partial tax identifiers. | Keep full Fidelity values only in the ignored local CSV and `raw` table; `core` retains last four digits. Database access controls for `raw` still need to be established. | Do not use partial identifiers as sole match evidence or include them in AI input. |

`db:quality` fails on omissions, broken foreign keys, missing normalized identifiers or registration types, missing dates, and nonblank values that cannot be parsed. It reports the known source anomalies without hiding them. Passing this gate confirms **row preservation and the listed transformations**, not that all accounts are reconciled or every AUM judgment has been made.

Source values are untrusted data. CSV cells and document text must never be interpreted as instructions, SQL, or model policy.

## Reconciliation statuses

Every custodian observation and every Salesforce financial account receives one status in `reconciliation.account_status`. The first run covers all 128 source account rows. Candidate matches require the same custodian and normalized account number; only a one-to-one candidate can become `matched`.

| Status | Meaning |
| --- | --- |
| `matched` | A unique pair agrees on registration and advisor, Salesforce is open, and no value or advisor review flag applies. |
| `custodian_only` | No Salesforce financial account has the same custodian and normalized account number. Other source concerns still appear in reason codes. |
| `salesforce_only` | No custodian account has the same custodian and normalized account number. Other source concerns still appear in reason codes. |
| `conflicting` | A candidate key is duplicated, or a unique pair has an advisor, registration, Salesforce status, missing-value, unmapped-advisor, or negative-value concern. |

First run: 106 matched source rows (53 pairs), 5 custodian-only rows, 4 Salesforce-only rows, and 13 conflicting rows. The 22 non-matched source rows are the exception list. Reasons are stored as codes alongside each status; paired rows may both appear because each source record has its own status. No fuzzy name or partial tax-ID match is treated as proof.

## AUM

AUM comes from custodian market values, including accounts absent from Salesforce. The advisor is the custodian rep-code mapping; an unmapped code stays in an `Unmapped` bucket. The one blank value is excluded from numeric totals, not converted to zero. The duplicate Fidelity observations agree on value, date, advisor, registration, and owner context, so the account contributes once. An inconsistent duplicate would be excluded pending review. The negative value contributes as negative AUM and is flagged. Salesforce `Closed` or `Transferring` status does not erase a custodian-reported balance.

| Advisor | Fidelity, as of 2026-11-06 | Schwab, as of 2026-10-30 | Mixed-date sum |
| --- | ---: | ---: | ---: |
| Dana Whitfield | $12,849,108.51 | $4,235,166.93 | $17,084,275.44 |
| Marcus Lee | $12,640,535.52 | $3,022,067.60 | $15,662,603.12 |
| Priya Nair | $9,947,381.76 | $5,097,991.30 | $15,045,373.06 |
| Tom Alvarez | $11,031,094.98 | $7,756,134.82 | $18,787,229.80 |
| Unmapped | $0.00 | $2,406,435.92 | $2,406,435.92 |
| **Custodian total** | **$46,468,120.77** | **$22,517,796.57** | **$68,985,917.34** |

The combined $68,985,917.34 is a **mixed-date sum**, not a single point-in-time AUM figure. The AUM ledger contains 64 custodian account keys: 63 included (43 Fidelity, 20 Schwab) and one Fidelity key excluded for missing value. It retains the duplicate's two source rows and its one included amount for auditability.

## Judgment calls

- Keep the original exports intact in the local `data/` folder and preserve raw rows in the database.
- Use a shared normalized model for both custodians.
- Treat account identifiers as strings so formatting and leading zeros are preserved.
- Do not infer household ownership from names or partial tax identifiers alone; ambiguous links become exceptions for review.
- Use custodian plus normalized account number as the candidate key. Duplicate keys are conflicts even when their values agree; they are never silently treated as two accounts.
- Keep missing, unmapped, negative, and non-open records in the status results. AUM inclusion follows the stated custodian-value rules rather than Salesforce status.
- Record proposed changes locally. Do not write back to Salesforce or custodians.

The current run is a snapshot in `reconciliation.run`; later runs append new statuses and AUM decisions rather than overwriting prior run results. Core refresh remains a current-snapshot rebuild and needs versioning before production use.

## Next steps

1. Add tests for authorization and audit reversal behavior.
2. Add an offline AI provider with structured output validation and a visible model-input preview, if the assessment scope permits.

## Time log

- Started: 2026-11-18 16:36 PST (repository setup and write-up scaffolding).
- Ended: in progress.

## Operations app

The Netlify app lives in `web/` with server-side endpoints in `netlify/functions/api.mjs`. Neon Auth owns user credentials and sessions. The API verifies Neon JWT signatures against its published key set, then resolves the stable user ID through `reconciliation.app_user`. Advisors can read exceptions tied to households whose `primary_advisor_name` matches their mapping. Operations can read all exceptions, propose changes, approve or reject proposals, undo approvals, and inspect the audit log. The browser never receives `DATABASE_URL`.

Run `npm run db:app` once after the core model exists. The app migration creates these tables in `reconciliation`:

| Table | Purpose |
| --- | --- |
| `app_user` | Neon Auth user ID, app role, and Advisor mapping |
| `proposed_change` | Pending or decided app-only fix with rationale and actor |
| `account_household_resolution` | Active approved account-to-household overlays |
| `household_merge_resolution` | Active approved canonical household overlays |
| `exception_resolution` | Run-specific, reasoned dispositions for other exceptions |
| `change_audit` | Append-only API event history with actor, time, before/after values, and undo reference |

The app does not change `raw`, `core`, Salesforce, or custodian data. `current_exceptions` remains the source reconciliation finding even after a review decision. The separate review state is **Needs review**, **Awaiting approval**, **Household linked**, **Accepted as reported**, or **Source follow-up needed**. A household link only addresses a custodian-only account's household assignment; it does not create the missing Salesforce account. An accepted finding means Operations decided the reported difference needs no source change. A source follow-up decision records that the issue remains open with the upstream owner. An undo removes the active app overlay and records a reversing audit event. Existing overlays are never silently overwritten; a reviewer must undo an earlier approval first. Household merges require both households to have the same primary advisor, preserving Advisor visibility. Since `core` is a rebuildable snapshot, app state stores source IDs without foreign keys into it and checks current records when proposing and approving.

### Review workflow

| Tab | What it shows | What Operations does there |
| --- | --- | --- |
| **Exceptions** | Every source finding in the latest reconciliation run, its reason, and its separate review state | Propose a household link for a custodian-only account, or propose an explicit review outcome with supporting evidence |
| **Awaiting approval** | Pending proposals and active approved app decisions | Approve or reject a proposal, undo an approval, or propose a household merge |
| **History & audit** | Proposal, approval, rejection, and undo events, including actor, time, reason, and before/after values | Inspect the permanent decision trail |

A proposal does not change a review state to an approved outcome. Only approval writes an active resolution in `reconciliation` and an audit event. Advisors see the Exceptions tab for their households and cannot propose or approve. The three earlier smoke-test decisions were approved and undone; they remain in History & audit but there are no active resolutions from them.

### Local setup

1. Put `DATABASE_URL` and `NEON_AUTH_URL` in ignored `.env`. `npm run db:app` applies the app schema.
2. Run `node scripts/seed-test-users.mjs` to create the exercise accounts. It creates and keeps a shared, generated `TEST_USER_PASSWORD` in ignored `.env`; do not commit or use this password in production.
3. Run `npm run dev` for the Vite frontend. For frontend plus Netlify Functions locally, run `netlify dev` with Netlify CLI. The Auth URL is exposed as a public frontend config value; the database URL is server-only.
4. In Netlify, set `DATABASE_URL` and `NEON_AUTH_URL` as environment variables. Set Node 22 (see `.nvmrc`) and use the repository's `netlify.toml` build settings. Add the deployed Netlify origin to Neon Auth's trusted origins.

Test logins follow the `first.last@falcon.example` convention: `dana.whitfield`, `marcus.lee`, `priya.nair`, and `tom.alvarez`, plus `operations@falcon.example`. Use the local `.env` value of `TEST_USER_PASSWORD` for all five. These are exercise accounts; production requires individual Operations identities, unique credentials, and durable advisor IDs.

The current source files are a one-time snapshot. A later weekly import needs immutable batch IDs and review of active overlays against the new snapshot. Account links and exception dispositions are tied to a reconciliation run, so a new run does not inherit an approved review state. Household merges remain app-level mappings and should be reviewed after a source refresh. The audit log currently contains three labeled smoke-test proposals, each approved and undone; no active resolution remains.

## Future work: historical AUM dashboards

Historical AUM is **out of scope for this assessment**. The current importer replaces rows for a repeated filename, and the core refresh rebuilds current records. Therefore the present `core` tables and `reconciliation.current_*` views support a current snapshot, not a reliable week-by-week time series. A past `reconciliation.run` is retained, but its source and core context can change after a refresh.

Before loading recurring files for historical reporting, we would:

1. Create an immutable import batch for each received file, recording a batch ID, source, received timestamp, file checksum, source-reported valuation date, row count, and load status. Keep every original row with its batch ID and source row number; never replace a prior batch because its filename repeats. Reject or explicitly version duplicate deliveries.
2. Make `core` records batch-aware and dated. Preserve each custodian account observation and Salesforce account, household, advisor, and rep-code state as it was for that load, with stable warehouse keys and source lineage. Add durable advisor identifiers rather than relying on names. Define effective dates for changing household and advisor relationships so an old dashboard does not inherit today's mappings.
3. Build a dated account-value fact at the grain of **one custodian account per valuation date and accepted batch**, with a recorded duplicate/missing-value disposition. Use the custodian's valuation date for AUM, and retain the load timestamp separately. Reconciliation runs should reference the exact input batches and core versions they evaluated.
4. Publish governed reporting views or marts that join dated core facts to the applicable approved reconciliation decisions. Show source and effective household/advisor assignments separately, apply an explicit as-of rule, and make restatements reproducible. Approved app changes remain in `reconciliation`; they do not overwrite historical `core` records or write back to external systems.
5. Reconcile each new batch, review prior app resolutions against it, and test row coverage, duplicate handling, AUM totals, and changes between reporting dates before publishing a dashboard.

Until that work is done, dashboards should label these results as the **current assessment snapshot** and use the source `as_of_date` fields in the current AUM views. They should not imply that previous weekly AUM can be reconstructed from this model.
