# Reconciliation run 1

The first run classified all 65 custodian observations and 63 Salesforce financial accounts. The 22 source rows below are every exception in `reconciliation.current_exceptions`. Source row numbers include the CSV header as row 1; they allow an authorized reviewer to locate the record locally without publishing account numbers, owners, tax IDs, or notes.

| Source record | Status | Reason |
| --- | --- | --- |
| Fidelity CSV row 7 | Custodian only | No Salesforce financial account with the same custodian and normalized account number. |
| Fidelity CSV row 8 | Custodian only | No Salesforce financial account with the same custodian and normalized account number. |
| Fidelity CSV row 17 | Conflicting | Custodian advisor differs from the linked Salesforce household advisor. |
| Fidelity CSV row 20 | Conflicting | Negative market value needs review; it remains a negative AUM contribution. |
| Fidelity CSV row 28 | Custodian only | No Salesforce financial account with the same custodian and normalized account number. |
| Fidelity CSV row 31 | Conflicting | Duplicate custodian account key; this row and row 38 are both preserved. |
| Fidelity CSV row 36 | Conflicting | Market value is blank; account remains in results but contributes no AUM. |
| Fidelity CSV row 38 | Conflicting | Duplicate custodian account key; this row and row 31 are both preserved. |
| Schwab CSV row 7 | Conflicting | Rep code has no advisor mapping. Its value appears in the `Unmapped` AUM bucket. |
| Schwab CSV row 11 | Conflicting | Linked Salesforce financial account is not `Open`. |
| Schwab CSV row 15 | Custodian only | No Salesforce financial account with the same custodian and normalized account number. |
| Schwab CSV row 18 | Custodian only | No Salesforce financial account with the same custodian and normalized account number. |
| Salesforce financial accounts CSV row 8 | Salesforce only | No custodian account with the same custodian and normalized account number. |
| Salesforce financial accounts CSV row 9 | Conflicting | Matched Schwab account has an unmapped advisor code. |
| Salesforce financial accounts CSV row 16 | Conflicting | Its candidate Fidelity account key occurs in two custodian rows. |
| Salesforce financial accounts CSV row 23 | Conflicting | Matched Fidelity advisor differs from the household advisor. |
| Salesforce financial accounts CSV row 31 | Salesforce only | No custodian account with the same custodian and normalized account number. |
| Salesforce financial accounts CSV row 34 | Conflicting | Matched Fidelity account has a blank market value. |
| Salesforce financial accounts CSV row 38 | Salesforce only | No custodian account with the same custodian and normalized account number. |
| Salesforce financial accounts CSV row 39 | Conflicting | Matched Fidelity account has a negative market value. |
| Salesforce financial accounts CSV row 42 | Conflicting | Salesforce financial account is not `Open`. |
| Salesforce financial accounts CSV row 61 | Salesforce only | No custodian account, and Salesforce status is not `Open`. |

## Additional cross-record review leads

These are **candidate relationships**, not automatic matches. The strict matching rule above still classifies the source rows as exceptions until Operations verifies the source records. They do not change the published per-custodian AUM totals.

| Candidate | Evidence and current result | Judgment / next review |
| --- | --- | --- |
| Leading zero lost | Schwab row 15 and Salesforce financial account row 31 have the same digits except for one leading zero, and both identify Schwab. Current statuses are custodian-only and Salesforce-only because the normalized keys differ. | Likely spreadsheet or CRM formatting loss. Confirm against source documents before linking; never strip leading zeros globally because they can be meaningful. |
| Custodian recorded incorrectly | Fidelity row 28 and Salesforce financial account row 8 have the same normalized account number, but Salesforce records **Schwab**. The account and household context point toward the same relationship, while the custodian field conflicts. | Verify which Salesforce custodian is correct before proposing a source correction. Keep both source-only exceptions until confirmed. |
| Possible in-flight ACAT overlap | Schwab row 11 reports $2,210,400.00 on 2026-10-30 and its Salesforce account row 42 is `Transferring`; the note references an ACAT to Fidelity. Fidelity row 8 reports $2,198,775.42 on 2026-11-06 for a trust with the same owner and advisor context but a different account number. | Possible transfer of the same assets, not proven from these exports. Both balances remain in their dated custodian totals. The $68,985,917.34 mixed-date sum may overstate distinct assets by about $2.2 million; do not use it as a single-date firm AUM without transfer verification. |
| Possible duplicate Salesforce households | `sf_households.csv` rows 12 and 32 have variant names, the same email, and the same primary advisor. | Review household IDs and underlying records before an app-only merge. Household duplicates are **not** currently part of `reconciliation.current_exceptions`, which covers financial-account rows; this remains a coverage gap for a future household quality queue. |

## How to review or rerun

`npm run db:reconcile` appends a run. Query `reconciliation.current_account_status` for every source account and `reconciliation.current_exceptions` for the latest exception list. `reconciliation.current_aum_by_advisor_custodian` and `reconciliation.current_aum_by_custodian` provide the latest totals with source-specific `as_of_date` fields. The matching and AUM rules are documented in [README.md](README.md).

## App review state

The Netlify app displays the latest `reconciliation.current_exceptions` alongside a separate review state: **Needs review**, **Awaiting approval**, **Household linked**, **Accepted as reported**, or **Source follow-up needed**. The source finding remains visible after approval. Proposals and decisions live in `reconciliation.proposed_change`; active app overlays are in `reconciliation.account_household_resolution`, `reconciliation.household_merge_resolution`, and `reconciliation.exception_resolution`. Every proposal, approval, rejection, and undo is recorded in `reconciliation.change_audit`. See the Operations app section of `README.md` for the three app tabs and workflow.
