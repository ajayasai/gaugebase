import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
  CalibrationGaugeSnapshot,
  CalibrationRecord,
  GaugeRecord,
  Reading,
} from './model';

function normalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Canonical JSON cannot contain non-finite numbers.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => normalize(item, seen) ?? null);
  if (typeof value === 'object') {
    if (seen.has(value))
      throw new TypeError('Canonical JSON cannot contain circular references.');
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = normalize(
        (value as Record<string, unknown>)[key],
        seen,
      );
      if (normalized !== undefined) output[key] = normalized;
    }
    seen.delete(value);
    return output;
  }
  throw new TypeError(`Canonical JSON cannot encode ${typeof value}.`);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalize(value, new WeakSet()));
}

export function sha256Hex(value: unknown) {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))));
}

export async function sha256Bytes(bytes: ArrayBuffer | Uint8Array) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      input.slice().buffer,
    );
    return bytesToHex(new Uint8Array(digest));
  }
  return bytesToHex(sha256(input));
}

export function immutableClone<T>(value: T): Readonly<T> {
  const cloned =
    typeof structuredClone === 'function'
      ? structuredClone(value)
      : (JSON.parse(JSON.stringify(value)) as T);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
    for (const child of Object.values(item as Record<string, unknown>))
      freeze(child);
    Object.freeze(item);
  };
  freeze(cloned);
  return cloned;
}

export function createGaugeSnapshot(
  gauge: GaugeRecord,
  capturedAt: string,
  source: CalibrationGaugeSnapshot['source'] = 'completion',
): CalibrationGaugeSnapshot {
  return immutableClone({
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
  }) as CalibrationGaugeSnapshot;
}

export function sealCalibrationRecord(
  gauge: GaugeRecord,
  draft: Omit<
    CalibrationRecord,
    | 'certificateHash'
    | 'recordHash'
    | 'snapshotHash'
    | 'gaugeSnapshot'
    | 'lockedAt'
  >,
): CalibrationRecord {
  const lockedAt = draft.createdAt;
  const gaugeSnapshot = createGaugeSnapshot(gauge, lockedAt);
  const snapshotHash = sha256Hex(gaugeSnapshot);
  const {
    approvals: _approvals,
    attachmentIds: _attachmentIds,
    ...immutableDraft
  } = draft;
  const recordHash = sha256Hex({
    ...immutableDraft,
    gaugeSnapshot,
    snapshotHash,
    lockedAt,
  });
  return immutableClone({
    ...draft,
    gaugeSnapshot,
    snapshotHash,
    recordHash,
    certificateHash: recordHash,
    lockedAt,
  }) as CalibrationRecord;
}

export function verifySealedCalibration(record: CalibrationRecord) {
  if (
    !record.gaugeSnapshot ||
    !record.snapshotHash ||
    !record.recordHash ||
    !record.lockedAt
  )
    return {
      valid: false,
      snapshotValid: false,
      recordValid: false,
      reason: 'The record predates sealed calibration snapshots.',
    };
  const snapshotValid = sha256Hex(record.gaugeSnapshot) === record.snapshotHash;
  const {
    certificateHash: _certificateHash,
    recordHash: _recordHash,
    approvals: _approvals,
    attachmentIds: _attachmentIds,
    ...immutableRecord
  } = record;
  const recordValid = sha256Hex(immutableRecord) === record.recordHash;
  return {
    valid: snapshotValid && recordValid,
    snapshotValid,
    recordValid,
    reason:
      snapshotValid && recordValid
        ? 'The immutable calibration core and captured gauge snapshot match their stored hashes.'
        : 'The immutable calibration core or captured gauge snapshot no longer matches its stored hash.',
  };
}

export interface ReadingValidationIssue {
  row: number;
  field: keyof Omit<Reading, 'id'> | 'row';
  message: string;
}

export function validateReadingRows(readings: Reading[]) {
  const accepted: Reading[] = [];
  const issues: ReadingValidationIssue[] = [];

  readings.forEach((reading, index) => {
    const row = index + 1;
    const enteredFields = [
      reading.characteristic,
      reading.nominal,
      reading.lowerLimit,
      reading.upperLimit,
      reading.asFound,
      reading.asLeft,
      reading.unit,
      reading.expandedUncertainty ?? '',
    ];
    if (enteredFields.every((value) => !value.trim())) return;
    const required = [
      'characteristic',
      'nominal',
      'lowerLimit',
      'upperLimit',
      'asFound',
      'unit',
    ] as const;
    for (const field of required) {
      if (!reading[field].trim())
        issues.push({ row, field, message: `${field} is required.` });
    }
    for (const field of [
      'nominal',
      'lowerLimit',
      'upperLimit',
      'asFound',
      'asLeft',
      'expandedUncertainty',
    ] as const) {
      const value = reading[field]?.trim() ?? '';
      if (value && !Number.isFinite(Number(value)))
        issues.push({
          row,
          field,
          message: `${field} must be a finite number.`,
        });
    }
    const lower = Number(reading.lowerLimit);
    const upper = Number(reading.upperLimit);
    if (
      reading.lowerLimit.trim() &&
      reading.upperLimit.trim() &&
      Number.isFinite(lower) &&
      Number.isFinite(upper) &&
      lower > upper
    )
      issues.push({
        row,
        field: 'row',
        message: 'Lower limit must not exceed upper limit.',
      });
    accepted.push({
      ...reading,
      characteristic: reading.characteristic.trim(),
      nominal: reading.nominal.trim(),
      lowerLimit: reading.lowerLimit.trim(),
      upperLimit: reading.upperLimit.trim(),
      asFound: reading.asFound.trim(),
      asLeft: reading.asLeft.trim(),
      unit: reading.unit.trim(),
    });
  });

  return { accepted, issues, valid: issues.length === 0 };
}

export type RestrictionState =
  | 'not-conditional'
  | 'missing-expiry'
  | 'active'
  | 'due-today'
  | 'expired';

function dateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function restrictionState(
  calibration: Pick<CalibrationRecord, 'result' | 'restrictionExpiry'>,
  today: string,
): RestrictionState {
  if (calibration.result !== 'conditional') return 'not-conditional';
  if (!calibration.restrictionExpiry) return 'missing-expiry';
  const expiry = dateOnly(calibration.restrictionExpiry);
  const comparison = dateOnly(today);
  if (!Number.isFinite(expiry) || !Number.isFinite(comparison))
    return 'missing-expiry';
  if (expiry < comparison) return 'expired';
  if (expiry === comparison) return 'due-today';
  return 'active';
}

export interface CertificateManifest {
  format: 'gaugebase-certificate-manifest';
  version: 1;
  certificateNumber: string;
  eventNumber: string;
  fileName: string;
  generatedAt: string;
  recordHash: string;
  snapshotHash: string;
  issuerSnapshotHash?: string;
  referenceStandardsHash?: string;
  pdfSha256: string;
  hashAlgorithm: 'SHA-256';
  verificationNote: string;
}

export function createCertificateManifest(input: {
  calibration: CalibrationRecord;
  fileName: string;
  generatedAt: string;
  pdfSha256: string;
}): CertificateManifest {
  const { calibration, fileName, generatedAt, pdfSha256 } = input;
  if (!calibration.recordHash || !calibration.snapshotHash)
    throw new Error('The calibration record does not contain sealed hashes.');
  if (!/^[a-f0-9]{64}$/i.test(pdfSha256))
    throw new Error('The PDF digest must be a SHA-256 hexadecimal value.');
  return {
    format: 'gaugebase-certificate-manifest',
    version: 1,
    certificateNumber: calibration.certificateNumber,
    eventNumber: calibration.eventNumber,
    fileName,
    generatedAt,
    recordHash: calibration.recordHash,
    snapshotHash: calibration.snapshotHash,
    issuerSnapshotHash: calibration.issuerSnapshot
      ? sha256Hex(calibration.issuerSnapshot)
      : undefined,
    referenceStandardsHash: calibration.standardSnapshots?.length
      ? sha256Hex(calibration.standardSnapshots)
      : undefined,
    pdfSha256: pdfSha256.toLowerCase(),
    hashAlgorithm: 'SHA-256',
    verificationNote:
      'The PDF digest verifies the downloaded file. Record and snapshot hashes verify the sealed GaugeBase source record.',
  };
}
