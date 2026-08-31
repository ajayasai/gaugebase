import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export type CalibrationState =
  | 'current'
  | 'due-soon'
  | 'overdue'
  | 'failed'
  | 'conditional'
  | 'restriction-expired'
  | 'not-required';
export type LifecycleStatus =
  | 'active'
  | 'restricted'
  | 'out-of-service'
  | 'inactive'
  | 'retired';
export type CalibrationResult = 'pass' | 'fail' | 'conditional';

export interface GaugeRecord {
  id: string;
  assetId: string;
  token: string;
  name: string;
  type: 'measuring-equipment' | 'reference-standard';
  manufacturer: string;
  model: string;
  serial: string;
  range: string;
  unit: string;
  location: string;
  custodian: string;
  custodianEmail: string;
  intervalMonths: number;
  dueSoonDays: number;
  lastCalibrated?: string;
  nextDue?: string;
  lifecycle: LifecycleStatus;
  procedure: string;
  notes: string;
  site?: string;
  department?: string;
  criticality?: 'low' | 'medium' | 'high' | 'critical';
  standardCertificateNumber?: string;
  standardValidThrough?: string;
  traceabilitySource?: string;
  restrictionReason?: string;
  restrictionExpiry?: string;
  restrictionApprovedBy?: string;
  attachmentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Reading {
  id: string;
  characteristic: string;
  nominal: string;
  lowerLimit: string;
  upperLimit: string;
  asFound: string;
  asLeft: string;
  unit: string;
  expandedUncertainty?: string;
  decisionOutcome?: 'pass' | 'fail' | 'conditional' | 'indeterminate';
  decisionExplanation?: string;
}

export interface CalibrationRecord {
  id: string;
  eventNumber: string;
  gaugeId: string;
  performedOn: string;
  result: CalibrationResult;
  technician: string;
  procedureRevision: string;
  environmentalConditions: string;
  standardReferences: string;
  standardIds?: string[];
  standardSnapshots?: CalibrationStandardSnapshot[];
  issuerSnapshot?: CalibrationIssuerSnapshot;
  readings: Reading[];
  notes: string;
  condition?: string;
  restrictionExpiry?: string;
  approvedBy?: string;
  certificateNumber: string;
  certificateHash: string;
  recordHash?: string;
  snapshotHash?: string;
  gaugeSnapshot?: CalibrationGaugeSnapshot;
  decisionRule?: 'simple-acceptance' | 'guard-banded' | 'uncertainty-aware';
  decisionRuleStatement?: string;
  supersedesId?: string;
  approvals?: CalibrationApproval[];
  lockedAt?: string;
  attachmentIds: string[];
  createdAt: string;
}

export interface CalibrationStandardSnapshot {
  gaugeId: string;
  assetId: string;
  name: string;
  manufacturer: string;
  model: string;
  serial: string;
  certificateNumber: string;
  validThrough: string;
  traceabilitySource: string;
  lifecycle: GaugeRecord['lifecycle'];
  nextDue?: string;
  capturedAt: string;
}

export interface CalibrationIssuerSnapshot {
  organizationName: string;
  certificatePrefix: string;
  certificateFooter: string;
  capturedAt: string;
}

export interface CalibrationGaugeSnapshot {
  gaugeId: string;
  assetId: string;
  name: string;
  type: GaugeRecord['type'];
  manufacturer: string;
  model: string;
  serial: string;
  range: string;
  unit: string;
  location: string;
  site: string;
  department: string;
  procedure: string;
  capturedAt: string;
  source: 'completion' | 'legacy-migration';
}

export interface CalibrationApproval {
  id: string;
  meaning: 'technical-review' | 'release' | 'conditional-use';
  signerName: string;
  signerUserId?: string;
  signerEmail?: string;
  signerRole?: string;
  signedAt: string;
  recordHash: string;
  assurance: 'local-assertion' | 'authenticated-identity';
}

export interface AttachmentRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  storage?: 'local' | 'team';
  downloadUrl?: string;
  sha256: string;
  createdAt: string;
  targetType: 'gauge' | 'calibration';
  targetId: string;
}

export interface ReminderRule {
  id: string;
  offsetDays: number;
  recipient: 'custodian' | 'quality-manager';
  active: boolean;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entityType:
    | 'gauge'
    | 'calibration'
    | 'attachment'
    | 'label'
    | 'settings'
    | 'import'
    | 'export'
    | 'backup'
    | 'quality-case'
    | 'technical-study'
    | 'approval'
    | 'team';
  entityId: string;
  summary: string;
  assurance?: 'local' | 'authenticated-identity';
  before?: unknown;
  after?: unknown;
  previousHash: string;
  hash: string;
}

export interface QualityCase {
  id: string;
  caseNumber: string;
  type: 'out-of-tolerance' | 'recall' | 'deviation' | 'capa';
  status: 'open' | 'investigating' | 'contained' | 'closed';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  gaugeId?: string;
  calibrationId?: string;
  owner: string;
  dueDate?: string;
  impactWindowStart?: string;
  impactWindowEnd?: string;
  affectedGaugeIds: string[];
  disposition?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface TechnicalStudyRecord {
  id: string;
  kind: 'uncertainty-budget' | 'gage-rr' | 'bias' | 'linearity' | 'stability';
  title: string;
  gaugeId?: string;
  status: 'draft' | 'reviewed' | 'approved';
  input: unknown;
  result: unknown;
  createdBy: string;
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSettings {
  organizationName: string;
  actorName: string;
  actorEmail: string;
  qualityManagerEmail: string;
  dueSoonDays: number;
  reminderWebhook: string;
  certificatePrefix: string;
  certificateFooter: string;
  defaultDecisionRule?:
    | 'simple-acceptance'
    | 'guard-banded'
    | 'uncertainty-aware';
  guardBandMultiplier?: number;
  reminderRules: ReminderRule[];
  lastBackupAt?: string;
}

export interface AppState {
  schemaVersion: 2;
  gauges: GaugeRecord[];
  calibrations: CalibrationRecord[];
  attachments: AttachmentRecord[];
  audit: AuditEntry[];
  qualityCases: QualityCase[];
  technicalStudies: TechnicalStudyRecord[];
  settings: WorkspaceSettings;
}

export const COMPLIANCE_DISCLAIMER =
  'GaugeBase records information supplied or approved by the issuing organization. Use of the software alone does not establish accreditation, regulatory compliance, measurement traceability, or technical validity.';

export function uid(prefix = 'id') {
  const value =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

export function isoNow() {
  return new Date().toISOString();
}

function localDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIso() {
  return localDate(new Date());
}

export function dateFromToday(offsetDays: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return localDate(date);
}

export function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function daysUntil(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  const due = parseLocalDate(value).getTime();
  const today = parseLocalDate(todayIso()).getTime();
  return Math.round((due - today) / 86_400_000);
}

export function addMonthsClamped(value: string, months: number) {
  const original = parseLocalDate(value);
  const target = new Date(
    original.getFullYear(),
    original.getMonth() + months,
    1,
    12,
  );
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
    12,
  ).getDate();
  target.setDate(Math.min(original.getDate(), lastDay));
  return localDate(target);
}

export function getCalibrationState(gauge: GaugeRecord): CalibrationState {
  if (gauge.lifecycle === 'out-of-service') return 'failed';
  if (gauge.lifecycle === 'restricted') {
    if (gauge.restrictionExpiry && daysUntil(gauge.restrictionExpiry) < 0)
      return 'restriction-expired';
    return 'conditional';
  }
  if (gauge.lifecycle === 'inactive' || gauge.lifecycle === 'retired')
    return 'not-required';
  const remaining = daysUntil(gauge.nextDue);
  if (remaining < 0) return 'overdue';
  if (remaining <= gauge.dueSoonDays) return 'due-soon';
  return 'current';
}

export function stateLabel(state: CalibrationState) {
  return {
    current: 'Current',
    'due-soon': 'Due soon',
    overdue: 'Overdue',
    failed: 'Out of service',
    conditional: 'Restricted use',
    'restriction-expired': 'Restriction expired',
    'not-required': 'Inactive',
  }[state];
}

export function formatDate(
  value?: string,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  },
) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', options).format(parseLocalDate(value));
}

export function hashValue(value: unknown) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
}

function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError(
        'Canonical records cannot contain non-finite numbers.',
      );
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => canonicalize(item, seen) ?? null);
  if (typeof value === 'object') {
    if (seen.has(value))
      throw new TypeError('Circular record data is invalid.');
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = canonicalize(
        (value as Record<string, unknown>)[key],
        seen,
      );
      if (normalized !== undefined) output[key] = normalized;
    }
    seen.delete(value);
    return output;
  }
  throw new TypeError(`Unsupported canonical record value: ${typeof value}.`);
}

export function canonicalHashValue(value: unknown) {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify(canonicalize(value, new WeakSet())),
      ),
    ),
  );
}

export function appendAudit(
  entries: AuditEntry[],
  input: Omit<AuditEntry, 'id' | 'timestamp' | 'previousHash' | 'hash'>,
): AuditEntry[] {
  const previousHash = entries.at(-1)?.hash ?? 'GENESIS';
  const base = {
    id: uid('audit'),
    timestamp: isoNow(),
    ...input,
    previousHash,
  };
  return [...entries, { ...base, hash: hashValue(base) }];
}

export function verifyAuditChain(entries: AuditEntry[]) {
  let previousHash = 'GENESIS';
  for (const entry of entries) {
    const { hash, ...base } = entry;
    if (entry.previousHash !== previousHash || hashValue(base) !== hash)
      return false;
    previousHash = hash;
  }
  return true;
}

export function readingResult(reading: Reading) {
  const measured = reading.asLeft.trim() || reading.asFound.trim();
  if (
    !reading.asFound.trim() ||
    !reading.lowerLimit.trim() ||
    !reading.upperLimit.trim() ||
    !measured
  )
    return 'not-evaluated';
  const value = Number(measured);
  const low = Number(reading.lowerLimit);
  const high = Number(reading.upperLimit);
  if (![value, low, high].every(Number.isFinite) || low > high)
    return 'not-evaluated';
  return value >= low && value <= high ? 'pass' : 'fail';
}

function seedAudit(
  entries: Array<
    Omit<AuditEntry, 'id' | 'timestamp' | 'previousHash' | 'hash'> & {
      timestamp: string;
    }
  >,
) {
  let audit: AuditEntry[] = [];
  for (const item of entries) {
    const previousHash = audit.at(-1)?.hash ?? 'GENESIS';
    const base = { id: uid('audit'), ...item, previousHash };
    audit = [...audit, { ...base, hash: hashValue(base) }];
  }
  return audit;
}

export function createSeedState(): AppState {
  const created = isoNow();
  const gauges: GaugeRecord[] = [
    {
      id: 'gauge-dim-042',
      assetId: 'DIM-042',
      token: 'gb-px7m4r9k',
      name: 'Digital micrometer 0–25 mm',
      type: 'measuring-equipment',
      manufacturer: 'Mitutoyo',
      model: '293-340-30',
      serial: 'MT-294175',
      range: '0–25',
      unit: 'mm',
      location: 'Assembly Cell A',
      custodian: 'Maya Chen',
      custodianEmail: 'maya@example.com',
      intervalMonths: 12,
      dueSoonDays: 30,
      lastCalibrated: dateFromToday(-368),
      nextDue: dateFromToday(-3),
      lifecycle: 'active',
      procedure: 'CAL-DIM-04 · Rev C',
      notes:
        'Primary inspection micrometer. Verify battery before calibration.',
      attachmentIds: [],
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'gauge-prs-018',
      assetId: 'PRS-018',
      token: 'gb-m2q8v5cd',
      name: 'Hydraulic pressure gauge 0–400 bar',
      type: 'measuring-equipment',
      manufacturer: 'WIKA',
      model: '233.50',
      serial: 'WK-88219',
      range: '0–400',
      unit: 'bar',
      location: 'Test Bay 2',
      custodian: 'Noah Singh',
      custodianEmail: 'noah@example.com',
      intervalMonths: 6,
      dueSoonDays: 30,
      lastCalibrated: addMonthsClamped(dateFromToday(1), -6),
      nextDue: dateFromToday(1),
      lifecycle: 'active',
      procedure: 'CAL-PRS-02 · Rev B',
      notes: '',
      attachmentIds: [],
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'gauge-tmp-107',
      assetId: 'TMP-107',
      token: 'gb-n7t2k8fw',
      name: 'Reference thermometer',
      type: 'reference-standard',
      manufacturer: 'Fluke',
      model: '1524',
      serial: 'FL-190042',
      range: '-200–420',
      unit: '°C',
      location: 'Calibration Lab',
      custodian: 'Alex Kim',
      custodianEmail: 'alex@example.com',
      intervalMonths: 12,
      dueSoonDays: 30,
      lastCalibrated: addMonthsClamped(dateFromToday(8), -12),
      nextDue: dateFromToday(8),
      lifecycle: 'active',
      procedure: 'CAL-TMP-01 · Rev D',
      notes:
        'Reference standard. Do not remove from the laboratory without authorization.',
      attachmentIds: [],
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'gauge-ele-031',
      assetId: 'ELE-031',
      token: 'gb-k4w9x2qa',
      name: 'Digital multimeter',
      type: 'measuring-equipment',
      manufacturer: 'Keysight',
      model: '34461A',
      serial: 'MY63280014',
      range: '6½ digit',
      unit: 'V/A/Ω',
      location: 'Electronics Lab',
      custodian: 'Priya Shah',
      custodianEmail: 'priya@example.com',
      intervalMonths: 12,
      dueSoonDays: 30,
      lastCalibrated: dateFromToday(-73),
      nextDue: dateFromToday(292),
      lifecycle: 'active',
      procedure: 'CAL-ELE-07 · Rev A',
      notes: '',
      attachmentIds: [],
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'gauge-tor-009',
      assetId: 'TOR-009',
      token: 'gb-z8p3r6hn',
      name: 'Torque wrench 20–100 N·m',
      type: 'measuring-equipment',
      manufacturer: 'Norbar',
      model: '130102',
      serial: 'NB-44810',
      range: '20–100',
      unit: 'N·m',
      location: 'Final Assembly',
      custodian: 'Jon Bell',
      custodianEmail: 'jon@example.com',
      intervalMonths: 6,
      dueSoonDays: 30,
      lastCalibrated: dateFromToday(-23),
      nextDue: dateFromToday(157),
      lifecycle: 'active',
      procedure: 'CAL-TOR-03 · Rev F',
      notes: '',
      attachmentIds: [],
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'gauge-mas-004',
      assetId: 'MAS-004',
      token: 'gb-f1c7m5ve',
      name: 'Class F1 mass set 1 mg–1 kg',
      type: 'reference-standard',
      manufacturer: 'Troemner',
      model: 'F1-SET',
      serial: 'TR-22081',
      range: '1 mg–1 kg',
      unit: 'g',
      location: 'Standards Vault',
      custodian: 'Alex Kim',
      custodianEmail: 'alex@example.com',
      intervalMonths: 24,
      dueSoonDays: 45,
      lastCalibrated: dateFromToday(-102),
      nextDue: dateFromToday(628),
      lifecycle: 'active',
      procedure: 'CAL-MAS-01 · Rev A',
      notes: '',
      attachmentIds: [],
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'gauge-dim-071',
      assetId: 'DIM-071',
      token: 'gb-r5x2j9lp',
      name: 'Vernier height gauge 0–600 mm',
      type: 'measuring-equipment',
      manufacturer: 'Tesa',
      model: '00730047',
      serial: 'TS-81023',
      range: '0–600',
      unit: 'mm',
      location: 'Incoming Inspection',
      custodian: 'Maya Chen',
      custodianEmail: 'maya@example.com',
      intervalMonths: 12,
      dueSoonDays: 30,
      lastCalibrated: dateFromToday(-40),
      nextDue: dateFromToday(325),
      lifecycle: 'restricted',
      procedure: 'CAL-DIM-08 · Rev B',
      notes: 'Restricted to measurements below 300 mm pending review.',
      restrictionReason: 'Use only for measurements at or below 300 mm.',
      restrictionExpiry: dateFromToday(20),
      restrictionApprovedBy: 'Alex Kim',
      attachmentIds: [],
      createdAt: created,
      updatedAt: created,
    },
  ];

  const calibrations: CalibrationRecord[] = [
    {
      id: 'cal-ele-031',
      eventNumber: 'EVT-2026-0042',
      gaugeId: 'gauge-ele-031',
      performedOn: dateFromToday(-73),
      result: 'pass',
      technician: 'Alex Kim',
      procedureRevision: 'CAL-ELE-07 · Rev A',
      environmentalConditions: '22.1 °C · 44% RH',
      standardReferences: 'ELE-STD-002 · Valid through 2027-02-14',
      readings: [
        {
          id: 'r1',
          characteristic: 'DC voltage',
          nominal: '10',
          lowerLimit: '9.995',
          upperLimit: '10.005',
          asFound: '10.001',
          asLeft: '10.000',
          unit: 'V',
        },
      ],
      notes: 'No adjustment required.',
      certificateNumber: 'GB-2026-0042',
      certificateHash: 'f6b18e6d3c61',
      attachmentIds: [],
      createdAt: created,
    },
    {
      id: 'cal-tor-009',
      eventNumber: 'EVT-2026-0038',
      gaugeId: 'gauge-tor-009',
      performedOn: dateFromToday(-23),
      result: 'pass',
      technician: 'Maya Chen',
      procedureRevision: 'CAL-TOR-03 · Rev F',
      environmentalConditions: '21.8 °C · 46% RH',
      standardReferences: 'TOR-STD-001 · Valid through 2027-01-06',
      readings: [
        {
          id: 'r1',
          characteristic: 'Clockwise torque',
          nominal: '60',
          lowerLimit: '58.8',
          upperLimit: '61.2',
          asFound: '59.7',
          asLeft: '60.1',
          unit: 'N·m',
        },
      ],
      notes: 'Adjusted and sealed.',
      certificateNumber: 'GB-2026-0038',
      certificateHash: '8f2e922cb93d',
      attachmentIds: [],
      createdAt: created,
    },
    {
      id: 'cal-dim-071',
      eventNumber: 'EVT-2026-0031',
      gaugeId: 'gauge-dim-071',
      performedOn: dateFromToday(-40),
      result: 'conditional',
      technician: 'Alex Kim',
      procedureRevision: 'CAL-DIM-08 · Rev B',
      environmentalConditions: '20.4 °C · 48% RH',
      standardReferences: 'DIM-STD-004 · Valid through 2027-03-22',
      readings: [
        {
          id: 'r1',
          characteristic: 'Indication at 500 mm',
          nominal: '500',
          lowerLimit: '499.95',
          upperLimit: '500.05',
          asFound: '500.08',
          asLeft: '500.07',
          unit: 'mm',
        },
      ],
      notes: 'Limited use accepted by quality manager.',
      condition: 'Use only for measurements at or below 300 mm.',
      restrictionExpiry: dateFromToday(20),
      approvedBy: 'Alex Kim',
      certificateNumber: 'GB-2026-0031',
      certificateHash: '5c29e3ec391a',
      attachmentIds: [],
      createdAt: created,
    },
  ];

  const sealedCalibrations = calibrations.map((calibration) => {
    const gauge = gauges.find((item) => item.id === calibration.gaugeId)!;
    const gaugeSnapshot: CalibrationGaugeSnapshot = {
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
      source: 'completion',
    };
    const snapshotHash = canonicalHashValue(gaugeSnapshot);
    const enrichedCalibration = {
      ...calibration,
      readings: calibration.readings.map((reading) => {
        const observed = Number(reading.asLeft || reading.asFound);
        const lower = Number(reading.lowerLimit);
        const upper = Number(reading.upperLimit);
        const withinLimits = observed >= lower && observed <= upper;
        const decisionOutcome = withinLimits
          ? ('pass' as const)
          : calibration.result === 'conditional'
            ? ('conditional' as const)
            : ('fail' as const);
        return {
          ...reading,
          decisionOutcome,
          decisionExplanation: withinLimits
            ? 'Stored value is within the stated limits under simple acceptance.'
            : calibration.result === 'conditional'
              ? 'Stored value is outside the stated limits; use is limited by the documented conditional approval.'
              : 'Stored value is outside the stated limits under simple acceptance.',
        };
      }),
      standardIds: calibration.standardIds ?? [],
      standardSnapshots: calibration.standardSnapshots ?? [],
      issuerSnapshot: {
        organizationName: 'Northstar Manufacturing',
        certificatePrefix: 'GB',
        certificateFooter: COMPLIANCE_DISCLAIMER,
        capturedAt: calibration.createdAt,
      },
      decisionRule: 'simple-acceptance' as const,
      decisionRuleStatement:
        'Simple acceptance against the stated specification limits without guard banding.',
      approvals: [],
    };
    const {
      certificateHash: _certificateHash,
      attachmentIds: _attachmentIds,
      approvals: _approvals,
      ...immutableCalibration
    } = enrichedCalibration;
    const recordHash = canonicalHashValue({
      ...immutableCalibration,
      gaugeSnapshot,
      snapshotHash,
      lockedAt: calibration.createdAt,
    });
    return {
      ...enrichedCalibration,
      gaugeSnapshot,
      snapshotHash,
      recordHash,
      certificateHash: recordHash,
      lockedAt: calibration.createdAt,
    };
  });

  const audit = seedAudit([
    {
      timestamp: new Date(Date.now() - 73 * 86_400_000).toISOString(),
      actor: 'Alex Kim',
      action: 'calibration.completed',
      entityType: 'calibration',
      entityId: 'cal-ele-031',
      summary: 'ELE-031 passed calibration',
      after: { result: 'pass', certificate: 'GB-2026-0042' },
    },
    {
      timestamp: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      actor: 'Alex Kim',
      action: 'calibration.completed',
      entityType: 'calibration',
      entityId: 'cal-dim-071',
      summary: 'DIM-071 approved for restricted use',
      after: { result: 'conditional', restriction: 'Measurements ≤ 300 mm' },
    },
    {
      timestamp: new Date(Date.now() - 23 * 86_400_000).toISOString(),
      actor: 'Maya Chen',
      action: 'calibration.completed',
      entityType: 'calibration',
      entityId: 'cal-tor-009',
      summary: 'TOR-009 passed after adjustment',
      after: { result: 'pass', certificate: 'GB-2026-0038' },
    },
  ]);

  return {
    schemaVersion: 2,
    gauges,
    calibrations: sealedCalibrations,
    attachments: [],
    audit,
    qualityCases: [
      {
        id: 'case-oos-001',
        caseNumber: 'Q-2026-0001',
        type: 'out-of-tolerance',
        status: 'investigating',
        severity: 'high',
        title: 'Height gauge restricted above 300 mm',
        description:
          'Review measurements made above the approved restriction and document product impact.',
        gaugeId: 'gauge-dim-071',
        calibrationId: 'cal-dim-071',
        owner: 'Alex Kim',
        dueDate: dateFromToday(10),
        impactWindowStart: dateFromToday(-40),
        impactWindowEnd: todayIso(),
        affectedGaugeIds: [],
        createdAt: created,
        updatedAt: created,
      },
    ],
    technicalStudies: [],
    settings: {
      organizationName: 'Northstar Manufacturing',
      actorName: 'Alex Kim',
      actorEmail: 'alex@example.com',
      qualityManagerEmail: 'quality@example.com',
      dueSoonDays: 30,
      reminderWebhook: '',
      certificatePrefix: 'GB',
      certificateFooter: COMPLIANCE_DISCLAIMER,
      defaultDecisionRule: 'guard-banded',
      guardBandMultiplier: 1,
      reminderRules: [
        { id: 'rem-30', offsetDays: 30, recipient: 'custodian', active: true },
        { id: 'rem-7', offsetDays: 7, recipient: 'custodian', active: true },
        {
          id: 'rem-due',
          offsetDays: 0,
          recipient: 'quality-manager',
          active: true,
        },
      ],
    },
  };
}
