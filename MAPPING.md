# Source field mapping

This is the initial field-by-field map from the export headers. Transformations and Salesforce matching rules will be confirmed during implementation. `No direct field` means the Salesforce export does not contain an equivalent field.

## Fidelity

| Fidelity field | Shared model field | Salesforce field or gap |
| --- | --- | --- |
| `Acct Number` | `account_number_raw`, `account_number_normalized` | `sf_financial_accounts.Account_Number__c`; normalize cautiously, preserve raw value. |
| `Registration` | `registration` | `sf_financial_accounts.Registration_Type__c`; vocabulary may differ. |
| `Primary Owner` | `primary_owner_name` | Possible household name context in `sf_households.Name`; no exact owner field. |
| `Joint Owner` | `joint_owner_name` | No direct field. |
| `Tax ID` | `tax_id_raw` (sensitive) | No direct field; do not expose in logs or model input. |
| `Market Value` | `market_value` | No direct field in the Salesforce export. |
| `As Of` | `value_date` | No direct field in the Salesforce export. |
| `Rep Code` | `advisor_code` | `rep_codes.rep_code` plus `rep_codes.custodian` maps to `advisor_name`; compare with `sf_households.Primary_Advisor__c`. |

## Schwab

| Schwab field | Shared model field | Salesforce field or gap |
| --- | --- | --- |
| `account_id` | `account_number_raw`, `account_number_normalized` | `sf_financial_accounts.Account_Number__c`; normalize cautiously, preserve raw value. |
| `account_title` | `account_title` | Possible household name context in `sf_households.Name`; no exact title field. |
| `account_type` | `registration` | `sf_financial_accounts.Registration_Type__c`; vocabulary may differ. |
| `total_value` | `market_value` | No direct field in the Salesforce export. |
| `value_date` | `value_date` | No direct field in the Salesforce export. |
| `advisor_code` | `advisor_code` | `rep_codes.rep_code` plus `rep_codes.custodian` maps to `advisor_name`; compare with `sf_households.Primary_Advisor__c`. |
| `ssn_last4` | `tax_id_last4` (sensitive) | No direct field; partial identifier is insufficient for a unique match. |

## Salesforce relationship and conflicts to inspect

`sf_financial_accounts.Household__c` links to `sf_households.Id`. The financial account export also supplies `Id`, `Custodian__c`, `Status__c`, and `Notes__c`; the household export supplies `Primary_Email__c` and `CreatedDate`. These are source or review fields, not custodian equivalents. Matching must check the Salesforce custodian alongside account number because the two custodian exports share one model. Missing rep-code mappings, inconsistent registration labels, and duplicate account identifiers will be explicit exceptions.
