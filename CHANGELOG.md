# Changelog

All notable changes are documented here. GaugeBase follows Semantic Versioning from 1.0 onward.

## 1.0.0 — 2026-08-31

### Calibration and record integrity

- Added schema v2 migration with site, department, criticality, standard validity, structured standard linkage, quality cases, and technical studies.
- Sealed completed calibrations with an immutable completion-time gauge snapshot, canonical SHA-256 record hash, snapshot hash, and lock timestamp.
- Added explicit simple-acceptance, guard-banded, and expanded-uncertainty decision rules with per-reading outcomes.
- Added calibration evidence attachments, restriction-expiry status, and automatic quality cases for fail and conditional results.
- Added PDF-byte SHA-256 manifests and a certificate/manifest verifier.

### Metrology and quality

- Added GUM-style uncertainty-budget calculations with distribution divisors, sensitivity coefficients, root-sum-square combination, expanded uncertainty, and Welch–Satterthwaite effective degrees of freedom.
- Added balanced crossed average-and-range Gage R&R with variation components, percent metrics, number of distinct categories, assumptions, and warnings.
- Added reference-point bias, OLS bias-versus-reference linearity, and chronological Xbar/R stability studies with explicit statistical assumptions and signal rules.
- Added a reviewed technical-study library.
- Added a reference-standard traceability graph, downstream-risk screening, recall cases, and quality-case workflow.
- Added conservative, explainable calibration-interval recommendations that require operator review before application.

### Team workspaces

- Added optional ChatGPT-authenticated team workspaces backed by Cloudflare D1 and shared evidence backed by Cloudflare R2.
- Added owner, admin, quality-manager, technician, reviewer, auditor, and viewer roles.
- Added optimistic workspace versioning, explicit conflict handling, server-sequenced hash-linked events, email invitations, invite cancellation, member role/deactivation controls, and authenticated record-hash-bound approvals.
- Added strict runtime domain validation, finite-reading and decision-rule checks, canonical state hashes, server-owned application-audit attribution, immutable calibration/study/closed-case retention, authoritative attachment metadata, membership scoping, upload digest verification, Unicode-safe private downloads, and separate attachment-byte storage.
- Hardened role transitions with an authoritative owner identity, insert-only invite claims, existing-member invite rejection, owner/admin hierarchy enforcement, and privacy-redacted member events for non-managers.

### Documentation and quality

- Added architecture, metrology, validation/IQ-OQ-PQ, operations, API, record-integrity, and threat-model documentation.
- Expanded unit coverage for metrology calculations, interval recommendations, migration, record integrity, runtime schemas, role transitions, technician restrictions, and spreadsheet-export safety.

The 1.0 release supports recordkeeping and validation work but does not itself establish accreditation, metrological traceability, ISO/IEC 17025 conformity, FDA compliance, or 21 CFR Part 11 electronic signatures.

## 0.1.0 — 2026-08-31

- Local-first instrument and reference-standard register.
- Due-soon, overdue, restricted-use, and out-of-service triage.
- Pass, fail, and conditional-pass calibration workflow with as-found/as-left readings.
- Calibration certificate PDF generation with immutable snapshot hash and compliance disclaimer.
- Device-local attachments with SHA-256 digests.
- Privacy-safe QR and Code 128 labels.
- Email drafts plus optional JSON reminder webhook delivery.
- Atomic CSV dry-run import, safe CSV export, and calendar export.
- Hash-linked audit history with before/after values.
- Password-protected portable backup and restore.
- Responsive PWA shell and offline cache.
