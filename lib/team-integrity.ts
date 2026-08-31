import type {
  AppState,
  AttachmentRecord,
  AuditEntry,
  CalibrationRecord,
  TechnicalStudyRecord,
} from './model';
import { appendAudit, verifyAuditChain } from './model';
import {
  canonicalJson,
  sha256Hex,
  validateReadingRows,
  verifySealedCalibration,
} from './record-integrity';
import type { TeamRole } from './team-server';

export interface TeamEventBase {
  id: string;
  workspaceId: string;
  sequence: number;
  actorUserId: string;
  actorEmail: string;
  action: string;
  summary: string;
  stateHash: string;
  previousHash: string;
  createdAt: string;
}

export function teamEventHash(input: TeamEventBase) {
  return sha256Hex(input);
}

function equal(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

export function describeTeamTransition(current: AppState, proposed: AppState) {
  const changes: string[] = [];
  const describe = <T extends { id: string }>(
    before: T[],
    after: T[],
    label: string,
  ) => {
    const beforeById = new Map(before.map((item) => [item.id, item]));
    const added = after.filter((item) => !beforeById.has(item.id)).length;
    const updated = after.filter((item) => {
      const prior = beforeById.get(item.id);
      return prior && !equal(prior, item);
    }).length;
    if (added) changes.push(`${added} ${label}${added === 1 ? '' : 's'} added`);
    if (updated)
      changes.push(`${updated} ${label}${updated === 1 ? '' : 's'} updated`);
  };
  describe(current.gauges, proposed.gauges, 'gauge');
  describe(current.calibrations, proposed.calibrations, 'calibration');
  describe(current.attachments, proposed.attachments, 'attachment');
  describe(current.qualityCases, proposed.qualityCases, 'quality case');
  describe(
    current.technicalStudies,
    proposed.technicalStudies,
    'technical study',
  );
  if (!equal(current.settings, proposed.settings))
    changes.push('settings updated');
  return (
    changes.join('; ') ||
    'Workspace synchronization confirmed with no domain changes'
  );
}

function uniqueById<T extends { id: string }>(items: T[], label: string) {
  const map = new Map<string, T>();
  for (const item of items) {
    if (!item.id || map.has(item.id))
      throw new Error(`${label} identifiers must be present and unique.`);
    map.set(item.id, item);
  }
  return map;
}

function requirePreserved<T extends { id: string }>(
  before: T[],
  after: T[],
  label: string,
) {
  const afterById = uniqueById(after, label);
  for (const item of before) {
    if (!afterById.has(item.id))
      throw new Error(
        `${label} records are retained; retire or supersede them instead of deleting them.`,
      );
  }
  return afterById;
}

function validateCalibrationSet(
  previous: CalibrationRecord[],
  proposed: CalibrationRecord[],
  allowNewLocalApprovals = false,
) {
  const proposedById = requirePreserved(previous, proposed, 'Calibration');
  const previousById = uniqueById(previous, 'Calibration');
  const certificateNumbers = new Set<string>();
  const eventNumbers = new Set<string>();

  for (const record of proposed) {
    if (!['pass', 'fail', 'conditional'].includes(record.result))
      throw new Error('Calibration result is not supported.');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(record.performedOn) ||
      !Number.isFinite(Date.parse(`${record.performedOn}T00:00:00Z`))
    )
      throw new Error('Calibration performed date is invalid.');
    if (
      !Number.isFinite(Date.parse(record.createdAt)) ||
      !record.lockedAt ||
      !Number.isFinite(Date.parse(record.lockedAt))
    )
      throw new Error('Calibration creation and lock timestamps are required.');
    const readingValidation = validateReadingRows(record.readings);
    if (
      !readingValidation.valid ||
      readingValidation.accepted.length !== record.readings.length ||
      readingValidation.accepted.length === 0
    )
      throw new Error(
        `Calibration ${record.certificateNumber || record.id} requires at least one complete, numeric reading row.`,
      );
    if (
      record.result === 'conditional' &&
      (!record.condition?.trim() ||
        !record.restrictionExpiry ||
        !record.approvedBy?.trim())
    )
      throw new Error(
        'Conditional calibration results require a limitation, expiry date, and approving identity.',
      );
    const verification = verifySealedCalibration(record);
    if (!verification.valid)
      throw new Error(
        `Calibration ${record.certificateNumber || record.id} failed sealed-record verification.`,
      );
    if (record.certificateHash !== record.recordHash)
      throw new Error('Certificate and sealed record digests must match.');
    if (certificateNumbers.has(record.certificateNumber))
      throw new Error(
        `Certificate number ${record.certificateNumber} is duplicated.`,
      );
    if (eventNumbers.has(record.eventNumber))
      throw new Error(
        `Calibration event number ${record.eventNumber} is duplicated.`,
      );
    certificateNumbers.add(record.certificateNumber);
    eventNumbers.add(record.eventNumber);

    const prior = previousById.get(record.id);
    if (prior) {
      if (
        record.recordHash !== prior.recordHash ||
        record.snapshotHash !== prior.snapshotHash
      )
        throw new Error(
          'A sealed calibration core cannot be replaced or re-hashed.',
        );
      if (!equal(record.approvals ?? [], prior.approvals ?? []))
        throw new Error(
          'Approvals can only be added by the authenticated approval endpoint.',
        );
    } else {
      if (!allowNewLocalApprovals) {
        if (!record.decisionRule || !record.decisionRuleStatement?.trim())
          throw new Error(
            'New calibration records require an explicit decision rule and statement.',
          );
        if (
          record.readings.some(
            (reading) =>
              !reading.decisionOutcome || !reading.decisionExplanation?.trim(),
          )
        )
          throw new Error(
            'New calibration readings require a stored decision outcome and explanation.',
          );
        if (
          record.result === 'pass' &&
          record.readings.some((reading) => reading.decisionOutcome !== 'pass')
        )
          throw new Error(
            'A passing calibration cannot contain a non-passing reading.',
          );
        if (
          record.decisionRule !== 'simple-acceptance' &&
          record.readings.some(
            (reading) =>
              !reading.expandedUncertainty?.trim() ||
              !Number.isFinite(Number(reading.expandedUncertainty)) ||
              Number(reading.expandedUncertainty) < 0,
          )
        )
          throw new Error(
            'Guard-banded and uncertainty-aware decisions require a non-negative expanded uncertainty at every point.',
          );
      }
      if (
        (record.approvals ?? []).length > 0 &&
        (!allowNewLocalApprovals ||
          record.approvals?.some(
            (approval) => approval.assurance !== 'local-assertion',
          ))
      )
        throw new Error(
          'New calibration records cannot arrive with pre-populated approvals.',
        );
    }
  }
  return proposedById;
}

function validateStudies(
  previous: TechnicalStudyRecord[],
  proposed: TechnicalStudyRecord[],
) {
  const proposedById = requirePreserved(previous, proposed, 'Technical study');
  for (const study of previous) {
    if (!equal(study, proposedById.get(study.id)))
      throw new Error(
        'Reviewed technical studies are append-only and cannot be rewritten.',
      );
  }
}

function validateReferences(
  state: AppState,
  previousCalibrationIds: Set<string>,
  allowLegacySnapshots = false,
) {
  const gauges = uniqueById(state.gauges, 'Gauge');
  const calibrations = uniqueById(state.calibrations, 'Calibration');
  const qualityCases = uniqueById(state.qualityCases, 'Quality case');
  uniqueById(state.technicalStudies, 'Technical study');

  for (const calibration of calibrations.values()) {
    const gauge = gauges.get(calibration.gaugeId);
    if (!gauge)
      throw new Error(
        `Calibration ${calibration.id} references a missing gauge.`,
      );
    const standardIds = calibration.standardIds ?? [];
    if (new Set(standardIds).size !== standardIds.length)
      throw new Error(
        `Calibration ${calibration.id} repeats a reference standard.`,
      );
    for (const standardId of standardIds) {
      const standard = gauges.get(standardId);
      if (!standard || standard.type !== 'reference-standard')
        throw new Error(
          `Calibration ${calibration.id} references an invalid standard.`,
        );
    }
    if (previousCalibrationIds.has(calibration.id)) continue;
    if (!calibration.gaugeSnapshot)
      throw new Error(
        `Calibration ${calibration.id} is missing its gauge snapshot.`,
      );
    if (
      !allowLegacySnapshots &&
      calibration.gaugeSnapshot.source !== 'completion'
    )
      throw new Error(
        `Calibration ${calibration.id} must use a completion snapshot.`,
      );
    const expectedGaugeSnapshot = {
      gaugeId: gauge.id,
      assetId: gauge.assetId,
      name: gauge.name,
      type: gauge.type,
      manufacturer: gauge.manufacturer,
      model: gauge.model,
      serial: gauge.serial,
      range: gauge.range,
      unit: gauge.unit,
      location: gauge.location,
      site: gauge.site ?? '',
      department: gauge.department ?? '',
      procedure: gauge.procedure,
      capturedAt: calibration.createdAt,
      source: calibration.gaugeSnapshot.source,
    };
    if (!equal(calibration.gaugeSnapshot, expectedGaugeSnapshot))
      throw new Error(
        `Calibration ${calibration.id} gauge snapshot does not match its source record.`,
      );
    if (
      !calibration.issuerSnapshot ||
      calibration.issuerSnapshot.organizationName !==
        state.settings.organizationName ||
      calibration.issuerSnapshot.certificatePrefix !==
        state.settings.certificatePrefix ||
      calibration.issuerSnapshot.certificateFooter !==
        state.settings.certificateFooter ||
      calibration.issuerSnapshot.capturedAt !== calibration.createdAt
    )
      throw new Error(
        `Calibration ${calibration.id} issuer snapshot is incomplete or inconsistent.`,
      );
    const snapshots = calibration.standardSnapshots ?? [];
    if (
      snapshots.length !== standardIds.length ||
      new Set(snapshots.map((snapshot) => snapshot.gaugeId)).size !==
        snapshots.length
    )
      throw new Error(
        `Calibration ${calibration.id} standard snapshots are incomplete.`,
      );
    for (const snapshot of snapshots) {
      const standard = gauges.get(snapshot.gaugeId);
      if (
        !standard ||
        !standardIds.includes(snapshot.gaugeId) ||
        snapshot.assetId !== standard.assetId ||
        snapshot.name !== standard.name ||
        snapshot.manufacturer !== standard.manufacturer ||
        snapshot.model !== standard.model ||
        snapshot.serial !== standard.serial ||
        snapshot.certificateNumber !==
          (standard.standardCertificateNumber ?? '') ||
        snapshot.validThrough !== (standard.standardValidThrough ?? '') ||
        snapshot.traceabilitySource !== (standard.traceabilitySource ?? '') ||
        snapshot.lifecycle !== standard.lifecycle ||
        snapshot.nextDue !== standard.nextDue ||
        snapshot.capturedAt !== calibration.createdAt
      )
        throw new Error(
          `Calibration ${calibration.id} contains a mismatched standard snapshot.`,
        );
      if (
        snapshot.lifecycle !== 'active' ||
        !snapshot.certificateNumber ||
        !snapshot.validThrough ||
        snapshot.validThrough < calibration.performedOn ||
        (snapshot.nextDue && snapshot.nextDue < calibration.performedOn) ||
        !snapshot.traceabilitySource
      )
        throw new Error(
          `Calibration ${calibration.id} used an ineligible reference standard.`,
        );
    }
  }

  for (const qualityCase of qualityCases.values()) {
    if (qualityCase.gaugeId && !gauges.has(qualityCase.gaugeId))
      throw new Error(
        `Quality case ${qualityCase.id} references a missing gauge.`,
      );
    if (
      qualityCase.calibrationId &&
      !calibrations.has(qualityCase.calibrationId)
    )
      throw new Error(
        `Quality case ${qualityCase.id} references a missing calibration.`,
      );
    if (qualityCase.affectedGaugeIds.some((id) => !gauges.has(id)))
      throw new Error(
        `Quality case ${qualityCase.id} has an unknown affected gauge.`,
      );
  }
  for (const study of state.technicalStudies) {
    if (study.gaugeId && !gauges.has(study.gaugeId))
      throw new Error(
        `Technical study ${study.id} references a missing gauge.`,
      );
  }
}

function validateAttachments(input: {
  previous: AttachmentRecord[];
  proposed: AttachmentRecord[];
  authoritative: Map<string, AttachmentRecord>;
  proposedState: AppState;
}) {
  const proposedById = requirePreserved(
    input.previous,
    input.proposed,
    'Attachment evidence',
  );
  const normalized: AttachmentRecord[] = [];
  for (const requested of proposedById.values()) {
    const authoritative = input.authoritative.get(requested.id);
    if (!authoritative)
      throw new Error(
        `Attachment ${requested.id} is not registered in this team workspace.`,
      );
    normalized.push(authoritative);
  }
  const normalizedById = uniqueById(normalized, 'Attachment evidence');
  const gauges = uniqueById(input.proposedState.gauges, 'Gauge');
  const calibrations = uniqueById(
    input.proposedState.calibrations,
    'Calibration',
  );

  for (const attachment of normalized) {
    const target =
      attachment.targetType === 'gauge'
        ? gauges.get(attachment.targetId)
        : calibrations.get(attachment.targetId);
    if (!target)
      throw new Error(
        `Attachment ${attachment.id} points to a missing target.`,
      );
    if (!target.attachmentIds.includes(attachment.id))
      throw new Error(
        `Attachment ${attachment.id} is not linked from its target record.`,
      );
  }
  for (const target of [...gauges.values(), ...calibrations.values()]) {
    for (const id of target.attachmentIds) {
      const attachment = normalizedById.get(id);
      if (!attachment)
        throw new Error(
          `Target record ${target.id} references unknown attachment ${id}.`,
        );
      const expectedType = gauges.has(target.id) ? 'gauge' : 'calibration';
      if (
        attachment.targetId !== target.id ||
        attachment.targetType !== expectedType
      )
        throw new Error(`Attachment ${id} is linked to the wrong target.`);
    }
  }
  return normalized;
}

export function prepareInitialTeamState(input: {
  proposed: AppState;
  actorName: string;
  actorEmail: string;
}): AppState {
  if (input.proposed.attachments.length > 0)
    throw new Error(
      'Create the team workspace first, then upload shared evidence into it.',
    );
  if (!verifyAuditChain(input.proposed.audit))
    throw new Error('The imported local audit chain is not valid.');
  if (
    input.proposed.audit.some(
      (entry) => entry.assurance === 'authenticated-identity',
    )
  )
    throw new Error(
      'Authenticated audit attribution cannot be imported from local data.',
    );
  uniqueById(input.proposed.gauges, 'Gauge');
  validateCalibrationSet([], input.proposed.calibrations, true);
  validateStudies([], input.proposed.technicalStudies);
  validateReferences(input.proposed, new Set(), true);
  if (
    input.proposed.calibrations.some((record) =>
      (record.approvals ?? []).some(
        (approval) => approval.assurance === 'authenticated-identity',
      ),
    )
  )
    throw new Error(
      'Authenticated approvals cannot be imported from a local workspace.',
    );

  return {
    ...input.proposed,
    audit: appendAudit(input.proposed.audit, {
      actor: `${input.actorName} <${input.actorEmail}>`,
      action: 'team.workspace-created',
      entityType: 'team',
      entityId: 'workspace',
      summary: 'Local data promoted into an authenticated team workspace',
      assurance: 'authenticated-identity',
    }),
  };
}

export function prepareTeamSyncState(input: {
  current: AppState;
  proposed: AppState;
  authoritativeAttachments: Map<string, AttachmentRecord>;
  actorName: string;
  actorEmail: string;
  actorRole: TeamRole;
  summary: string;
}): AppState {
  if (!verifyAuditChain(input.current.audit))
    throw new Error(
      'The stored audit chain is invalid; synchronization is locked.',
    );
  if (
    input.actorRole === 'technician' &&
    !equal(input.current.settings, input.proposed.settings)
  )
    throw new Error('Technicians cannot change organization-wide settings.');
  requirePreserved(input.current.gauges, input.proposed.gauges, 'Gauge');
  validateCalibrationSet(
    input.current.calibrations,
    input.proposed.calibrations,
  );
  validateStudies(
    input.current.technicalStudies,
    input.proposed.technicalStudies,
  );
  validateReferences(
    input.proposed,
    new Set(input.current.calibrations.map((record) => record.id)),
  );
  requirePreserved(
    input.current.qualityCases,
    input.proposed.qualityCases,
    'Quality case',
  );

  const currentCases = new Map(
    input.current.qualityCases.map((qualityCase) => [
      qualityCase.id,
      qualityCase,
    ]),
  );
  for (const qualityCase of input.proposed.qualityCases) {
    const prior = currentCases.get(qualityCase.id);
    if (prior?.status === 'closed' && !equal(prior, qualityCase))
      throw new Error(
        'Closed quality cases are immutable; use a controlled follow-up case for further action.',
      );
    if (
      input.actorRole === 'technician' &&
      !prior &&
      (qualityCase.status !== 'open' || qualityCase.closedAt)
    )
      throw new Error(
        'Technicians can create quality cases only in open status.',
      );
  }

  if (
    input.actorRole === 'technician' &&
    input.current.qualityCases.some((qualityCase) => {
      const next = input.proposed.qualityCases.find(
        (item) => item.id === qualityCase.id,
      );
      return qualityCase.status !== 'closed' && next?.status === 'closed';
    })
  )
    throw new Error(
      'Only a quality manager or administrator can close a quality case.',
    );
  if (
    input.actorRole === 'technician' &&
    input.proposed.technicalStudies.some(
      (study) =>
        !input.current.technicalStudies.some((item) => item.id === study.id) &&
        study.status !== 'draft',
    )
  )
    throw new Error('Technicians can save technical studies only as drafts.');

  const attachments = validateAttachments({
    previous: input.current.attachments,
    proposed: input.proposed.attachments,
    authoritative: input.authoritativeAttachments,
    proposedState: input.proposed,
  });
  const serverAudit: AuditEntry[] = appendAudit(input.current.audit, {
    actor: `${input.actorName} <${input.actorEmail}>`,
    action: 'team.workspace-synchronized',
    entityType: 'team',
    entityId: 'workspace',
    summary: input.summary.slice(0, 300) || 'Workspace data synchronized',
    assurance: 'authenticated-identity',
  });

  return {
    ...input.proposed,
    attachments,
    audit: serverAudit,
  };
}
