const keyOf = (row) => `${row.custodian}\u001f${row.account_number_key}`;

function groupByKey(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function sameAumObservation(a, b) {
  return ['market_value', 'value_date', 'advisor_name', 'rep_code', 'registration_type',
    'account_number_raw', 'account_title', 'primary_owner', 'joint_owner', 'tax_id_last4']
    .every((field) => String(a[field] ?? '') === String(b[field] ?? ''));
}

export function buildReconciliation(custodianRows, salesforceRows) {
  const custodianGroups = groupByKey(custodianRows);
  const salesforceGroups = groupByKey(salesforceRows);
  const statuses = [];
  const aumAccounts = [];

  for (const row of custodianRows) {
    const custodians = custodianGroups.get(keyOf(row));
    const salesforce = salesforceGroups.get(keyOf(row)) ?? [];
    const counterpart = salesforce.length === 1 ? salesforce[0] : null;
    const reasons = [];
    if (custodians.length > 1) reasons.push('DUPLICATE_CUSTODIAN_KEY');
    if (salesforce.length > 1) reasons.push('DUPLICATE_SALESFORCE_KEY');
    if (!salesforce.length) reasons.push('NO_SALESFORCE_ACCOUNT');
    if (row.advisor_name == null) reasons.push('UNMAPPED_ADVISOR');
    if (row.market_value == null) reasons.push('MISSING_MARKET_VALUE');
    if (row.market_value != null && Number(row.market_value) < 0) reasons.push('NEGATIVE_MARKET_VALUE');
    if (counterpart && custodians.length === 1) {
      if (row.registration_type !== counterpart.registration_type) reasons.push('REGISTRATION_MISMATCH');
      if (row.advisor_name != null && row.advisor_name !== counterpart.household_advisor_name) reasons.push('ADVISOR_MISMATCH');
      if (counterpart.sf_status !== 'Open') reasons.push('SALESFORCE_NOT_OPEN');
    }
    const status = custodians.length > 1 || salesforce.length > 1 ? 'conflicting'
      : !salesforce.length ? 'custodian_only'
      : reasons.length ? 'conflicting' : 'matched';
    statuses.push({ source_kind: 'custodian', source_file: row.source_file, source_row: row.source_row,
      custodian: row.custodian, account_number_key: row.account_number_key, sf_account_id: counterpart?.sf_account_id ?? null,
      status, reason_codes: reasons, counterpart_source_file: counterpart?.source_file ?? null,
      counterpart_source_row: counterpart?.source_row ?? null });
  }

  for (const row of salesforceRows) {
    const custodians = custodianGroups.get(keyOf(row)) ?? [];
    const salesforce = salesforceGroups.get(keyOf(row));
    const counterpart = custodians.length === 1 ? custodians[0] : null;
    const reasons = [];
    if (custodians.length > 1) reasons.push('DUPLICATE_CUSTODIAN_KEY');
    if (salesforce.length > 1) reasons.push('DUPLICATE_SALESFORCE_KEY');
    if (!custodians.length) reasons.push('NO_CUSTODIAN_ACCOUNT');
    if (row.sf_status !== 'Open') reasons.push('SALESFORCE_NOT_OPEN');
    if (counterpart && salesforce.length === 1) {
      if (counterpart.registration_type !== row.registration_type) reasons.push('REGISTRATION_MISMATCH');
      if (counterpart.advisor_name == null) reasons.push('UNMAPPED_ADVISOR');
      else if (counterpart.advisor_name !== row.household_advisor_name) reasons.push('ADVISOR_MISMATCH');
      if (counterpart.market_value == null) reasons.push('MISSING_MARKET_VALUE');
      if (counterpart.market_value != null && Number(counterpart.market_value) < 0) reasons.push('NEGATIVE_MARKET_VALUE');
    }
    const status = custodians.length > 1 || salesforce.length > 1 ? 'conflicting'
      : !custodians.length ? 'salesforce_only'
      : reasons.length ? 'conflicting' : 'matched';
    statuses.push({ source_kind: 'salesforce', source_file: row.source_file, source_row: row.source_row,
      custodian: row.custodian, account_number_key: row.account_number_key, sf_account_id: row.sf_account_id,
      status, reason_codes: reasons, counterpart_source_file: counterpart?.source_file ?? null,
      counterpart_source_row: counterpart?.source_row ?? null });
  }

  for (const rows of custodianGroups.values()) {
    const first = rows[0];
    const consistent = rows.every((row) => sameAumObservation(first, row));
    const disposition = !consistent ? 'excluded_inconsistent_duplicate'
      : first.market_value == null ? 'excluded_missing_value' : 'included';
    const reasonCodes = [];
    if (rows.length > 1) reasonCodes.push('DUPLICATE_CUSTODIAN_KEY');
    if (!consistent) reasonCodes.push('INCONSISTENT_DUPLICATE');
    if (first.market_value == null) reasonCodes.push('MISSING_MARKET_VALUE');
    if (first.advisor_name == null) reasonCodes.push('UNMAPPED_ADVISOR');
    if (first.market_value != null && Number(first.market_value) < 0) reasonCodes.push('NEGATIVE_MARKET_VALUE');
    aumAccounts.push({ custodian: first.custodian, account_number_key: first.account_number_key,
      advisor_name: first.advisor_name, value_date: first.value_date, market_value: consistent ? first.market_value : null,
      source_rows: rows.length, disposition, reason_codes: reasonCodes });
  }
  return { statuses, aumAccounts };
}
