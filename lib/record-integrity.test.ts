import { describe, expect, it } from 'vitest';
import { createSeedState, type Reading } from './model';
import {
  canonicalJson,
  createCertificateManifest,
  createGaugeSnapshot,
  restrictionState,
  sealCalibrationRecord,
  sha256Hex,
  validateReadingRows,
  verifySealedCalibration,
} from './record-integrity';

describe('record integrity', () => {
  it('canonicalizes object keys and hashes deterministically', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe(
      '{"a":{"x":3,"y":2},"z":1}',
    );
    expect(sha256Hex({ b: 2, a: 1 })).toBe(sha256Hex({ a: 1, b: 2 }));
  });

  it('creates mutation-isolated gauge snapshots', () => {
    const gauge = createSeedState().gauges[0];
    const snapshot = createGaugeSnapshot(gauge, '2026-08-31T00:00:00.000Z');
    gauge.name = 'Changed later';
    expect(snapshot.name).not.toBe(gauge.name);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('seals a record with stable 64-character hashes', () => {
    const state = createSeedState();
    const gauge = state.gauges[0];
    const source = state.calibrations[0];
    const {
      certificateHash: _certificateHash,
      recordHash: _recordHash,
      snapshotHash: _snapshotHash,
      gaugeSnapshot: _gaugeSnapshot,
      lockedAt: _lockedAt,
      ...draft
    } = source;
    const sealed = sealCalibrationRecord(gauge, draft);
    expect(sealed.recordHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sealed.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sealed.certificateHash).toBe(sealed.recordHash);
    expect(verifySealedCalibration(sealed).valid).toBe(true);
    expect(
      verifySealedCalibration({
        ...sealed,
        attachmentIds: ['new-evidence'],
        approvals: [
          {
            id: 'approval-1',
            meaning: 'technical-review',
            signerName: 'Reviewer',
            signedAt: '2026-08-31T01:00:00.000Z',
            recordHash: sealed.recordHash!,
            assurance: 'local-assertion',
          },
        ],
      }).valid,
    ).toBe(true);
    expect(
      verifySealedCalibration({ ...sealed, technician: 'Changed later' }).valid,
    ).toBe(false);
  });

  it('rejects partial and non-numeric reading rows', () => {
    const partial: Reading = {
      id: 'r1',
      characteristic: 'Length',
      nominal: '10',
      lowerLimit: '',
      upperLimit: '10.1',
      asFound: 'banana',
      asLeft: '',
      unit: 'mm',
    };
    const result = validateReadingRows([partial]);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toContain('lowerLimit');
    expect(result.issues.map((issue) => issue.field)).toContain('asFound');
  });

  it('ignores a completely empty optional row', () => {
    const empty: Reading = {
      id: 'r1',
      characteristic: '',
      nominal: '',
      lowerLimit: '',
      upperLimit: '',
      asFound: '',
      asLeft: '',
      unit: '',
    };
    expect(validateReadingRows([empty])).toEqual({
      accepted: [],
      issues: [],
      valid: true,
    });
  });

  it('evaluates conditional restriction expiry', () => {
    expect(
      restrictionState(
        { result: 'conditional', restrictionExpiry: '2026-08-30' },
        '2026-08-31',
      ),
    ).toBe('expired');
    expect(
      restrictionState(
        { result: 'conditional', restrictionExpiry: '2026-08-31' },
        '2026-08-31',
      ),
    ).toBe('due-today');
  });

  it('builds a detached PDF manifest', () => {
    const state = createSeedState();
    const gauge = state.gauges[0];
    const source = state.calibrations[0];
    const {
      certificateHash: _certificateHash,
      recordHash: _recordHash,
      snapshotHash: _snapshotHash,
      gaugeSnapshot: _gaugeSnapshot,
      lockedAt: _lockedAt,
      ...draft
    } = source;
    const calibration = sealCalibrationRecord(gauge, draft);
    const manifest = createCertificateManifest({
      calibration,
      fileName: 'certificate.pdf',
      generatedAt: '2026-08-31T00:00:00.000Z',
      pdfSha256: 'a'.repeat(64),
    });
    expect(manifest.pdfSha256).toBe('a'.repeat(64));
    expect(manifest.recordHash).toBe(calibration.recordHash);
  });
});
