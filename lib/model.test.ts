import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped,
  appendAudit,
  createSeedState,
  dateFromToday,
  getCalibrationState,
  readingResult,
  verifyAuditChain,
  type GaugeRecord,
} from './model';

function gauge(overrides: Partial<GaugeRecord> = {}): GaugeRecord {
  return {
    id: 'g-1',
    assetId: 'G-001',
    token: 'opaque',
    name: 'Test gauge',
    type: 'measuring-equipment',
    manufacturer: '',
    model: '',
    serial: '',
    range: '',
    unit: '',
    location: '',
    custodian: '',
    custodianEmail: '',
    intervalMonths: 12,
    dueSoonDays: 14,
    lastCalibrated: dateFromToday(-30),
    nextDue: dateFromToday(30),
    lifecycle: 'active',
    procedure: '',
    notes: '',
    attachmentIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('calibration date engine', () => {
  it('clamps month-end intervals rather than rolling into the next month', () => {
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2027-01-31', 1)).toBe('2027-02-28');
  });

  it('treats the due date as due-soon and the following day as overdue', () => {
    expect(getCalibrationState(gauge({ nextDue: dateFromToday(14) }))).toBe('due-soon');
    expect(getCalibrationState(gauge({ nextDue: dateFromToday(0) }))).toBe('due-soon');
    expect(getCalibrationState(gauge({ nextDue: dateFromToday(-1) }))).toBe('overdue');
  });

  it('prioritizes failed and restricted lifecycle states over date state', () => {
    expect(getCalibrationState(gauge({ lifecycle: 'out-of-service', nextDue: dateFromToday(100) }))).toBe('failed');
    expect(getCalibrationState(gauge({ lifecycle: 'restricted', nextDue: dateFromToday(100) }))).toBe('conditional');
  });

  it('evaluates as-left when supplied and as-found otherwise', () => {
    const base = { id: 'r', characteristic: 'Length', nominal: '10', lowerLimit: '9.9', upperLimit: '10.1', unit: 'mm' };
    expect(readingResult({ ...base, asFound: '10.2', asLeft: '10.0' })).toBe('pass');
    expect(readingResult({ ...base, asFound: '10.2', asLeft: '' })).toBe('fail');
  });
});

describe('audit integrity', () => {
  it('creates and verifies a linked SHA-256 history', () => {
    const first = appendAudit([], { actor: 'Tester', action: 'gauge.created', entityType: 'gauge', entityId: 'g-1', summary: 'Created' });
    const second = appendAudit(first, { actor: 'Tester', action: 'gauge.updated', entityType: 'gauge', entityId: 'g-1', summary: 'Updated', after: { serial: '123' } });
    expect(verifyAuditChain(second)).toBe(true);
    expect(second[1].previousHash).toBe(second[0].hash);
    expect(second[0].hash).toHaveLength(64);
  });

  it('detects a changed historical entry', () => {
    const audit = createSeedState().audit.map((entry) => ({ ...entry }));
    audit[0].summary = 'Silently changed';
    expect(verifyAuditChain(audit)).toBe(false);
  });
});
