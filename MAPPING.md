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

| Salesforce source field | Core field | Role |
| --- | --- | --- |
| `sf_households.Id` | `core.household.sf_household_id` | Household business key. |
| `sf_households.Name` | `core.household.household_name` | Context only; not a unique custodian match key. |
| `sf_households.Primary_Advisor__c` | `core.household.primary_advisor_name` | Advisor comparison. |
| `sf_households.Primary_Email__c` | `core.household.primary_email` | Retained for operations context; not sent to AI. |
| `sf_households.CreatedDate` | `core.household.created_date` | Typed date; original text remains in `raw`. |
| `sf_financial_accounts.Id` | `core.salesforce_account.sf_account_id` | Salesforce account business key. |
| `sf_financial_accounts.Household__c` | `core.salesforce_account.sf_household_id` | Foreign key to household. |
| `sf_financial_accounts.Account_Number__c` | `account_number_raw`, `account_number_key` | Candidate match with custodian and uniqueness check. |
| `sf_financial_accounts.Custodian__c` | `core.salesforce_account.custodian` | Required part of matching. |
| `sf_financial_accounts.Registration_Type__c` | `registration_raw`, `registration_type` | Original and standardized type. |
| `sf_financial_accounts.Status__c` | `core.salesforce_account.sf_status` | Retained even for `Closed` or `Transferring`. |
| `sf_financial_accounts.Notes__c` | `core.salesforce_account.notes` | Retained source context; untrusted text. |

`sf_financial_accounts.Household__c` links to `sf_households.Id`. Missing rep-code mappings, duplicate account identifiers, blank market values, and status differences remain visible for explicit reconciliation rules. The quality gate verifies that no raw row is absent from `core`.
