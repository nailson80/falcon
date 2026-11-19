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

The import creates five tables in the `raw` schema, one per CSV. Every source field is stored as text, alongside the source filename, CSV row number, and import timestamp. The import validates exact headers and row widths before connecting. It replaces rows for these five source filenames in one transaction, so rerunning it does not duplicate rows. The application and reconciliation logic remain to be built.

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
4. The empty `reconciliation` schema is reserved for statuses, exceptions, proposed fixes, and audit history. Matching and approval decisions will live there, separate from source facts.

The current `db:core` refresh rebuilds the current source snapshot atomically. Before adding downstream foreign keys or historical snapshots, replace this with an incremental, versioned load. Advisor names serve as the available business key because the exports contain no advisor ID; a production warehouse should add a durable advisor identifier.

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

Proposed categories, to refine once matching rules are implemented:

| Status | Meaning |
| --- | --- |
| Matched | A unique custodian account corresponds to a Salesforce financial account without a material conflict. |
| Custodian only | No corresponding Salesforce financial account was found. |
| Salesforce only | No corresponding custodian account was found. |
| Conflicting | A candidate match has incompatible fields or ambiguous ownership. |

## AUM

Not calculated yet. The implementation will report totals by advisor and custodian, with source-specific value dates and an explicit overall as-of convention. It will avoid summing duplicate or ambiguous account rows without a documented rule.

## Judgment calls

- Keep the original exports intact in the local `data/` folder and preserve raw rows in the database.
- Use a shared normalized model for both custodians.
- Treat account identifiers as strings so formatting and leading zeros are preserved.
- Do not infer household ownership from names or partial tax identifiers alone; ambiguous links become exceptions for review.
- Record proposed changes locally. Do not write back to Salesforce or custodians.

Further matching, valuation, and duplicate-handling decisions will be documented here as they are made.

## Next steps

1. Implement deterministic matching, exception reasons, and AUM aggregation in `reconciliation`.
2. Add role-enforced exception review, approval, undo, and audit logging.
3. Add an offline AI provider with structured output validation and a visible model-input preview.
4. Test matching, authorization, and audit reversal behavior.

## Time log

- Started: 2026-11-18 16:36 PST (repository setup and write-up scaffolding).
- Ended: in progress.
