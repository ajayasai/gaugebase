'use client';

import Dexie, { type EntityTable } from 'dexie';
import {
  canonicalHashValue,
  isoNow,
  type AppState,
  type CalibrationGaugeSnapshot,
  type GaugeRecord,
} from './model';

interface StoredWorkspace extends AppState {
  id: 'primary';
}

class GaugeBaseDatabase extends Dexie {
  workspaces!: EntityTable<StoredWorkspace, 'id'>;

  constructor() {
    super('GaugeBase');
    this.version(1).stores({ workspaces: 'id' });
    this.version(2).stores({ workspaces: 'id' });
  }
}

const database = typeof window === 'undefined' ? null : new GaugeBaseDatabase();

export async function loadWorkspace() {
  if (!database) return undefined;
  const stored = await database.workspaces.get('primary');
  if (!stored) return undefined;
  const { id: _id, ...state } = stored;
  return migrateWorkspace(state);
}

function snapshotGauge(
  gauge: GaugeRecord,
  capturedAt: string,
  source: CalibrationGaugeSnapshot['source'],
): CalibrationGaugeSnapshot {
  return {
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
    capturedAt,
    source,
  };
}

export function migrateWorkspace(input: unknown): AppState {
  if (!input || typeof input !== 'object')
    throw new Error('The stored GaugeBase workspace is unreadable.');
  const schemaVersion = (input as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2)
    throw new Error(
      'The stored GaugeBase workspace uses an unsupported schema.',
    );
  const legacy = input as Omit<Partial<AppState>, 'schemaVersion'> & {
    schemaVersion: 1 | 2;
    gauges?: GaugeRecord[];
  };
  if (
    !Array.isArray(legacy.gauges) ||
    !Array.isArray(legacy.calibrations) ||
    !Array.isArray(legacy.attachments) ||
    !Array.isArray(legacy.audit) ||
    !legacy.settings
  )
    throw new Error('The stored GaugeBase workspace is incomplete.');

  const migratedAt = isoNow();
  const gauges = legacy.gauges.map((gauge) => ({
    ...gauge,
    site: gauge.site ?? '',
    department: gauge.department ?? '',
    criticality: gauge.criticality ?? ('medium' as const),
  }));
  const calibrations = legacy.calibrations.map((calibration) => {
    if (calibration.gaugeSnapshot && calibration.recordHash) return calibration;
    const gauge = gauges.find((item) => item.id === calibration.gaugeId);
    if (!gauge) return calibration;
    const gaugeSnapshot = snapshotGauge(gauge, migratedAt, 'legacy-migration');
    const enrichedCalibration = {
      ...calibration,
      standardIds: calibration.standardIds ?? [],
      standardSnapshots: calibration.standardSnapshots ?? [],
      issuerSnapshot: calibration.issuerSnapshot ?? {
        organizationName: legacy.settings!.organizationName,
        certificatePrefix: legacy.settings!.certificatePrefix,
        certificateFooter: legacy.settings!.certificateFooter,
        capturedAt: calibration.createdAt,
      },
      decisionRule: calibration.decisionRule ?? ('simple-acceptance' as const),
      decisionRuleStatement:
        calibration.decisionRuleStatement ??
        'Legacy record migrated without a stored decision-rule statement.',
      approvals: calibration.approvals ?? [],
    };
    const {
      certificateHash: _certificateHash,
      recordHash: _recordHash,
      snapshotHash: _snapshotHash,
      gaugeSnapshot: _gaugeSnapshot,
      approvals: _approvals,
      attachmentIds: _attachmentIds,
      ...immutableCalibration
    } = enrichedCalibration;
    const snapshotHash = canonicalHashValue(gaugeSnapshot);
    const recordHash = canonicalHashValue({
      ...immutableCalibration,
      snapshotHash,
      gaugeSnapshot,
      lockedAt: calibration.lockedAt ?? calibration.createdAt,
    });
    return {
      ...enrichedCalibration,
      gaugeSnapshot,
      snapshotHash,
      recordHash,
      certificateHash: recordHash,
      lockedAt: calibration.lockedAt ?? calibration.createdAt,
    };
  });

  return {
    schemaVersion: 2,
    gauges,
    calibrations,
    attachments: legacy.attachments,
    audit: legacy.audit,
    qualityCases: legacy.qualityCases ?? [],
    technicalStudies: legacy.technicalStudies ?? [],
    settings: {
      ...legacy.settings,
      defaultDecisionRule:
        legacy.settings.defaultDecisionRule ?? 'guard-banded',
      guardBandMultiplier: legacy.settings.guardBandMultiplier ?? 1,
    },
  };
}

export async function saveWorkspace(state: AppState) {
  if (!database) return;
  await database.workspaces.put({ id: 'primary', ...state });
}

export async function clearWorkspace() {
  if (!database) return;
  await database.workspaces.delete('primary');
}
