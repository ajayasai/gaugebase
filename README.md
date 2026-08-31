<p align="center">
  <img src="public/og.png" alt="GaugeBase — Calibration control without the lock-in" width="100%" />
</p>

# GaugeBase

**Open-source calibration operations, metrology studies, traceability, and controlled team workflows without proprietary data lock-in.**

**[Open the live application](https://gaugebase.ajaiasai.chatgpt.site)**

GaugeBase combines an instrument register, calibration execution, technical calculations, quality follow-up, portable records, and optional authenticated collaboration. It can be used without an account in local mode or connected to a shared team workspace when identity-attributed work is needed.

GaugeBase aims to make capable calibration software inspectable and portable. It is not advertised as independently proven superior to every commercial product, and using it does not by itself establish accreditation, validation, or regulatory compliance.

## What ships in 1.0

### Calibration operations

- Measuring-equipment and reference-standard register with asset, serial, manufacturer, model, range, site, department, location, custodian, criticality, procedure, interval, and lifecycle fields
- Due-soon, overdue, failed, restricted-use, and expired-restriction triage
- Scheduled and unscheduled calibration records with pass, fail, and conditional-pass outcomes
- Strict as-found/as-left reading capture, stored limits, expanded uncertainty, and point-level conformity results
- Explicit simple-acceptance, guard-banded, and uncertainty-aware decision rules
- Required limitation, review date, and approver for conditional use; automatic out-of-service state after failure
- Immutable completion-time gauge snapshots and SHA-256 hashes for the sealed calibration core
- PDF certificates plus detached manifests that verify the exact downloaded PDF bytes
- QR and Code 128 labels containing an opaque equipment token
- CSV register import/export, iCalendar due-date export, reminder drafts, and optional JSON webhook delivery

### Metrology and quality

- Uncertainty budgets with normal, rectangular, triangular, and U-shaped distributions; sensitivity coefficients; coverage factors; and Welch–Satterthwaite effective degrees of freedom
- Balanced crossed average-and-range Gage R&R with repeatability, reproducibility, part variation, % study variation, % contribution, % tolerance, and number of distinct categories
- Reference-point bias with a Student-t confidence interval, full-range linearity by OLS regression, and chronological Xbar/R stability studies with limit, shift, and trend signals
- Saved draft or reviewed technical-study records with role-aware team workflow
- Structured reference-standard links and a downstream traceability-risk view
- Out-of-tolerance, recall, deviation, and CAPA case records
- Explainable interval-review suggestions that require human approval before changing a schedule

### Local and team operation

- Account-free local mode backed by IndexedDB, including device-local attachments up to 5 MB each
- Lossless JSON or password-protected AES-256-GCM workspace backups
- Optional team mode using ChatGPT sign-in, a Cloudflare D1 workspace/event store, and Cloudflare R2 evidence storage
- Owner, admin, quality-manager, technician, reviewer, auditor, and viewer roles with invitations, role changes, access deactivation, and invitation cancellation
- Optimistic version checks that stop automatic saving when concurrent edits conflict
- Authenticated, record-hash-bound technical-review approvals in team mode
- Strict server-side domain schemas, finite-reading/decision validation, server-verified sealed records, authoritative attachment metadata, authenticated audit attribution, and canonical state hashes
- Server-sequenced, hash-linked team state events and shared attachments up to 20 MB each
- No advertising or analytics telemetry in the application

## Choose an operating mode

| Capability         | Local mode                                              | Team mode                                                        |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------- |
| Sign-in            | None                                                    | ChatGPT identity                                                 |
| Workspace records  | Browser IndexedDB                                       | Versioned state in D1                                            |
| Attachments        | Browser IndexedDB, included in local backup             | R2 objects plus D1 metadata                                      |
| Collaboration      | One browser profile                                     | Role-based shared workspace                                      |
| Approval assurance | Locally asserted identity                               | Authenticated identity bound to a record hash                    |
| Concurrency        | Single browser                                          | Optimistic version detection; no field-level merge               |
| Offline use        | Available after the application has loaded successfully | Local mode only; team synchronization needs a network connection |

The installable offline fallback uses the dedicated `/local` shell. The service worker never caches team API responses, sign-in/sign-out traffic, or identity-rendered navigation responses; shared workspaces always require a live authenticated request.

Local mode is useful for evaluation, isolated workstations, and smaller operations. Anyone who can access the browser profile may be able to read or change its data, and clearing site storage can erase the workspace.

Team mode is optional. Shared workspace state, identity information, event metadata, invites, and attachment metadata are stored in D1; attachment bytes are stored in R2. A workspace export contains team attachment metadata and links, not an independent copy of R2 object bytes. Operators therefore need provider-level backup and retention procedures for a production team deployment.

See [Architecture](docs/ARCHITECTURE.md), [Operations](docs/OPERATIONS.md), and [Privacy](PRIVACY.md) before selecting a mode.

## Quick start

Requirements: Node.js 22.13 or newer.

```bash
git clone https://github.com/ajayasai/gaugebase.git
cd gaugebase
npm ci
npm run dev
```

Then open `http://localhost:3000`.

Run the quality gates before deploying a change:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Local development does not manufacture a trusted ChatGPT identity. Team mode depends on the authentication headers supplied by the supported hosting gateway and configured D1/R2 bindings. A self-hosted team deployment needs an equivalent trusted authentication proxy that strips client-supplied identity headers before adding verified identity. Local mode remains available without those services.

## Record integrity and certificates

When a calibration is completed, GaugeBase captures a gauge snapshot and hashes both the snapshot and the immutable calibration core. Approvals and attachment links are appendable and intentionally excluded from that core hash. The application-level audit history is also hash linked.

Certificate generation downloads two files:

1. a PDF rendered from the sealed source record; and
2. a detached `.manifest.json` containing the PDF SHA-256 digest and the source record/snapshot hashes.

The verifier can show that a PDF matches its manifest. It is a checksum mechanism, not a digital signature, trusted timestamp, certificate-authority assertion, or proof that the underlying measurement was technically correct. Read [Record integrity](docs/RECORD_INTEGRITY.md) for the exact boundary.

## Metrology scope

The calculation engines are transparent and unit tested, but they cannot choose a valid measurement model, determine contributor independence, establish traceability, or approve a method. The Gage R&R implementation is the balanced crossed average-and-range method, not ANOVA. Interval recommendations are conservative screening suggestions, not autonomous schedule changes.

Organizations must define and validate their own methods, distributions, correlations, coverage factors, decision rules, risk criteria, and acceptance authority. See [Metrology assumptions](docs/METROLOGY.md).

## Reminder delivery

Without configuration, **Remind** opens a pre-addressed email draft. An HTTPS webhook in Settings can receive a JSON object containing `to`, `subject`, `text`, and a minimal gauge summary. The application does not include an SMTP service or a background scheduler. Use an approved private endpoint or automation service, and never put long-lived secrets in a webhook URL.

## Validation and compliance scope

GaugeBase preserves records and supplies testable controls that can support a regulated or accredited organization’s validation work. It does **not** automatically provide ISO/IEC 17025, ISO 9001, FDA 21 CFR Part 11, or other compliance; validate itself in a particular environment; confer accreditation; establish metrological traceability; or replace qualified technical review.

Electronic approvals are not represented as Part 11-compliant electronic signatures. Generated certificates report organization-supplied data and are not independent accreditation or calibration evidence.

Teams considering controlled use should start with the [validation and IQ/OQ/PQ guide](docs/VALIDATION.md), document intended use and risks, execute their own protocols, and control the deployed configuration under their quality system.

## Documentation

- [Architecture and data flows](docs/ARCHITECTURE.md)
- [Metrology methods and assumptions](docs/METROLOGY.md)
- [Validation and IQ/OQ/PQ guidance](docs/VALIDATION.md)
- [Operations, backup, restore, and recovery](docs/OPERATIONS.md)
- [Internal team API](docs/API.md)
- [Record and certificate integrity](docs/RECORD_INTEGRITY.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Security policy](SECURITY.md) and [privacy notes](PRIVACY.md)

## Open-source project

GaugeBase is Apache-2.0 licensed. Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Security reports belong in GitHub’s private vulnerability-reporting flow, not a public issue.

Commercial calibration products may include capabilities GaugeBase does not yet offer, such as vendor-supported validation packages, broad ERP integrations, automated email infrastructure, specialized uncertainty libraries, device ingestion, or contractual support. Feature decisions and limitations are public here so teams can evaluate fit on evidence rather than marketing claims.
