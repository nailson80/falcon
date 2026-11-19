# Falcon account reconciliation

Work in progress for the Falcon Wealth Planning full-stack take-home assessment.

## Run

The five source CSV files belong in `data/`, which is ignored by Git. Do not commit source data, database dumps, or credentials.

1. Run `npm install`.
2. Run `npm run db:check` to validate CSV headers and row widths locally.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` to the Neon PostgreSQL connection string.
4. Run `npm run db:import` from the project root.

The import creates five tables in the `raw` schema, one per CSV. Every source field is stored as text, alongside the source filename, CSV row number, and import timestamp. The import validates exact headers and row widths before connecting. It replaces rows for these five source filenames in one transaction, so rerunning it does not duplicate rows. The application and normalized model remain to be built.

## Data model

Planned layers:

1. Preserve each source row and its source file, row number, and import time in the five `raw` schema tables.
2. Normalize Fidelity and Schwab rows into one custodian-account model with account identifier, custodian, registration, owners, advisor code, market value, and value date.
3. Keep Salesforce households and financial accounts as separate entities, linked by Salesforce household ID.
4. Store reconciliation results and proposed resolutions separately from source records. Record approvals and reversals in an audit log.

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

1. Build the normalized schema on top of the raw Neon PostgreSQL import tables.
2. Implement deterministic matching, exception reasons, and AUM aggregation.
3. Add role-enforced exception review, approval, undo, and audit logging.
4. Add an offline AI provider with structured output validation and a visible model-input preview.
5. Test matching, authorization, and audit reversal behavior.

## Time log

- Started: 2026-11-18 16:36 PST (repository setup and write-up scaffolding).
- Ended: in progress.
