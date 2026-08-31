import { z } from 'zod';

import type { AppState } from './model';

const identifier = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => value.trim().length > 0, 'Identifier cannot be blank.');
const shortText = z.string().max(1_000);
const longText = z.string().max(40_000);
const requiredText = shortText.refine(
  (value) => value.trim().length > 0,
  'Value cannot be blank.',
);
const email = z.union([z.literal(''), z.email().max(320)]);
const digest = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, 'Expected a SHA-256 digest.');

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.toISOString().slice(0, 10) === value;
}

const calendarDate = z
  .string()
  .refine(
    isCalendarDate,
    'Expected a real calendar date in YYYY-MM-DD format.',
  );
const timestamp = z
  .string()
  .max(80)
  .refine(
    (value) => /T/.test(value) && Number.isFinite(Date.parse(value)),
    'Expected a valid ISO timestamp.',
  );
const lifecycle = z.enum([
  'active',
  'restricted',
  'out-of-service',
  'inactive',
  'retired',
]);
const decisionRule = z.enum([
  'simple-acceptance',
  'guard-banded',
  'uncertainty-aware',
]);

const gaugeSchema = z
  .object({
    id: identifier,
    assetId: requiredText,
    token: requiredText,
    name: requiredText,
    type: z.enum(['measuring-equipment', 'reference-standard']),
    manufacturer: shortText,
    model: shortText,
    serial: requiredText,
    range: shortText,
    unit: shortText,
    location: shortText,
    custodian: shortText,
    custodianEmail: email,
    intervalMonths: z.number().int().min(1).max(600),
    dueSoonDays: z.number().int().min(0).max(3_650),
    lastCalibrated: calendarDate.optional(),
    nextDue: calendarDate.optional(),
    lifecycle,
    procedure: shortText,
    notes: longText,
    site: shortText.optional(),
    department: shortText.optional(),
    criticality: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    standardCertificateNumber: shortText.optional(),
    standardValidThrough: calendarDate.optional(),
    traceabilitySource: shortText.optional(),
    restrictionReason: longText.optional(),
    restrictionExpiry: calendarDate.optional(),
    restrictionApprovedBy: shortText.optional(),
    attachmentIds: z.array(identifier).max(2_000),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((gauge, context) => {
    if (
      gauge.lifecycle === 'restricted' &&
      (!gauge.restrictionReason?.trim() ||
        !gauge.restrictionExpiry ||
        !gauge.restrictionApprovedBy?.trim())
    )
      context.addIssue({
        code: 'custom',
        message:
          'Restricted gauges require a reason, expiry date, and approving identity.',
      });
  });

const readingSchema = z
  .object({
    id: identifier,
    characteristic: requiredText,
    nominal: requiredText,
    lowerLimit: requiredText,
    upperLimit: requiredText,
    asFound: requiredText,
    asLeft: shortText,
    unit: requiredText,
    expandedUncertainty: shortText.optional(),
    decisionOutcome: z
      .enum(['pass', 'fail', 'conditional', 'indeterminate'])
      .optional(),
    decisionExplanation: longText.optional(),
  })
  .strict();

const standardSnapshotSchema = z
  .object({
    gaugeId: identifier,
    assetId: requiredText,
    name: requiredText,
    manufacturer: shortText,
    model: shortText,
    serial: requiredText,
    certificateNumber: requiredText,
    validThrough: calendarDate,
    traceabilitySource: requiredText,
    lifecycle,
    nextDue: calendarDate.optional(),
    capturedAt: timestamp,
  })
  .strict();

const issuerSnapshotSchema = z
  .object({
    organizationName: requiredText,
    certificatePrefix: requiredText,
    certificateFooter: longText,
    capturedAt: timestamp,
  })
  .strict();

const gaugeSnapshotSchema = z
  .object({
    gaugeId: identifier,
    assetId: requiredText,
    name: requiredText,
    type: z.enum(['measuring-equipment', 'reference-standard']),
    manufacturer: shortText,
    model: shortText,
    serial: requiredText,
    range: shortText,
    unit: shortText,
    location: shortText,
    site: shortText,
    department: shortText,
    procedure: shortText,
    capturedAt: timestamp,
    source: z.enum(['completion', 'legacy-migration']),
  })
  .strict();

const approvalSchema = z
  .object({
    id: identifier,
    meaning: z.enum(['technical-review', 'release', 'conditional-use']),
    signerName: requiredText,
    signerUserId: identifier.optional(),
    signerEmail: z.email().max(320).optional(),
    signerRole: shortText.optional(),
    signedAt: timestamp,
    recordHash: digest,
    assurance: z.enum(['local-assertion', 'authenticated-identity']),
  })
  .strict();

const calibrationSchema = z
  .object({
    id: identifier,
    eventNumber: requiredText,
    gaugeId: identifier,
    performedOn: calendarDate,
    result: z.enum(['pass', 'fail', 'conditional']),
    technician: requiredText,
    procedureRevision: requiredText,
    environmentalConditions: shortText,
    standardReferences: longText,
    standardIds: z.array(identifier).max(100).optional(),
    standardSnapshots: z.array(standardSnapshotSchema).max(100).optional(),
    issuerSnapshot: issuerSnapshotSchema.optional(),
    readings: z.array(readingSchema).min(1).max(10_000),
    notes: longText,
    condition: longText.optional(),
    restrictionExpiry: calendarDate.optional(),
    approvedBy: shortText.optional(),
    certificateNumber: requiredText,
    certificateHash: digest,
    recordHash: digest.optional(),
    snapshotHash: digest.optional(),
    gaugeSnapshot: gaugeSnapshotSchema.optional(),
    decisionRule: decisionRule.optional(),
    decisionRuleStatement: longText.optional(),
    supersedesId: identifier.optional(),
    approvals: z.array(approvalSchema).max(100).optional(),
    lockedAt: timestamp.optional(),
    attachmentIds: z.array(identifier).max(2_000),
    createdAt: timestamp,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.result === 'conditional' &&
      (!record.condition?.trim() ||
        !record.restrictionExpiry ||
        !record.approvedBy?.trim())
    )
      context.addIssue({
        code: 'custom',
        message:
          'Conditional calibration results require a limitation, expiry date, and approving identity.',
      });
    if (
      record.result === 'pass' &&
      record.readings.some(
        (reading) =>
          reading.decisionOutcome && reading.decisionOutcome !== 'pass',
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'A passing calibration cannot contain a non-passing reading.',
      });
  });

const attachmentSchema = z
  .object({
    id: identifier,
    name: requiredText,
    type: requiredText,
    size: z.number().int().min(0).max(20_000_000),
    dataUrl: z.string().max(30_000_000),
    storage: z.enum(['local', 'team']).optional(),
    downloadUrl: z.string().max(2_000).optional(),
    sha256: digest,
    createdAt: timestamp,
    targetType: z.enum(['gauge', 'calibration']),
    targetId: identifier,
  })
  .strict();

const auditSchema = z
  .object({
    id: identifier,
    timestamp,
    actor: requiredText,
    action: requiredText,
    entityType: z.enum([
      'gauge',
      'calibration',
      'attachment',
      'label',
      'settings',
      'import',
      'export',
      'backup',
      'quality-case',
      'technical-study',
      'approval',
      'team',
    ]),
    entityId: identifier,
    summary: longText,
    assurance: z.enum(['local', 'authenticated-identity']).optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    previousHash: z.union([z.literal('GENESIS'), digest]),
    hash: digest,
  })
  .strict();

const qualityCaseSchema = z
  .object({
    id: identifier,
    caseNumber: requiredText,
    type: z.enum(['out-of-tolerance', 'recall', 'deviation', 'capa']),
    status: z.enum(['open', 'investigating', 'contained', 'closed']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    title: requiredText,
    description: longText,
    gaugeId: identifier.optional(),
    calibrationId: identifier.optional(),
    owner: shortText,
    dueDate: calendarDate.optional(),
    impactWindowStart: calendarDate.optional(),
    impactWindowEnd: calendarDate.optional(),
    affectedGaugeIds: z.array(identifier).max(50_000),
    disposition: longText.optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
    closedAt: timestamp.optional(),
  })
  .strict()
  .superRefine((qualityCase, context) => {
    if (
      qualityCase.status === 'closed' &&
      (!qualityCase.closedAt || !qualityCase.disposition?.trim())
    )
      context.addIssue({
        code: 'custom',
        message: 'Closed quality cases require a disposition and closure time.',
      });
    if (qualityCase.status !== 'closed' && qualityCase.closedAt)
      context.addIssue({
        code: 'custom',
        message: 'Only a closed quality case can contain a closure time.',
      });
  });

const technicalStudySchema = z
  .object({
    id: identifier,
    kind: z.enum([
      'uncertainty-budget',
      'gage-rr',
      'bias',
      'linearity',
      'stability',
    ]),
    title: requiredText,
    gaugeId: identifier.optional(),
    status: z.enum(['draft', 'reviewed', 'approved']),
    input: z.unknown(),
    result: z.unknown(),
    createdBy: requiredText,
    reviewedBy: shortText.optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const reminderSchema = z
  .object({
    id: identifier,
    offsetDays: z.number().int().min(-3_650).max(3_650),
    recipient: z.enum(['custodian', 'quality-manager']),
    active: z.boolean(),
  })
  .strict();

const webhookUrl = z
  .string()
  .max(2_000)
  .superRefine((value, context) => {
    if (!value) return;
    try {
      const url = new URL(value);
      const localHttp =
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !localHttp)
        context.addIssue({
          code: 'custom',
          message: 'Reminder webhooks must use HTTPS (or localhost HTTP).',
        });
    } catch {
      context.addIssue({ code: 'custom', message: 'Webhook URL is invalid.' });
    }
  });

export const appStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    gauges: z.array(gaugeSchema).max(50_000),
    calibrations: z.array(calibrationSchema).max(250_000),
    attachments: z.array(attachmentSchema).max(100_000),
    audit: z.array(auditSchema).max(500_000),
    qualityCases: z.array(qualityCaseSchema).max(100_000),
    technicalStudies: z.array(technicalStudySchema).max(100_000),
    settings: z
      .object({
        organizationName: requiredText,
        actorName: shortText,
        actorEmail: email,
        qualityManagerEmail: email,
        dueSoonDays: z.number().int().min(0).max(3_650),
        reminderWebhook: webhookUrl,
        certificatePrefix: requiredText,
        certificateFooter: longText,
        defaultDecisionRule: decisionRule.optional(),
        guardBandMultiplier: z.number().min(0).max(100).optional(),
        reminderRules: z.array(reminderSchema).max(100),
        lastBackupAt: timestamp.optional(),
      })
      .strict(),
  })
  .strict();

export function parseTeamAppState(input: unknown): AppState {
  const result = appStateSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length ? ` at ${issue.path.join('.')}` : '';
    throw new Error(`Workspace validation failed${path}: ${issue.message}`);
  }
  return result.data as AppState;
}
