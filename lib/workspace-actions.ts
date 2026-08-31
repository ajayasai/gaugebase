'use client';

import Papa from 'papaparse';
import type {
  AppState,
  AuditEntry,
  CalibrationRecord,
  GaugeRecord,
} from './model';
import {
  COMPLIANCE_DISCLAIMER,
  formatDate,
  getCalibrationState,
  hashValue,
  stateLabel,
  uid,
} from './model';

function download(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function sanitizeSpreadsheetCell(value: unknown) {
  const text =
    value == null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function exportGaugesCsv(gauges: GaugeRecord[]) {
  const rows = gauges.map((gauge) => ({
    asset_id: sanitizeSpreadsheetCell(gauge.assetId),
    name: sanitizeSpreadsheetCell(gauge.name),
    type: gauge.type,
    manufacturer: sanitizeSpreadsheetCell(gauge.manufacturer),
    model: sanitizeSpreadsheetCell(gauge.model),
    serial_number: sanitizeSpreadsheetCell(gauge.serial),
    range: sanitizeSpreadsheetCell(gauge.range),
    unit: sanitizeSpreadsheetCell(gauge.unit),
    location: sanitizeSpreadsheetCell(gauge.location),
    custodian: sanitizeSpreadsheetCell(gauge.custodian),
    custodian_email: sanitizeSpreadsheetCell(gauge.custodianEmail),
    calibration_interval_months: gauge.intervalMonths,
    due_soon_days: gauge.dueSoonDays,
    last_calibrated: gauge.lastCalibrated ?? '',
    next_due: gauge.nextDue ?? '',
    lifecycle_status: gauge.lifecycle,
    procedure: sanitizeSpreadsheetCell(gauge.procedure),
    notes: sanitizeSpreadsheetCell(gauge.notes),
  }));
  download(
    Papa.unparse(rows),
    `gaugebase-gauges-${new Date().toISOString().slice(0, 10)}.csv`,
    'text/csv;charset=utf-8',
  );
}

export function exportAuditCsv(audit: AuditEntry[]) {
  const rows = audit.map((entry) => ({
    timestamp_utc: entry.timestamp,
    actor: sanitizeSpreadsheetCell(entry.actor),
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    summary: sanitizeSpreadsheetCell(entry.summary),
    previous_hash: entry.previousHash,
    entry_hash: entry.hash,
  }));
  download(
    Papa.unparse(rows),
    `gaugebase-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    'text/csv;charset=utf-8',
  );
}

export interface CsvPreview {
  rows: Array<
    Omit<
      GaugeRecord,
      'id' | 'token' | 'attachmentIds' | 'createdAt' | 'updatedAt'
    >
  >;
  errors: string[];
  total: number;
}

export function parseGaugeCsv(
  text: string,
  existing: GaugeRecord[],
): CsvPreview {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  const errors = parsed.errors.map(
    (error) => `Row ${(error.row ?? 0) + 2}: ${error.message}`,
  );
  const seen = new Set(existing.map((gauge) => gauge.assetId.toLowerCase()));
  const rows: CsvPreview['rows'] = [];

  parsed.data.forEach((raw, index) => {
    const rowNumber = index + 2;
    const assetId = (raw.asset_id ?? '').trim();
    const name = (raw.name ?? '').trim();
    if (!assetId) errors.push(`Row ${rowNumber}: asset_id is required.`);
    if (!name) errors.push(`Row ${rowNumber}: name is required.`);
    if (assetId && seen.has(assetId.toLowerCase()))
      errors.push(
        `Row ${rowNumber}: asset_id “${assetId}” already exists or is duplicated.`,
      );
    const interval = Number(raw.calibration_interval_months || 12);
    if (!Number.isInteger(interval) || interval < 1 || interval > 120)
      errors.push(
        `Row ${rowNumber}: calibration_interval_months must be 1–120.`,
      );
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (raw.next_due && !datePattern.test(raw.next_due))
      errors.push(`Row ${rowNumber}: next_due must be YYYY-MM-DD.`);
    if (
      !assetId ||
      !name ||
      seen.has(assetId.toLowerCase()) ||
      !Number.isInteger(interval) ||
      interval < 1 ||
      interval > 120
    )
      return;
    seen.add(assetId.toLowerCase());
    rows.push({
      assetId,
      name,
      type:
        raw.type === 'reference-standard'
          ? 'reference-standard'
          : 'measuring-equipment',
      manufacturer: (raw.manufacturer ?? '').trim(),
      model: (raw.model ?? '').trim(),
      serial: (raw.serial_number ?? '').trim(),
      range: (raw.range ?? '').trim(),
      unit: (raw.unit ?? '').trim(),
      location: (raw.location ?? '').trim(),
      custodian: (raw.custodian ?? '').trim(),
      custodianEmail: (raw.custodian_email ?? '').trim(),
      intervalMonths: interval,
      dueSoonDays: Number(raw.due_soon_days || 30),
      lastCalibrated: raw.last_calibrated || undefined,
      nextDue: raw.next_due || undefined,
      lifecycle: [
        'active',
        'restricted',
        'out-of-service',
        'inactive',
        'retired',
      ].includes(raw.lifecycle_status)
        ? (raw.lifecycle_status as GaugeRecord['lifecycle'])
        : 'active',
      procedure: (raw.procedure ?? '').trim(),
      notes: (raw.notes ?? '').trim(),
    });
  });
  return { rows, errors, total: parsed.data.length };
}

export function downloadCsvTemplate() {
  const template =
    'asset_id,name,type,manufacturer,model,serial_number,range,unit,location,custodian,custodian_email,calibration_interval_months,due_soon_days,last_calibrated,next_due,lifecycle_status,procedure,notes\nDIM-001,Digital caliper,measuring-equipment,Mitutoyo,500-196-30,SAMPLE-001,0–150,mm,Inspection Lab,Alex Kim,alex@example.com,12,30,2026-01-15,2027-01-15,active,CAL-DIM-01 · Rev A,Sample row';
  download(template, 'gaugebase-import-template.csv', 'text/csv;charset=utf-8');
}

export async function generateCertificatePdf(
  state: AppState,
  calibration: CalibrationRecord,
  gauge: GaugeRecord,
) {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 18;
  const width = 210 - margin * 2;
  const resultColor: [number, number, number] =
    calibration.result === 'pass'
      ? [20, 108, 92]
      : calibration.result === 'fail'
        ? [190, 65, 47]
        : [178, 102, 25];
  pdf.setFillColor(23, 35, 31);
  pdf.rect(0, 0, 210, 38, 'F');
  pdf.setTextColor(183, 224, 74);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(21);
  pdf.text('GaugeBase', margin, 17);
  pdf.setTextColor(235, 241, 237);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text(state.settings.organizationName, margin, 25);
  pdf.text('CALIBRATION RECORD', 210 - margin, 17, { align: 'right' });
  pdf.text(calibration.certificateNumber, 210 - margin, 25, { align: 'right' });

  pdf.setTextColor(28, 39, 35);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(gauge.name, margin, 53);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(101, 114, 108);
  pdf.text(
    `${gauge.assetId} · ${gauge.manufacturer} ${gauge.model} · S/N ${gauge.serial || '—'}`,
    margin,
    61,
  );

  pdf.setFillColor(...resultColor);
  pdf.roundedRect(151, 45, 41, 17, 2.5, 2.5, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text(
    calibration.result === 'conditional'
      ? 'CONDITIONAL PASS'
      : calibration.result.toUpperCase(),
    171.5,
    55.5,
    { align: 'center' },
  );

  let y = 76;
  const field = (
    label: string,
    value: string,
    x: number,
    fieldWidth: number,
  ) => {
    pdf.setTextColor(112, 123, 118);
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'bold');
    pdf.text(label.toUpperCase(), x, y);
    pdf.setTextColor(31, 43, 38);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text(value || '—', x, y + 5, { maxWidth: fieldWidth });
  };
  field('Performed on', formatDate(calibration.performedOn), margin, 42);
  field('Technician', calibration.technician, 65, 42);
  field('Procedure', calibration.procedureRevision, 112, 80);
  y += 19;
  field('Range', `${gauge.range} ${gauge.unit}`.trim(), margin, 42);
  field('Location', gauge.location, 65, 42);
  field('Environment', calibration.environmentalConditions, 112, 80);

  y += 20;
  pdf.setDrawColor(218, 224, 219);
  pdf.line(margin, y, 210 - margin, y);
  y += 9;
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(31, 43, 38);
  pdf.setFontSize(10);
  pdf.text('Measurement results', margin, y);
  y += 7;
  const columns = [margin, 70, 96, 121, 148, 176];
  [
    'Characteristic',
    'Nominal',
    'Limits',
    'As found',
    'As left',
    'Result',
  ].forEach((header, i) => {
    pdf.setFontSize(7);
    pdf.setTextColor(110, 120, 116);
    pdf.text(header, columns[i], y);
  });
  y += 5;
  calibration.readings.forEach((reading) => {
    const value = Number(reading.asLeft || reading.asFound);
    const pass =
      value >= Number(reading.lowerLimit) &&
      value <= Number(reading.upperLimit);
    pdf.setFontSize(8);
    pdf.setTextColor(36, 48, 43);
    pdf.text(reading.characteristic || 'Reading', columns[0], y, {
      maxWidth: 48,
    });
    pdf.text(`${reading.nominal} ${reading.unit}`.trim(), columns[1], y);
    pdf.text(`${reading.lowerLimit}–${reading.upperLimit}`, columns[2], y);
    pdf.text(reading.asFound || '—', columns[3], y);
    pdf.text(reading.asLeft || '—', columns[4], y);
    const readingColor: [number, number, number] = pass
      ? [20, 108, 92]
      : [190, 65, 47];
    pdf.setTextColor(readingColor[0], readingColor[1], readingColor[2]);
    pdf.text(pass ? 'PASS' : 'FAIL', columns[5], y);
    y += 7;
  });
  if (calibration.readings.length === 0) {
    pdf.setTextColor(105, 116, 111);
    pdf.setFontSize(8);
    pdf.text(
      'Summary-only record — no detailed measurement readings were captured.',
      margin,
      y,
    );
    y += 8;
  }

  y += 5;
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(31, 43, 38);
  pdf.setFontSize(9);
  pdf.text(
    'Reference standards / traceability information supplied by the organization',
    margin,
    y,
  );
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(74, 86, 80);
  pdf.setFontSize(8);
  pdf.text(
    pdf.splitTextToSize(
      calibration.standardReferences || 'No reference entered.',
      width,
    ),
    margin,
    y,
  );
  y += 12;

  if (calibration.result === 'conditional') {
    pdf.setFillColor(255, 244, 224);
    pdf.setDrawColor(232, 188, 111);
    pdf.roundedRect(margin, y, width, 22, 2, 2, 'FD');
    pdf.setTextColor(139, 79, 21);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('RESTRICTED USE', margin + 4, y + 6);
    pdf.setFont('helvetica', 'normal');
    pdf.text(
      pdf.splitTextToSize(
        `${calibration.condition}. Restriction review: ${formatDate(calibration.restrictionExpiry)}. Approved by ${calibration.approvedBy}.`,
        width - 8,
      ),
      margin + 4,
      y + 12,
    );
    y += 29;
  }

  pdf.setTextColor(65, 77, 71);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('Notes', margin, y);
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.text(
    pdf.splitTextToSize(calibration.notes || 'No notes recorded.', width),
    margin,
    y,
  );

  const snapshotHash = hashValue({ gauge, calibration });
  pdf.setDrawColor(218, 224, 219);
  pdf.line(margin, 268, 210 - margin, 268);
  pdf.setTextColor(112, 123, 118);
  pdf.setFontSize(6.8);
  pdf.text(
    pdf.splitTextToSize(
      state.settings.certificateFooter || COMPLIANCE_DISCLAIMER,
      132,
    ),
    margin,
    275,
  );
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(6);
  pdf.text(`Snapshot SHA-256: ${snapshotHash}`, margin, 289);
  pdf.text(
    'Generated by GaugeBase · Verify against the organization’s controlled record.',
    210 - margin,
    289,
    { align: 'right' },
  );
  pdf.save(`${calibration.certificateNumber}-${gauge.assetId}.pdf`);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function exportEncryptedBackup(state: AppState, password: string) {
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  if (!password) {
    download(
      plaintext,
      `gaugebase-backup-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );
  const envelope = {
    format: 'gaugebase-backup',
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256-250000',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(encrypted),
  };
  download(
    JSON.stringify(envelope),
    `gaugebase-backup-${new Date().toISOString().slice(0, 10)}.gaugebase`,
    'application/json',
  );
}

export async function importBackup(text: string, password: string) {
  const payload = JSON.parse(text);
  if (payload?.format !== 'gaugebase-backup') return payload as AppState;
  if (!password)
    throw new Error('This backup is encrypted. Enter its password.');
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const encrypted = base64ToBytes(payload.data);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted,
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as AppState;
  } catch {
    throw new Error(
      'Unable to unlock the backup. Check the password and try again.',
    );
  }
}

export function downloadLabelPng(canvas: HTMLCanvasElement, assetId: string) {
  canvas.toBlob((blob) => {
    if (blob) download(blob, `gaugebase-label-${assetId}.png`, 'image/png');
  }, 'image/png');
}

export function downloadIcs(gauges: GaugeRecord[]) {
  const events = gauges
    .filter((gauge) => gauge.nextDue)
    .map((gauge) => {
      const date = gauge.nextDue!.replaceAll('-', '');
      return [
        'BEGIN:VEVENT',
        `UID:${gauge.token}@gaugebase`,
        `DTSTART;VALUE=DATE:${date}`,
        `SUMMARY:Calibration due — ${gauge.assetId} ${gauge.name}`,
        `DESCRIPTION:Location: ${gauge.location}\\nCustodian: ${gauge.custodian}\\nCurrent state: ${stateLabel(getCalibrationState(gauge))}`,
        'END:VEVENT',
      ].join('\r\n');
    });
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GaugeBase//Calibration Schedule//EN',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
  download(
    ics,
    'gaugebase-calibration-schedule.ics',
    'text/calendar;charset=utf-8',
  );
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Unable to read file as a data URL.'));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function downloadAttachment(dataUrl: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

export function importedGauge(row: CsvPreview['rows'][number]): GaugeRecord {
  const now = new Date().toISOString();
  return {
    id: uid('gauge'),
    token: uid('token'),
    attachmentIds: [],
    createdAt: now,
    updatedAt: now,
    ...row,
  };
}
