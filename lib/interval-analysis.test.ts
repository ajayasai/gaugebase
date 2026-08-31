import { describe, expect, it } from 'vitest';
import { recommendCalibrationInterval } from './interval-analysis';
import { createSeedState, type CalibrationRecord } from './model';

function records(
  gaugeId: string,
  results: CalibrationRecord['result'][],
): CalibrationRecord[] {
  return results.map((result, index) => ({
    id: `cal-${index}`,
    eventNumber: `EVT-${index}`,
    gaugeId,
    performedOn: `2026-0${Math.max(1, 9 - index)}-01`,
    result,
    technician: 'A',
    procedureRevision: 'P1',
    environmentalConditions: '',
    standardReferences: 'S1',
    readings: [],
    notes: '',
    certificateNumber: `C-${index}`,
    certificateHash: 'hash',
    attachmentIds: [],
    createdAt: '2026-08-31T00:00:00.000Z',
  }));
}

describe('interval recommendations', () => {
  it('shortens after a recent failure', () => {
    const gauge = { ...createSeedState().gauges[0], intervalMonths: 12 };
    const result = recommendCalibrationInterval(
      gauge,
      records(gauge.id, ['fail', 'pass', 'pass', 'pass']),
    );
    expect(result.direction).toBe('shorten');
    expect(result.recommendedMonths).toBeLessThan(12);
  });

  it('extends only after a stable pass streak', () => {
    const gauge = {
      ...createSeedState().gauges[0],
      intervalMonths: 12,
      criticality: 'medium' as const,
    };
    const result = recommendCalibrationInterval(
      gauge,
      records(gauge.id, ['pass', 'pass', 'pass', 'pass', 'pass', 'pass']),
    );
    expect(result.direction).toBe('extend');
    expect(result.recommendedMonths).toBe(15);
  });

  it('retains intervals with insufficient evidence', () => {
    const gauge = createSeedState().gauges[0];
    const result = recommendCalibrationInterval(gauge, records(gauge.id, []));
    expect(result.direction).toBe('retain');
    expect(result.confidence).toBe('low');
  });
});
