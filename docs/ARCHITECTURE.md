# Architecture

GaugeBase 0.1 is a local-first progressive web application built with React, TypeScript, Vinext, and IndexedDB.

## Runtime boundaries

```text
Browser UI
  ├─ domain rules (dates, status, readings, audit hashes)
  ├─ IndexedDB workspace (Dexie)
  ├─ PDF / CSV / QR / Code 128 generation
  ├─ encrypted backup and restore (Web Crypto)
  └─ optional operator-triggered webhook or mailto
```

There is no GaugeBase-operated application database, account service, or telemetry endpoint in this edition. The deployed server delivers application assets; controlled records stay in the browser profile.

## Workspace schema

The persisted `AppState` contains a versioned collection of:

- `GaugeRecord`: identity, location, custodian, interval, due projection, procedure, lifecycle, and attachment links;
- `CalibrationRecord`: event identity, result, context, readings, restriction approval, standards reference, certificate identity, and snapshot hash;
- `AttachmentRecord`: metadata, device-local data URL, and SHA-256 digest;
- `AuditEntry`: actor, action, entity, before/after data, predecessor hash, and entry hash; and
- `WorkspaceSettings`: organization identity, reminder rules, webhook, certificate prefix, and backup status.

The schema is intentionally small for the single-device release. Multi-user work will require normalized server-side entities, organization scoping, optimistic concurrency, authenticated actors, immutable blob storage, migrations, and server-generated audit sequencing.

## Important invariants

- Due-soon begins inclusively at `nextDue - dueSoonDays`; overdue begins the day after the due date.
- Month intervals clamp to the last valid day of the target month.
- A fail places the gauge out of service and does not advance the due date.
- Conditional pass requires a limitation, review/expiry date, and approving manager.
- A pass cannot be recorded when a captured reading is outside its stored limits.
- Imported records are validated as a complete batch before any write.
- Spreadsheet-formula prefixes are neutralized only in export output, not in stored source values.
- Audit entries link to their predecessor with SHA-256. This detects history changes but cannot prevent a device administrator from replacing the whole local store.

## Backups

Plain JSON backups are lossless. Password-protected `.gaugebase` backups use PBKDF2-SHA256 with 250,000 iterations to derive an AES-256-GCM key. The random salt and IV are stored in the envelope; the password is not.

## Compliance scope

GaugeBase supports recordkeeping. It does not perform a laboratory’s uncertainty analysis, validate methods, establish measurement traceability, enforce regulated electronic signatures, or confer accreditation or regulatory compliance.
