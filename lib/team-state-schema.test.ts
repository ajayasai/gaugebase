import { describe, expect, it } from 'vitest';

import { createSeedState } from './model';
import { parseTeamAppState } from './team-state-schema';

describe('team workspace runtime schema', () => {
  it('accepts the complete v2 seed workspace', () => {
    expect(parseTeamAppState(createSeedState()).schemaVersion).toBe(2);
  });

  it('rejects invalid calibration outcomes, dates, and empty evidence rows', () => {
    const invalidResult = structuredClone(createSeedState()) as unknown as {
      calibrations: Array<{ result: string }>;
    };
    invalidResult.calibrations[0].result = 'approved';
    expect(() => parseTeamAppState(invalidResult)).toThrow();

    const invalidDate = structuredClone(createSeedState());
    invalidDate.calibrations[0].performedOn = '2026-02-31';
    expect(() => parseTeamAppState(invalidDate)).toThrow();

    const emptyReadings = structuredClone(createSeedState());
    emptyReadings.calibrations[0].readings = [];
    expect(() => parseTeamAppState(emptyReadings)).toThrow();
  });

  it('requires controlled fields for conditional calibration results', () => {
    const state = structuredClone(createSeedState());
    const conditional = state.calibrations.find(
      (record) => record.result === 'conditional',
    )!;
    delete conditional.approvedBy;
    expect(() => parseTeamAppState(state)).toThrow(/Conditional calibration/i);
  });

  it('rejects malformed domain objects and insecure webhook URLs', () => {
    const malformed = structuredClone(createSeedState()) as unknown as {
      gauges: Array<Record<string, unknown>>;
    };
    delete malformed.gauges[0].serial;
    expect(() => parseTeamAppState(malformed)).toThrow();

    const insecureWebhook = structuredClone(createSeedState());
    insecureWebhook.settings.reminderWebhook = 'http://example.com/hook';
    expect(() => parseTeamAppState(insecureWebhook)).toThrow(/HTTPS/i);

    const localWebhook = structuredClone(createSeedState());
    localWebhook.settings.reminderWebhook = 'http://localhost:8787/hook';
    expect(() => parseTeamAppState(localWebhook)).not.toThrow();
  });
});
