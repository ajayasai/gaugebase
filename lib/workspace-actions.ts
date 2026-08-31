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
  readingResult,
  stateLabel,
  uid,
} from './model';
import {
  createCertificateManifest,
  sha256Bytes,
  verifySealedCalibration,
  type CertificateManifest,
} from './record-integrity';

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
  const firstSignificant = Array.from(text).find((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return !(
      /\s/u.test(character) ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0xfeff
    );
  });
  return firstSignificant && '=+-@'.includes(firstSignificant)
    ? `'${text}`
    : text;
}

function sanitizeSpreadsheetRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      sanitizeSpreadsheetCell(value),
    ]),
  );
}

export function gaugesCsvContent(gauges: GaugeRecord[]) {
  const rows = gauges.map((gauge) =>
    sanitizeSpreadsheetRow({
      asset_id: gauge.assetId,
      name: gauge.name,
      type: gauge.type,
      manufacturer: gauge.manufacturer,
      model: gauge.model,
      serial_number: gauge.serial,
      range: gauge.range,
      unit: gauge.unit,
      site: gauge.site,
      department: gauge.department,
      criticality: gauge.criticality,
      location: gauge.location,
      custodian: gauge.custodian,
      custodian_email: gauge.custodianEmail,
      calibration_interval_months: gauge.intervalMonths,
      due_soon_days: gauge.dueSoonDays,
      last_calibrated: gauge.lastCalibrated ?? '',
      next_due: gauge.nextDue ?? '',
      lifecycle_status: gauge.lifecycle,
      procedure: gauge.procedure,
      standard_certificate_number: gauge.standardCertificateNumber,
      standard_valid_through: gauge.standardValidThrough ?? '',
      traceability_source: gauge.traceabilitySource,
      restriction_reason: gauge.restrictionReason,
      restriction_expiry: gauge.restrictionExpiry ?? '',
      notes: gauge.notes,
    }),
  );
  return Papa.unparse(rows);
}

export function exportGaugesCsv(gauges: GaugeRecord[]) {
  download(
    gaugesCsvContent(gauges),
    `gaugebase-gauges-${new Date().toISOString().slice(0, 10)}.csv`,
    'text/csv;charset=utf-8',
  );
}

export function auditCsvContent(audit: AuditEntry[]) {
  const rows = audit.map((entry) =>
    sanitizeSpreadsheetRow({
      timestamp_utc: entry.timestamp,
      actor: entry.actor,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      summary: entry.summary,
      previous_hash: entry.previousHash,
      entry_hash: entry.hash,
    }),
  );
  return Papa.unparse(rows);
}

export function exportAuditCsv(audit: AuditEntry[]) {
  download(
    auditCsvContent(audit),
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
    const dueSoonDays = Number(raw.due_soon_days || 30);
    if (!Number.isInteger(dueSoonDays) || dueSoonDays < 0 || dueSoonDays > 365)
      errors.push(`Row ${rowNumber}: due_soon_days must be 0–365.`);
    if (
      raw.type &&
      !['measuring-equipment', 'reference-standard'].includes(raw.type)
    )
      errors.push(
        `Row ${rowNumber}: type must be measuring-equipment or reference-standard.`,
      );
    if (
      raw.criticality &&
      !['low', 'medium', 'high', 'critical'].includes(raw.criticality)
    )
      errors.push(
        `Row ${rowNumber}: criticality must be low, medium, high, or critical.`,
      );
    if (
      raw.lifecycle_status &&
      ![
        'active',
        'restricted',
        'out-of-service',
        'inactive',
        'retired',
      ].includes(raw.lifecycle_status)
    )
      errors.push(`Row ${rowNumber}: lifecycle_status is not supported.`);
    if (raw.custodian_email && !/^\S+@\S+\.\S+$/.test(raw.custodian_email))
      errors.push(`Row ${rowNumber}: custodian_email is not valid.`);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (raw.next_due && !datePattern.test(raw.next_due))
      errors.push(`Row ${rowNumber}: next_due must be YYYY-MM-DD.`);
    for (const [field, value] of [
      ['last_calibrated', raw.last_calibrated],
      ['standard_valid_through', raw.standard_valid_through],
      ['restriction_expiry', raw.restriction_expiry],
    ] as const) {
      if (value && !datePattern.test(value))
        errors.push(`Row ${rowNumber}: ${field} must be YYYY-MM-DD.`);
    }
    if (
      !assetId ||
      !name ||
      seen.has(assetId.toLowerCase()) ||
      !Number.isInteger(interval) ||
      interval < 1 ||
      interval > 120 ||
      !Number.isInteger(dueSoonDays) ||
      dueSoonDays < 0 ||
      dueSoonDays > 365
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
      site: (raw.site ?? '').trim(),
      department: (raw.department ?? '').trim(),
      criticality: ['low', 'medium', 'high', 'critical'].includes(
        raw.criticality,
      )
        ? (raw.criticality as GaugeRecord['criticality'])
        : 'medium',
      location: (raw.location ?? '').trim(),
      custodian: (raw.custodian ?? '').trim(),
      custodianEmail: (raw.custodian_email ?? '').trim(),
      intervalMonths: interval,
      dueSoonDays,
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
      standardCertificateNumber: (raw.standard_certificate_number ?? '').trim(),
      standardValidThrough: raw.standard_valid_through || undefined,
      traceabilitySource: (raw.traceability_source ?? '').trim(),
      restrictionReason: (raw.restriction_reason ?? '').trim() || undefined,
      restrictionExpiry: raw.restriction_expiry || undefined,
      notes: (raw.notes ?? '').trim(),
    });
  });
  return { rows, errors, total: parsed.data.length };
}

export function downloadCsvTemplate() {
  const template =
    'asset_id,name,type,manufacturer,model,serial_number,range,unit,site,department,criticality,location,custodian,custodian_email,calibration_interval_months,due_soon_days,last_calibrated,next_due,lifecycle_status,procedure,standard_certificate_number,standard_valid_through,traceability_source,restriction_reason,restriction_expiry,notes\nDIM-001,Digital caliper,measuring-equipment,Mitutoyo,500-196-30,SAMPLE-001,0–150,mm,Plant 1,Quality,medium,Inspection Lab,Alex Kim,alex@example.com,12,30,2026-01-15,2027-01-15,active,CAL-DIM-01 · Rev A,,,,,,Sample row';
  download(template, 'gaugebase-import-template.csv', 'text/csv;charset=utf-8');
}

export async function generateCertificatePdf(
  state: AppState,
  calibration: CalibrationRecord,
  _gauge: GaugeRecord,
) {
  const verification = verifySealedCalibration(calibration);
  if (
    !verification.valid ||
    !calibration.gaugeSnapshot ||
    !calibration.snapshotHash ||
    !calibration.recordHash
  )
    throw new Error(
      'Certificate generation is locked because the sealed calibration record did not pass integrity verification.',
    );
  const snapshot = calibration.gaugeSnapshot;
  const snapshotHash = calibration.snapshotHash;
  const recordHash = calibration.recordHash;
  const sealedCalibration = calibration;
  const issuer = calibration.issuerSnapshot ?? {
    organizationName: state.settings.organizationName,
    certificatePrefix: state.settings.certificatePrefix,
    certificateFooter: state.settings.certificateFooter,
    capturedAt: calibration.createdAt,
  };
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
  pdf.text(issuer.organizationName, margin, 25);
  pdf.text('CALIBRATION RECORD', 210 - margin, 17, { align: 'right' });
  pdf.text(calibration.certificateNumber, 210 - margin, 25, { align: 'right' });

  pdf.setTextColor(28, 39, 35);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(snapshot.name, margin, 53);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(101, 114, 108);
  pdf.text(
    `${snapshot.assetId} · ${snapshot.manufacturer} ${snapshot.model} · S/N ${snapshot.serial || '—'}`,
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
  const contentBottom = 258;
  const continuationHeader = (section: string) => {
    pdf.setFillColor(23, 35, 31);
    pdf.rect(0, 0, 210, 23, 'F');
    pdf.setTextColor(183, 224, 74);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('GaugeBase', margin, 14);
    pdf.setTextColor(235, 241, 237);
    pdf.setFontSize(7.5);
    pdf.text(
      `${calibration.certificateNumber} · ${section}`,
      210 - margin,
      14,
      { align: 'right' },
    );
    y = 33;
  };
  const ensureSpace = (height: number, section: string) => {
    if (y + height <= contentBottom) return false;
    pdf.addPage();
    continuationHeader(section);
    return true;
  };
  const drawTextSection = (title: string, lines: string[], section: string) => {
    ensureSpace(12, section);
    const drawTitle = (continued = false) => {
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(31, 43, 38);
      pdf.setFontSize(9);
      pdf.text(`${title}${continued ? ' — continued' : ''}`, margin, y);
      y += 5;
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(74, 86, 80);
      pdf.setFontSize(8);
    };
    drawTitle();
    lines.forEach((line) => {
      if (ensureSpace(5, section)) drawTitle(true);
      pdf.text(line, margin, y);
      y += 4;
    });
    y += 4;
  };
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
  field('Range', `${snapshot.range} ${snapshot.unit}`.trim(), margin, 42);
  field('Location', snapshot.location, 65, 42);
  field('Environment', calibration.environmentalConditions, 112, 80);

  y += 20;
  pdf.setDrawColor(218, 224, 219);
  pdf.line(margin, y, 210 - margin, y);
  y += 9;
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(31, 43, 38);
  pdf.setFontSize(10);
  pdf.text('Measurement results', margin, y);
  const columns = [margin, 70, 96, 121, 148, 176];
  const drawReadingHeader = (includeTitle = false) => {
    if (includeTitle) {
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(31, 43, 38);
      pdf.setFontSize(9);
      pdf.text('Measurement results — continued', margin, y);
      y += 7;
    } else {
      y += 7;
    }
    [
      'Characteristic',
      'Nominal',
      'Limits',
      'As found',
      'As left',
      'Result',
    ].forEach((header, i) => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(110, 120, 116);
      pdf.text(header, columns[i], y);
    });
    y += 5;
  };
  drawReadingHeader();
  calibration.readings.forEach((reading) => {
    const result = reading.decisionOutcome ?? readingResult(reading);
    const resultLabel =
      result === 'pass'
        ? 'PASS'
        : result === 'fail'
          ? 'FAIL'
          : result === 'conditional'
            ? 'REVIEW'
            : result === 'indeterminate'
              ? 'INDETERMINATE'
              : 'NOT EVALUATED';
    const cells = [
      pdf.splitTextToSize(reading.characteristic || 'Reading', 48),
      pdf.splitTextToSize(`${reading.nominal} ${reading.unit}`.trim(), 23),
      pdf.splitTextToSize(`${reading.lowerLimit}–${reading.upperLimit}`, 22),
      pdf.splitTextToSize(reading.asFound || '—', 23),
      pdf.splitTextToSize(reading.asLeft || '—', 25),
      pdf.splitTextToSize(resultLabel, 16),
    ];
    const rowHeight = Math.max(
      7,
      ...cells.map((cell) => cell.length * 3.5 + 1),
    );
    if (ensureSpace(rowHeight, 'Measurement results')) drawReadingHeader(true);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(36, 48, 43);
    cells.slice(0, 5).forEach((cell, index) => {
      pdf.text(cell, columns[index], y);
    });
    const readingColor: [number, number, number] =
      result === 'pass'
        ? [20, 108, 92]
        : result === 'fail'
          ? [190, 65, 47]
          : [178, 102, 25];
    pdf.setTextColor(readingColor[0], readingColor[1], readingColor[2]);
    pdf.text(cells[5], columns[5], y);
    y += rowHeight;
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
  const ruleLines = pdf.splitTextToSize(
    calibration.decisionRuleStatement ||
      'No decision-rule statement was stored with this legacy record.',
    width,
  ) as string[];
  drawTextSection(
    'Conformity decision rule',
    ruleLines,
    'Decision and traceability',
  );
  const frozenStandards = calibration.standardSnapshots ?? [];
  const referenceLines = pdf.splitTextToSize(
    frozenStandards.length
      ? frozenStandards
          .map(
            (standard) =>
              `${standard.assetId} · ${standard.name} · S/N ${standard.serial || '—'} · Certificate ${standard.certificateNumber || 'not entered'} · Valid through ${standard.validThrough || 'not entered'} · ${standard.traceabilitySource || 'traceability source not entered'}`,
          )
          .join('\n')
      : calibration.standardReferences || 'No reference entered.',
    width,
  ) as string[];
  drawTextSection(
    'Reference standards / traceability information supplied by the organization',
    referenceLines,
    'Traceability',
  );

  if (calibration.result === 'conditional') {
    const restrictionLines = pdf.splitTextToSize(
      `${calibration.condition}. Restriction review: ${formatDate(calibration.restrictionExpiry)}. Approved by ${calibration.approvedBy}.`,
      width - 8,
    );
    const restrictionHeight = Math.max(22, 15 + restrictionLines.length * 3.5);
    ensureSpace(restrictionHeight + 7, 'Restricted-use authorization');
    pdf.setFillColor(255, 244, 224);
    pdf.setDrawColor(232, 188, 111);
    pdf.roundedRect(margin, y, width, restrictionHeight, 2, 2, 'FD');
    pdf.setTextColor(139, 79, 21);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('RESTRICTED USE', margin + 4, y + 6);
    pdf.setFont('helvetica', 'normal');
    pdf.text(restrictionLines, margin + 4, y + 12);
    y += restrictionHeight + 7;
  }

  const noteLines = pdf.splitTextToSize(
    calibration.notes || 'No notes recorded.',
    width,
  ) as string[];
  drawTextSection('Notes', noteLines, 'Notes and approvals');

  const approvals = calibration.approvals ?? [];
  if (approvals.length > 0) {
    ensureSpace(13, 'Notes and approvals');
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(65, 77, 71);
    pdf.setFontSize(8);
    pdf.text('Hash-bound technical approvals', margin, y);
    y += 5;
    approvals.forEach((approval) => {
      if (ensureSpace(7, 'Technical approvals')) {
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(65, 77, 71);
        pdf.setFontSize(8);
        pdf.text('Hash-bound technical approvals — continued', margin, y);
        y += 5;
      }
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.text(
        `${approval.signerName} · ${approval.signerRole || 'reviewer'} · ${formatDate(approval.signedAt)} · ${approval.recordHash.slice(0, 12)}…`,
        margin,
        y,
      );
      y += 5;
    });
  }

  const pageCount = pdf.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    pdf.setPage(pageNumber);
    pdf.setDrawColor(218, 224, 219);
    pdf.line(margin, 264, 210 - margin, 264);
    pdf.setTextColor(112, 123, 118);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.2);
    const footerLines = pdf.splitTextToSize(
      issuer.certificateFooter || COMPLIANCE_DISCLAIMER,
      118,
    );
    pdf.text(footerLines.slice(0, 2), margin, 270);
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(5.2);
    pdf.text(`Record: ${recordHash}`, margin, 282);
    pdf.text(`Snapshot: ${snapshotHash}`, margin, 286);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.2);
    pdf.text(
      `Page ${pageNumber} of ${pageCount} · Detached manifest verifies PDF bytes`,
      210 - margin,
      286,
      { align: 'right' },
    );
  }
  const fileName = `${calibration.certificateNumber}-${snapshot.assetId}.pdf`;
  const pdfBytes = pdf.output('arraybuffer');
  const pdfSha256 = await sha256Bytes(pdfBytes);
  const manifest = createCertificateManifest({
    calibration: sealedCalibration,
    fileName,
    generatedAt: new Date().toISOString(),
    pdfSha256,
  });
  download(pdfBytes, fileName, 'application/pdf');
  download(
    JSON.stringify(manifest, null, 2),
    fileName.replace(/\.pdf$/i, '.manifest.json'),
    'application/json;charset=utf-8',
  );
  return manifest;
}

export async function verifyCertificatePair(pdfFile: File, manifestFile: File) {
  const manifest = JSON.parse(await manifestFile.text()) as CertificateManifest;
  if (
    manifest?.format !== 'gaugebase-certificate-manifest' ||
    manifest.version !== 1 ||
    ![manifest.pdfSha256, manifest.recordHash, manifest.snapshotHash].every(
      (digest) => /^[a-f0-9]{64}$/i.test(digest),
    )
  )
    throw new Error('This is not a supported GaugeBase certificate manifest.');
  const actualPdfSha256 = await sha256Bytes(await pdfFile.arrayBuffer());
  return {
    valid: actualPdfSha256 === manifest.pdfSha256.toLowerCase(),
    actualPdfSha256,
    manifest,
    filenameMatches: pdfFile.name === manifest.fileName,
  };
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
  if (!dataUrl.startsWith('data:') && !dataUrl.startsWith('/api/team/files?'))
    throw new Error(
      'Attachment downloads must use local data or the same-origin evidence endpoint.',
    );
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
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
