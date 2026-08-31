import { describe, expect, it } from 'vitest';

import { createSeedState, type Reading } from './model';
import { sealCalibrationRecord } from './record-integrity';
import { prepareTeamSyncState, teamEventHash } from './team-integrity';

function proposedState(
  base = createSeedState(),
  readingPatch: Partial<Reading> = {},
) {
  const state = structuredClone(base);
  const gauge = state.gauges[0];
  const now = '2026-08-31T12:00:00.000Z';
  state.calibrations.push(
    sealCalibrationRecord(gauge, {
      id: 'cal-new',
      gaugeId: gauge.id,
      eventNumber: 'CAL-EVT-9001',
      certificateNumber: 'CERT-9001',
      performedOn: '2026-08-31',
      technician: 'Taylor Metrologist',
      result: 'pass',
      environmentalConditions: '20 °C',
      procedureRevision: 'CAL-01 Rev A',
      standardReferences: 'STD-001',
      standardIds: [],
      standardSnapshots: [],
      issuerSnapshot: {
        organizationName: state.settings.organizationName,
        certificatePrefix: state.settings.certificatePrefix,
        certificateFooter: state.settings.certificateFooter,
        capturedAt: now,
      },
      decisionRule: 'simple-acceptance',
      decisionRuleStatement: 'Simple acceptance.',
      readings: [
        {
          id: 'reading-new',
          characteristic: 'Indication',
          nominal: '10',
          lowerLimit: '9.99',
          upperLimit: '10.01',
          asFound: '10.001',
          asLeft: '10.001',
          unit: 'mm',
          decisionOutcome: 'pass',
          decisionExplanation:
            'Stored value is within the stated limits under simple acceptance.',
          ...readingPatch,
        },
      ],
      attachmentIds: [],
      approvals: [],
      notes: '',
      createdAt: now,
    }),
  );
  return state;
}

function synchronize(
  current = createSeedState(),
  proposed = proposedState(current),
) {
  return prepareTeamSyncState({
    current,
    proposed,
    authoritativeAttachments: new Map(),
    actorName: 'Taylor Metrologist',
    actorEmail: 'taylor@example.com',
    actorRole: 'technician',
    summary: 'Calibration completed',
  });
}

describe('team synchronization integrity', () => {
  it('binds each server event hash to the exact workspace state digest', () => {
    const base = {
      id: 'event-1',
      workspaceId: 'team-1',
      sequence: 1,
      actorUserId: 'user-1',
      actorEmail: 'taylor@example.com',
      action: 'workspace.created',
      summary: 'Created',
      stateHash: 'a'.repeat(64),
      previousHash: 'GENESIS',
      createdAt: '2026-08-31T12:00:00.000Z',
    };
    expect(teamEventHash(base)).not.toBe(
      teamEventHash({ ...base, stateHash: 'b'.repeat(64) }),
    );
  });

  it('retains the server audit chain and appends authenticated attribution', () => {
    const current = createSeedState();
    const proposed = proposedState(current);
    proposed.audit.push({ ...proposed.audit.at(-1)!, id: 'forged' });
    const next = synchronize(current, proposed);
    expect(next.audit).toHaveLength(current.audit.length + 1);
    expect(next.audit.at(-1)?.assurance).toBe('authenticated-identity');
    expect(next.audit.at(-1)?.actor).toContain('taylor@example.com');
  });

  it('rejects deletion or replacement of sealed calibrations', () => {
    const current = proposedState();
    const deleted = structuredClone(current);
    deleted.calibrations = deleted.calibrations.slice(1);
    expect(() => synchronize(current, deleted)).toThrow(/retained/i);

    const changed = structuredClone(current);
    changed.calibrations[0].notes = 'rewritten';
    expect(() => synchronize(current, changed)).toThrow(/verification/i);
  });

  it('rejects forged authenticated approvals', () => {
    const current = proposedState();
    const changed = structuredClone(current);
    (changed.calibrations[0].approvals ??= []).push({
      id: 'fake',
      meaning: 'release',
      signerName: 'Fake Reviewer',
      signerEmail: 'fake@example.com',
      signerRole: 'reviewer',
      signedAt: '2026-08-31T12:00:00.000Z',
      recordHash: changed.calibrations[0].recordHash!,
      assurance: 'authenticated-identity',
    });
    expect(() => synchronize(current, changed)).toThrow(/approval endpoint/i);
  });

  it('prevents technicians from changing settings', () => {
    const current = createSeedState();
    const proposed = proposedState(current);
    proposed.settings.organizationName = 'Unauthorized rename';
    expect(() => synchronize(current, proposed)).toThrow(/cannot change/i);
  });

  it('rejects new sealed records with nonnumeric readings', () => {
    const current = createSeedState();
    const proposed = proposedState(current, { asFound: 'not-a-number' });
    expect(() => synchronize(current, proposed)).toThrow(/numeric reading/i);
  });

  it('requires a stored decision outcome for every new reading', () => {
    const current = createSeedState();
    const proposed = proposedState(current, {
      decisionOutcome: undefined,
      decisionExplanation: undefined,
    });
    expect(() => synchronize(current, proposed)).toThrow(/decision outcome/i);
  });

  it('prevents technicians from creating a pre-closed quality case', () => {
    const current = createSeedState();
    const proposed = proposedState(current);
    proposed.qualityCases.push({
      id: 'case-preclosed',
      caseNumber: 'Q-2026-0099',
      type: 'capa',
      status: 'closed',
      severity: 'medium',
      title: 'Pre-closed case',
      description: 'Must enter the controlled workflow as open.',
      owner: 'Taylor Metrologist',
      affectedGaugeIds: [],
      disposition: 'Closed before review',
      createdAt: '2026-08-31T12:00:00.000Z',
      updatedAt: '2026-08-31T12:00:00.000Z',
      closedAt: '2026-08-31T12:00:00.000Z',
    });
    expect(() => synchronize(current, proposed)).toThrow(
      /only in open status/i,
    );
  });

  it('prevents technicians from closing an active quality case', () => {
    const current = createSeedState();
    const proposed = proposedState(current);
    proposed.qualityCases[0] = {
      ...proposed.qualityCases[0],
      status: 'closed',
      disposition: 'Closed without quality review',
      closedAt: '2026-08-31T12:00:00.000Z',
    };
    expect(() => synchronize(current, proposed)).toThrow(/quality manager/i);
  });

  it('keeps closed quality cases immutable for every generic sync role', () => {
    const current = createSeedState();
    current.qualityCases[0] = {
      ...current.qualityCases[0],
      status: 'closed',
      disposition: 'Reviewed and closed',
      closedAt: '2026-08-30T12:00:00.000Z',
    };
    const proposed = structuredClone(current);
    proposed.qualityCases[0].status = 'investigating';
    expect(() =>
      prepareTeamSyncState({
        current,
        proposed,
        authoritativeAttachments: new Map(),
        actorName: 'Quality Manager',
        actorEmail: 'quality@example.com',
        actorRole: 'quality-manager',
        summary: 'Reopen case',
      }),
    ).toThrow(/immutable/i);

    const rewritten = structuredClone(current);
    rewritten.qualityCases[0].description = 'Rewritten after closure';
    expect(() =>
      prepareTeamSyncState({
        current,
        proposed: rewritten,
        authoritativeAttachments: new Map(),
        actorName: 'Quality Manager',
        actorEmail: 'quality@example.com',
        actorRole: 'quality-manager',
        summary: 'Rewrite case',
      }),
    ).toThrow(/immutable/i);
  });
});
