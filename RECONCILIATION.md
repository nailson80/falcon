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

## How to review or rerun

`npm run db:reconcile` appends a run. Query `reconciliation.current_account_status` for every source account and `reconciliation.current_exceptions` for the latest exception list. `reconciliation.current_aum_by_advisor_custodian` and `reconciliation.current_aum_by_custodian` provide the latest totals with source-specific `as_of_date` fields. The matching and AUM rules are documented in [README.md](README.md).
