import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReconciliation } from '../src/reconcile.mjs';

const custodian = (overrides = {}) => ({ custodian: 'Fidelity', source_file: 'f.csv', source_row: 2,
  account_number_raw: '001', account_number_key: '001', registration_type: 'IRA', account_title: null,
  primary_owner: 'A', joint_owner: null, tax_id_last4: '1234', rep_code: 'R', advisor_name: 'Advisor A',
  market_value: '100.00', value_date: '2026-11-06', ...overrides });
const salesforce = (overrides = {}) => ({ custodian: 'Fidelity', source_file: 's.csv', source_row: 2,
  sf_account_id: 'SF1', account_number_key: '001', registration_type: 'IRA', sf_status: 'Open',
  household_advisor_name: 'Advisor A', ...overrides });

test('unique consistent pair is matched on both sides', () => {
  const result = buildReconciliation([custodian()], [salesforce()]);
  assert.deepEqual(result.statuses.map((row) => row.status), ['matched', 'matched']);
  assert.equal(result.aumAccounts[0].disposition, 'included');
});

test('duplicate custodian observations remain separate but enter AUM once', () => {
  const result = buildReconciliation([custodian(), custodian({ source_row: 3 })], [salesforce()]);
  assert.deepEqual(result.statuses.map((row) => row.status), ['conflicting', 'conflicting', 'conflicting']);
  assert.equal(result.aumAccounts[0].source_rows, 2);
  assert.equal(result.aumAccounts[0].market_value, '100.00');
});

test('inconsistent duplicate is excluded from AUM', () => {
  const result = buildReconciliation([custodian(), custodian({ source_row: 3, market_value: '200.00' })], []);
  assert.equal(result.aumAccounts[0].disposition, 'excluded_inconsistent_duplicate');
  assert.equal(result.aumAccounts[0].market_value, null);
});

test('missing value and unmapped advisor remain visible without invented values', () => {
  const result = buildReconciliation([custodian({ market_value: null, advisor_name: null })], [salesforce()]);
  assert.equal(result.statuses[0].status, 'conflicting');
  assert.deepEqual(result.statuses[0].reason_codes, ['UNMAPPED_ADVISOR', 'MISSING_MARKET_VALUE']);
  assert.equal(result.aumAccounts[0].disposition, 'excluded_missing_value');
});

test('custodian-only and Salesforce-only accounts receive explicit reasons', () => {
  const result = buildReconciliation([custodian()], [salesforce({ account_number_key: '002' })]);
  assert.equal(result.statuses[0].status, 'custodian_only');
  assert.equal(result.statuses[1].status, 'salesforce_only');
  assert.ok(result.statuses[0].reason_codes.includes('NO_SALESFORCE_ACCOUNT'));
  assert.ok(result.statuses[1].reason_codes.includes('NO_CUSTODIAN_ACCOUNT'));
});

test('advisor mismatch and non-open Salesforce status conflict on both sides', () => {
  const result = buildReconciliation([custodian({ advisor_name: 'Advisor B' })],
    [salesforce({ sf_status: 'Transferring' })]);
  assert.deepEqual(result.statuses.map((row) => row.status), ['conflicting', 'conflicting']);
  for (const row of result.statuses) {
    assert.ok(row.reason_codes.includes('ADVISOR_MISMATCH'));
    assert.ok(row.reason_codes.includes('SALESFORCE_NOT_OPEN'));
  }
  assert.equal(result.aumAccounts[0].disposition, 'included');
});

test('negative balance is flagged and retained as negative AUM', () => {
  const result = buildReconciliation([custodian({ market_value: '-12500.00' })], [salesforce()]);
  assert.equal(result.statuses[0].status, 'conflicting');
  assert.ok(result.statuses[0].reason_codes.includes('NEGATIVE_MARKET_VALUE'));
  assert.equal(result.aumAccounts[0].market_value, '-12500.00');
  assert.equal(result.aumAccounts[0].disposition, 'included');
});
