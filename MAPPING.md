# Source field mapping

Both custodian exports load into one shared `core.custodian_account` table. Salesforce loads into `core.salesforce_account` and `core.household`; advisor codes load into `core.rep_code`. Every core row retains its source filename and CSV row number. The original text remains in `raw`. Source values are data only, never instructions.

Candidate account matches require **both** custodian and normalized account number, with a unique candidate on each side. Registration and advisor are compared after that link is established. Names and partial tax IDs provide review context, not proof of a link. The tables below describe `sql/003_refresh_core.sql` and identify the exact Salesforce fields where available.

## Fidelity: `fidelity_accounts_2026-11-06.csv`

| CSV field | Shared core field and transform | Salesforce counterpart | Gap or conflict |
| --- | --- | --- | --- |
| `Acct Number` | `account_number_raw` preserves the value; `account_number_key` trims, uppercases, and removes nonalphanumeric characters. | `sf_financial_accounts.Account_Number__c` → `core.salesforce_account.account_number_raw`, `account_number_key`; also require `Custodian__c`. | A candidate key, not proof of uniqueness. Fidelity rows 31 and 38 have the same key; both remain in core and the value enters AUM once. |
| `Registration` | `registration_raw` preserves the label; `registration_type` maps known labels to `Individual`, `Joint`, `IRA`, `Roth IRA`, `SEP IRA`, or `Trust`. | `sf_financial_accounts.Registration_Type__c` → `registration_raw`, `registration_type`. | Vocabulary differs across sources. Compare standard values; unknown values fail the quality gate. |
| `Primary Owner` | `primary_owner` preserves source text. | No exact field. `sf_households.Name` → `core.household.household_name` is context only. | Do not infer a household link from names. |
| `Joint Owner` | `joint_owner`; blank becomes null. | No direct field. | Cannot verify joint owner from these Salesforce exports. |
| `Tax ID` | Only the last four digits after removing nondigits become `tax_id_last4`; full value stays in `raw` and ignored CSV. | No direct field. | Sensitive and nonunique; never use alone for matching or expose in logs or model input. |
| `Market Value` | `market_value` parses to `numeric(20,2)`; blank or invalid text becomes null. | No Salesforce balance field. | One blank remains null and is excluded from numeric AUM; one negative remains negative in AUM. Nonblank parse failures fail quality checks. |
| `As Of` | `value_date` parses from `MM/DD/YYYY` to `date`. | No Salesforce balance date; `sf_households.CreatedDate` is unrelated. | Fidelity values are dated 2026-11-06; combined AUM with Schwab is mixed-date. |
| `Rep Code` | `rep_code` preserves the code; `advisor_name` comes from `rep_codes.csv` on `(custodian, rep_code)`. | `sf_households.Primary_Advisor__c` → `core.household.primary_advisor_name`, via `sf_financial_accounts.Household__c`. | Compare advisors only for a linked account. Fidelity row 17 and its Salesforce counterpart row 23 disagree. No durable advisor ID is supplied. |

## Schwab: `schwab_balances_20261030.csv`

| CSV field | Shared core field and transform | Salesforce counterpart | Gap or conflict |
| --- | --- | --- | --- |
| `account_id` | `account_number_raw` preserves the value; `account_number_key` uses the same normalization as Fidelity. | `sf_financial_accounts.Account_Number__c` → `account_number_raw`, `account_number_key`, with `Custodian__c`. | Candidate only; require one-to-one uniqueness. |
| `account_title` | `account_title` preserves source text. | No exact field. `sf_households.Name` → `core.household.household_name` is context only. | Title is not a reliable household key. |
| `account_type` | `registration_raw` preserves the label; `registration_type` uses shared standardization. | `sf_financial_accounts.Registration_Type__c` → `registration_raw`, `registration_type`. | Compare standardized types; disagreement is a conflict. |
| `total_value` | `market_value` parses to `numeric(20,2)`. | No Salesforce balance field. | Salesforce cannot validate balance or AUM; nonblank parse failures fail quality checks. |
| `value_date` | `value_date` parses to `date`. | No Salesforce balance date; `sf_households.CreatedDate` is unrelated. | Schwab values are dated 2026-10-30; combined AUM is mixed-date. |
| `advisor_code` | `rep_code` preserves the code; `advisor_name` comes from `rep_codes.csv` on `(custodian, rep_code)`. | `sf_households.Primary_Advisor__c` → `core.household.primary_advisor_name` through a matched Salesforce account. | Schwab row 7 has no code mapping. Advisor stays null; value remains in `Unmapped` AUM. |
| `ssn_last4` | `tax_id_last4`; trimmed blank becomes null. | No direct field. | Partial sensitive identifier; insufficient for a unique match. |

## Salesforce and advisor reference fields

| CSV field | Core field | Role or gap |
| --- | --- | --- |
| `sf_financial_accounts.Id` | `core.salesforce_account.sf_account_id` | Salesforce account key; no custodian equivalent. |
| `sf_financial_accounts.Household__c` | `core.salesforce_account.sf_household_id` | References `sf_households.Id`; custodian exports have no household ID. |
| `sf_financial_accounts.Account_Number__c` | `account_number_raw`, `account_number_key` | Candidate match field, with custodian and uniqueness. |
| `sf_financial_accounts.Custodian__c` | `core.salesforce_account.custodian` | Required match dimension. |
| `sf_financial_accounts.Registration_Type__c` | `registration_raw`, `registration_type` | Standardized comparison to custodian registration. |
| `sf_financial_accounts.Status__c` | `core.salesforce_account.sf_status` | No custodian equivalent. `Closed` and `Transferring` stay in core and can cause conflicts. |
| `sf_financial_accounts.Notes__c` | `core.salesforce_account.notes` | Untrusted context only, not matching evidence or instructions. |
| `sf_households.Id` | `core.household.sf_household_id` | Household key; no custodian equivalent. |
| `sf_households.Name` | `core.household.household_name` | Display context; not a unique account match key. |
| `sf_households.Primary_Advisor__c` | `core.household.primary_advisor_name` | Compare to mapped custodian advisor; names are the available key until a durable ID exists. |
| `sf_households.Primary_Email__c` | `core.household.primary_email` | Household contact email, not advisor login or identity. |
| `sf_households.CreatedDate` | `core.household.created_date` | Household creation date, not AUM as-of date. |
| `rep_codes.rep_code` | `core.rep_code.rep_code` | Advisor code lookup. |
| `rep_codes.custodian` | `core.rep_code.custodian` | Required part of the code lookup key. |
| `rep_codes.advisor_name` | `core.rep_code.advisor_name`; also seeds `core.advisor` | Name-based mapping; missing codes remain unmapped rather than guessed. |

## Coverage and consequences

The latest quality check found 45 Fidelity observations, 20 Schwab observations, 63 Salesforce accounts, 34 households, and 8 rep-code mappings. Every CSV row is present in `raw` and every `raw` row in `core`; the check found zero omissions or cell mismatches. This confirms preservation, not agreement. The 22 source exceptions and reasons are listed in [RECONCILIATION.md](RECONCILIATION.md) and queryable in `reconciliation.current_exceptions`. App review decisions are separate from source findings.
