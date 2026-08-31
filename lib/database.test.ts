import { describe, expect, it } from 'vitest';

import { migrateWorkspace } from './database';
import { createSeedState } from './model';
import { verifySealedCalibration } from './record-integrity';

describe('workspace migration', () => {
  it('ships only valid sealed seed calibration records', () => {
    const state = createSeedState();
    expect(state.calibrations.length).toBeGreaterThan(0);
    expect(
      state.calibrations.every(
        (record) => verifySealedCalibration(record).valid,
      ),
    ).toBe(true);
  });

  it('seals schema-one records with frozen issuer metadata', () => {
    const source = createSeedState();
    const legacyRecord = { ...source.calibrations[0] } as Record<
      string,
      unknown
    >;
    for (const key of [
      'recordHash',
      'snapshotHash',
      'gaugeSnapshot',
      'lockedAt',
      'issuerSnapshot',
      'standardSnapshots',
      'decisionRule',
      'decisionRuleStatement',
      'approvals',
    ])
      delete legacyRecord[key];
    const migrated = migrateWorkspace({
      ...source,
      schemaVersion: 1,
      calibrations: [legacyRecord],
      qualityCases: undefined,
      technicalStudies: undefined,
    });
    expect(migrated.schemaVersion).toBe(2);
    expect(verifySealedCalibration(migrated.calibrations[0]).valid).toBe(true);
    expect(migrated.calibrations[0].issuerSnapshot?.organizationName).toBe(
      source.settings.organizationName,
    );
  });

  it('rejects incomplete workspace payloads', () => {
    expect(() => migrateWorkspace({ schemaVersion: 2 })).toThrow(/incomplete/i);
  });
});
