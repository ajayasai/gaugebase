# Operations, backup, and recovery

GaugeBase does not replace an organization’s operational procedures. Assign named owners for application administration, quality configuration, identity/membership, backup, restore, security response, and change control before production use.

## Local-mode operations

Local mode is tied to one browser profile and origin. A different browser, profile, device, hostname, or cleared site store is a different workspace.

Recommended controls:

- use a managed, encrypted device and dedicated browser profile;
- confirm browser policy will not evict the origin’s IndexedDB unexpectedly;
- restrict profile access and screen/session sharing;
- export a backup after material work and before browser, device, or application changes;
- copy backups to managed storage outside the device; and
- perform routine restore tests in a separate approved profile or environment.

If IndexedDB cannot be loaded or saved, GaugeBase enters a read-only recovery state and prompts for an export. Do not repeatedly edit, clear storage, or reset the browser before preserving accessible data and investigating quota, permissions, profile corruption, or device policy.

### Local backup formats

- `.json`: lossless and unencrypted. It contains the workspace and local attachment bytes.
- `.gaugebase`: the same logical state encrypted in the browser with AES-256-GCM. PBKDF2-SHA256, 250,000 iterations, a random salt, and a random IV are recorded in the envelope.

There is no password recovery. Store the password separately under organizational controls. A successful download is not proof of recoverability; test restore and reconcile counts, key records, attachment digests, audit chain, and schema version.

## Team-mode operations

Team mode requires the hosted authentication gateway, D1 database binding `DB`, R2 bucket binding `FILES`, and applied D1 migrations. Local development without the gateway remains local mode.

### Creating and joining

An authenticated user can create a team workspace from the current state. Before doing so, export the local workspace. The server requires initial team state to contain no attachments, verifies the local audit chain and sealed calibrations, rejects imported authenticated-approval claims, and adds authenticated promotion attribution. Upload required evidence into the created team workspace separately.

Owners and admins invite a non-owner role by email. An invitation is claimed when that normalized email signs in. Pending invites can be cancelled. Owners/admins can change non-owner roles and deactivate/reactivate access; only the owner can manage an admin, and no one can change their own access through the member-management route. Verify the correct person controls the invited identity before granting sensitive access and review pending invitations plus active membership under an external access-review procedure.

### Role operations

- Owner/Admin: edit records, approve, and invite members.
- Quality manager: edit records and approve.
- Technician: edit records but cannot create authenticated technical-review approvals.
- Reviewer: read records and create authenticated technical-review approvals.
- Auditor/Viewer: read only.

Treat owner/admin assignment as privileged. Deactivation preserves the member record and historical attribution. The application does not provide ownership transfer, permanent member deletion, custom roles, time-limited access, SCIM, or automated HR-driven deprovisioning.

### Synchronization and conflicts

Team saves carry the last observed server version. If another writer has advanced it, GaugeBase stops autosave and displays a conflict.

When a conflict occurs:

1. stop editing the conflicted view;
2. export the local copy if it contains work that must be reconciled;
3. note the server version and affected records;
4. reload the server copy;
5. compare and re-enter approved changes under the applicable procedure; and
6. verify resulting records and event history.

Do not assume unsynchronized local edits were merged. GaugeBase 1.0 has workspace-level optimistic concurrency, not field-level merge or record locks. A successful synchronization response is authoritative because the server supplies the audit chain, state hash, and attachment metadata after applying retention and role-specific integrity rules.

### Shared attachments

Shared uploads are limited to 20 MB each. R2 stores bytes; D1 stores the object key and metadata. A browser digest is checked against a server-calculated digest. Downloads require active membership.

The application does not virus-scan, content-disarm, or prove that a file is what its name/media type claims. Apply file allowlists, scanning, review, and quarantine controls outside GaugeBase when required.

If a file upload succeeds but subsequent workspace synchronization conflicts, attachment metadata/object records can require administrative reconciliation. Review D1/R2 inventory periodically for unlinked or missing objects.

## Team backup strategy

A production team backup must cover **both D1 and R2** in a consistent recovery plan:

- D1: workspace documents, versions, memberships, invitations, events, and attachment metadata;
- R2: attachment objects referenced by D1; and
- deployment configuration: release/commit, migrations, bindings, gateway settings, and applicable provider policies.

An application workspace export contains the synchronized state and R2 attachment references, but not an independent copy of shared attachment bytes. It is useful for logical recovery and reconciliation, not sufficient as the only team backup.

Define recovery point and time objectives, export/snapshot frequency, retention, immutable/offline copies when required, key/access custody, and restore-test frequency using the hosting provider’s approved mechanisms.

### Recovery rehearsal

In a non-production environment:

1. restore D1 and R2 from the same recovery point or reconcile their difference;
2. deploy the recorded application version and apply only the appropriate migrations;
3. verify active identities and role mapping without unintentionally notifying users;
4. reconcile workspace versions and event sequences;
5. sample gauges, calibrations, cases, studies, approvals, and settings;
6. download attachments and recompute their SHA-256 digests;
7. generate and verify representative certificate/manifest pairs; and
8. record actual recovery duration, data gaps, deviations, and approval.

GaugeBase does not currently expose one-click D1/R2 backup or restore, point-in-time workspace rollback, or a self-service team-workspace deletion control.

## Import and migration

CSV import covers the equipment register, not a complete historical calibration migration. Use the dry run and resolve every row error before committing. Preserve source exports and digests, reconcile counts and samples, and retain fields that cannot be represented as controlled attachments or approved migration records.

JSON restore accepts supported schema versions and migrates v1 to v2. A legacy calibration receives a snapshot marked `legacy-migration`, captured from the related gauge at migration time. Review that limitation before relying on migrated historical artifacts.

## Reminder operations

The application prepares a `mailto:` draft or sends an operator-triggered JSON webhook. It does not run scheduled server jobs, monitor delivery, retry failures, manage bounces, or provide an SMTP service.

If reminders are operationally required:

- assign an owner to review the due queue;
- use an approved automation/scheduler outside GaugeBase;
- authenticate the endpoint without exposing durable secrets in the URL;
- validate recipients and minimize content;
- monitor delivery and failures in the receiving system; and
- maintain a manual fallback.

Webhook configuration is part of workspace settings and is synchronized in team mode.

## Certificates and manifests

Archive the PDF and its matching `.manifest.json` together. Recompute the PDF digest with the built-in verifier before relying on a transferred file. A filename mismatch is reported separately from a byte mismatch.

The manifest is not signed. If non-repudiation or long-term authenticity is required, route the artifact through an approved digital-signature, timestamp, document-control, or archival service and preserve its verification chain.

## Monitoring and review

The UI exposes operational status, restriction expiry, quality cases, audit history, and synchronization conflicts. Infrastructure monitoring remains external. Monitor at least:

- authentication and route failures;
- D1 and R2 availability, capacity, backup, and restore status;
- rejected/oversized uploads and missing attachment objects;
- deployment failures and migration status;
- dependency/security advisories;
- repeated concurrency conflicts;
- unresolved failed/conditional calibrations and expired restrictions; and
- failed reminder deliveries in the downstream system.

Avoid sending record contents, attachment names, email addresses, or webhook configuration to logs unless approved and protected.

## Upgrade and rollback

Before upgrading:

1. record the current release, configuration, schema, and bindings;
2. capture and verify local backups or coordinated D1/R2 backups;
3. review changelog, migrations, security notes, and validation impact;
4. rehearse migration and restore in a representative environment;
5. run approved regression tests; and
6. schedule and approve deployment with a defined rollback decision.

Application rollback after a forward-only data migration may require restoring the matching pre-upgrade D1/R2 recovery point. Never run an older build against a newer schema without proving compatibility.
