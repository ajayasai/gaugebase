# Validation and IQ/OQ/PQ guidance

This guide is a starting framework for an organization’s own validation work. It is not a completed protocol, validation package, regulatory opinion, or evidence that GaugeBase is fit for a specific intended use.

The deploying organization owns intended use, risk classification, requirements, protocols, acceptance criteria, execution evidence, deviations, approvals, training, change control, and continued validated state.

## 1. Define intended use and boundaries

Write a controlled intended-use statement before testing. It should identify:

- sites, departments, equipment classes, and record volumes in scope;
- whether local mode, team mode, or both are permitted;
- which functions are relied upon for a quality decision;
- which functions are advisory only, including interval suggestions and technical-study classifications;
- required roles, segregation of duties, approval meanings, and identity assurance;
- permitted decision rules and uncertainty methods;
- systems providing source data and systems receiving exports or webhooks;
- record-retention, backup, recovery-time, and recovery-point expectations;
- data classifications and prohibited content; and
- explicit exclusions, manual controls, and fallback procedures.

Do not broaden a validation conclusion beyond the tested application version, hosting configuration, browser/device baseline, procedures, and user population.

## 2. Build a requirements and risk trace

Create unique user and functional requirement identifiers. For each, record failure impact, likelihood/detectability, planned control, verification method, and acceptance evidence. Suggested risk areas include:

- wrong due/overdue status or interval calculation;
- invalid calibration result accepted or due date advanced incorrectly;
- incomplete conditional-use restriction;
- incorrect decision-rule or uncertainty result;
- wrong reference-standard linkage or missed downstream exposure;
- mutation of a completed record without detection;
- unauthorized team read, edit, approval, invitation, or attachment access;
- concurrent edits overwriting one another;
- missing, corrupt, oversized, or malicious attachments;
- failed schema migration or incomplete backup recovery;
- loss of team attachment bytes not contained in a workspace export;
- reminder misdelivery or disclosure through email/webhook; and
- misleading certificate presentation or manifest interpretation.

Source-code tests are useful development evidence, but they do not replace requirement-based testing in the deployed environment.

## 3. Installation qualification (IQ)

Capture objective evidence for the actual installation. A typical IQ verifies:

| Area              | Evidence to capture                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Release identity  | Repository commit, release/tag, package lock digest, build command, build output, deployment/version identifier         |
| Runtime           | Node/npm versions for build, supported browser and OS versions, time zone and locale, HTTPS endpoint                    |
| Configuration     | Hosting project, D1 `DB` binding, R2 `FILES` binding, authentication gateway, migrations applied, environment ownership |
| Access            | Infrastructure administrators, repository permissions, deploy authority, D1/R2 administrative access                    |
| Security baseline | TLS, origin policy, gateway header handling, endpoint controls, backup encryption/storage, dependency review            |
| Data baseline     | New-workspace behavior, schema version, demo-data disposition, storage quota assumptions                                |
| Recovery          | D1/R2/provider backup method, local export location, responsible owner, restore test environment                        |
| Documentation     | Approved SOPs, work instructions, role matrix, decision rules, calculation methods, incident and change procedures      |

For local mode, record the managed browser profile, IndexedDB persistence policy, device encryption, browser update control, and backup destination. For team mode, verify that clients cannot supply trusted identity headers directly and that all migrations completed before use.

## 4. Operational qualification (OQ)

Translate approved requirements into scripted tests with prerequisites, exact inputs, expected results, actual results, evidence references, tester, date, and independent review. Include positive, negative, boundary, and recovery cases.

### Equipment register and scheduling

- Create each equipment type and lifecycle state; verify required-field and interval validation.
- Exercise one-sided and month-end dates, leap year, due-soon inclusive boundary, due date, first overdue day, and missing due date.
- Confirm a pass advances the next due date according to procedure, a fail does not, and a failure places the gauge out of service.
- Confirm conditional use requires limitation, approver, and review/expiry date; verify due-today and expired restriction states.
- Test site, department, criticality, custodian, reference-standard validity, search, filtering, and exports.

### Calibration workflow and integrity

- Challenge empty, partial, non-finite, reversed-limit, in-limit, limit-boundary, and out-of-limit reading rows.
- Execute every approved decision rule with values well inside, on, near, and outside each limit.
- Confirm the selected rule, point outcome, explanation, source snapshot, lock time, record hash, and snapshot hash are retained.
- Change the current gauge after completion and confirm the historical certificate still uses the completion snapshot.
- Deliberately alter a copied sealed core or snapshot in a test fixture and confirm integrity verification fails.
- Append evidence or approval and confirm the sealed core hash does not change.
- Generate certificates with zero, one, and the maximum supported practical number of readings; inspect every page, footer, disclaimer, outcome, and traceability field.
- Match and mismatch PDFs/manifests; test malformed manifest JSON and filename mismatch.

### Metrology calculations

- Verify every allowed distribution divisor and an explicit divisor override against controlled independent calculations.
- Test zero uncertainty, negative/NaN/infinite inputs, zero/negative coverage factors, sensitivity signs, finite/infinite degrees of freedom, dominant contributors, and extreme magnitudes.
- Verify root-sum-square, variance percentages, Welch–Satterthwaite result, and unrounded returned values.
- Challenge simple, guard-banded, and uncertainty-aware rules with one-sided/two-sided limits, zero uncertainty, excessive guard band, overlapping intervals, and exactly-on-limit values.
- Verify a complete balanced Gage R&R example independently. Challenge duplicate, missing, unbalanced, constant, and insufficient designs; optional tolerance; negative corrected reproducibility variance; threshold boundaries; and `ndc` behavior.
- Confirm saved-study inputs, results, status, creator, and review attribution match the tested calculation.

### Traceability, cases, and intervals

- Link multiple calibrations to one or more controlled standard IDs and verify downstream counts.
- Move a standard through current, overdue, failed, and expired-restriction states; verify risk screening and recall-case creation.
- Test case types, severity, owners, dates, status transitions, disposition, and closure.
- Verify interval recommendations for no history, recent failure, conditional result, five-pass streak, critical equipment, upper cap, and operator-applied change.

### Import, export, reminders, and backup

- Import valid CSV plus missing-column, duplicate-ID, invalid-email, date, interval, formula-prefix, encoding, and oversized input cases; confirm all-or-nothing behavior.
- Re-import exported records and compare controlled fields.
- Inspect iCalendar data and time-zone/date behavior in approved calendar clients.
- Verify `mailto:` output and webhook recipient/body with a test endpoint; test unreachable and non-HTTPS endpoints as applicable.
- Back up and restore local data with no password, correct password, wrong password, damaged envelope, schema v1 migration, unsupported schema, and a workspace containing attachments.
- Confirm local attachment bytes survive a local backup/restore round trip.
- Confirm a team workspace export does **not** independently contain R2 object bytes, then test the separate D1/R2 disaster-recovery procedure.

### Team authentication, roles, and concurrency

- Test unauthenticated access and each role against every route and UI action. Include cross-workspace IDs and inactive membership.
- Verify invites match normalized authenticated email; cancel pending invitations; exercise role change, deactivation, and reactivation; and confirm admin hierarchy, owner targeting, self-change, and owner-role assignment restrictions.
- Confirm an approval is denied for a stale version, wrong record hash, duplicate signer/meaning, missing record, or unapproved role.
- Attempt to forge a client audit entry, imported authenticated approval, attachment metadata, state hash, completed calibration, deleted controlled record, rewritten technical study, technician settings change, and technician case closure; verify the server rejects or replaces each proposal according to policy.
- Run two browsers against one version, save from each, and verify the stale writer receives a conflict and automatic saving stops without silent overwrite.
- Upload empty, valid, digest-mismatched, oversized, misleading-media-type, and cross-workspace files. Verify download headers and access after membership removal.
- Verify server event sequence, predecessor hashes, actor identity, summaries, limits, and behavior after a simulated failed write.

### Usability and resilience

- Exercise supported desktop/mobile widths, keyboard-only navigation, focus visibility, labels, validation messages, and screen-reader landmarks.
- Test browser refresh, network loss during team save/upload, storage quota failure, corrupted IndexedDB content, and server error recovery.
- Verify that IndexedDB failure enters read-only recovery rather than overwriting the workspace.
- Measure load, search, save, sync, export, and certificate generation at approved maximum record volumes.

## 5. Performance qualification (PQ)

PQ demonstrates the approved process with trained intended users and representative data. Suggested scenarios include:

- register and label new equipment from an approved source;
- perform a scheduled calibration with real procedure controls and qualified standards;
- issue, independently review, verify, retrieve, and archive a certificate;
- handle a failed calibration from as-found result through impact assessment and disposition;
- manage a conditional-use restriction through expiry or closure;
- complete a representative uncertainty or Gage R&R review with an independent calculation;
- invite and remove personnel according to the organization’s account process;
- resolve an actual simulated concurrency conflict without losing required data;
- restore the service and evidence objects from approved backups within target time; and
- retrieve retained records after the organization’s representative retention interval or archival simulation.

PQ acceptance should be approved by process owners and quality, not inferred from OQ completion.

## 6. Data migration

For production migration:

1. inventory sources, owners, field definitions, duplicate rules, and retention requirements;
2. map source fields to GaugeBase’s documented schema;
3. preserve original exports and checksums;
4. rehearse in a non-production workspace;
5. reconcile source and target counts plus sampled values;
6. identify which historical records receive a `legacy-migration` snapshot;
7. document fields that cannot be migrated or must remain as attachments; and
8. approve cutover, rollback, and post-cutover verification.

Do not represent a migration-time snapshot as the original historical equipment state.

## 7. Release and change control

For every upgrade, assess code, dependencies, migrations, calculation behavior, security controls, browser/runtime support, and documentation changes. Define regression scope from affected requirements and risk rather than version number alone.

Preserve:

- approved source/release identifier and dependency lock;
- build and deployment evidence;
- migration and rollback rehearsal;
- test results and deviations;
- approval to release; and
- user communication and training records.

Revalidate after changes that can affect record meaning, calculations, access control, identity, storage, certificate output, backup recovery, or infrastructure boundaries.

## 8. Continued validated state

Establish periodic review of users and roles, failed sign-ins and infrastructure logs, unresolved conflicts, overdue restrictions, backup success and restore tests, storage limits, dependency advisories, quality deviations, and application changes. Define incident response and business continuity for application, identity gateway, D1, R2, email/webhook providers, and client devices.

Validation evidence is environment- and use-specific. The open-source project supplies inspectable behavior and automated tests, not the organization’s final validation conclusion.
