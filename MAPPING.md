# Source field mapping

This is the field-by-field map from the export headers. Both custodians now load into `core.custodian_account`; Salesforce loads into `core.household` and `core.salesforce_account`. `No direct field` means the Salesforce export does not contain an equivalent field. The full tax ID remains in `raw` and is reduced to last four digits in `core`.

## Fidelity

| Fidelity field | Shared model field | Salesforce field or gap |
| --- | --- | --- |
| `Acct Number` | `account_number_raw`, `account_number_key` | `core.salesforce_account.account_number_raw`, `account_number_key`; normalize cautiously, preserve raw value. |
| `Registration` | `registration_raw`, `registration_type` | `core.salesforce_account.registration_raw`, `registration_type`; source vocabulary is standardized. |
| `Primary Owner` | `primary_owner` | Possible context in `core.household.household_name`; no exact owner field. |
| `Joint Owner` | `joint_owner` | No direct field. |
| `Tax ID` | `tax_id_last4` only; full value stays in `raw` | No direct field; do not expose in logs or model input. |
| `Market Value` | `market_value` | No direct field in the Salesforce export. |
| `As Of` | `value_date` | No direct field in the Salesforce export. |
| `Rep Code` | `rep_code`, `advisor_name` | `core.rep_code` maps to `advisor_name`; compare with `core.household.primary_advisor_name`. |

## Schwab

| Schwab field | Shared model field | Salesforce field or gap |
| --- | --- | --- |
| `account_id` | `account_number_raw`, `account_number_key` | `core.salesforce_account.account_number_raw`, `account_number_key`; normalize cautiously, preserve raw value. |
| `account_title` | `account_title` | Possible context in `core.household.household_name`; no exact title field. |
| `account_type` | `registration_raw`, `registration_type` | `core.salesforce_account.registration_raw`, `registration_type`; source vocabulary is standardized. |
| `total_value` | `market_value` | No direct field in the Salesforce export. |
| `value_date` | `value_date` | No direct field in the Salesforce export. |
| `advisor_code` | `rep_code`, `advisor_name` | `core.rep_code` maps to `advisor_name`; compare with `core.household.primary_advisor_name`. |
| `ssn_last4` | `tax_id_last4` (sensitive) | No direct field; partial identifier is insufficient for a unique match. |

## Salesforce relationship and conflicts to inspect

`sf_financial_accounts.Household__c` links to `sf_households.Id`. The financial account export also supplies `Id`, `Custodian__c`, `Status__c`, and `Notes__c`; the household export supplies `Primary_Email__c` and `CreatedDate`. These are source or review fields, not custodian equivalents. Matching must check the Salesforce custodian alongside account number because the two custodian exports share one model. Missing rep-code mappings, inconsistent registration labels, and duplicate account identifiers will be explicit exceptions.
