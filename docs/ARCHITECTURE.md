# Architecture

GaugeBase 1.0 is a TypeScript/React progressive web application built with Vinext. One UI supports two persistence modes: an account-free local workspace and an optional authenticated team workspace.

## Runtime boundaries

```text
                                      optional team mode
Browser UI ── same-origin requests ─────────────────────────────────────┐
  │                                                                     │
  ├─ domain rules, status, decisions, metrology calculations            ▼
  ├─ PDF / CSV / iCalendar / QR / Code 128 generation        Hosting authentication gateway
  ├─ SHA-256 record, artifact, attachment, and audit hashes             │ trusted identity headers
  ├─ encrypted backup / restore (Web Crypto)                            ▼
  ├─ IndexedDB local workspace                               Vinext server routes
  └─ optional mailto or operator-configured webhook            ├─ membership + role checks
                                                               ├─ state validation + version check
                                                               ├─ D1 workspace/members/invites/events
                                                               └─ R2 attachment bytes
```

Metrology calculations and artifact generation run in the browser. Team route handlers authenticate and authorize shared data operations. Local mode does not require or simulate a server identity.

## Application state

The versioned schema is `AppState.schemaVersion = 2`:

- `GaugeRecord` stores equipment or reference-standard identity, organizational placement, criticality, lifecycle, interval, due projection, controlled-standard metadata, restriction state, and attachment links.
- `CalibrationRecord` stores event identity, result, conditions, readings, decision rule, traceability links, restriction approval, certificate identity, completion snapshot, integrity hashes, approvals, and evidence links.
- `AttachmentRecord` stores common metadata, target, digest, and either local bytes as a data URL or a team download reference.
- `AuditEntry` stores actor, action, entity, summary, optional before/after values, predecessor hash, and entry hash.
- `QualityCase` represents out-of-tolerance, recall, deviation, or CAPA work and its impact window/disposition.
- `TechnicalStudyRecord` stores uncertainty-budget or Gage R&R inputs and results with review state.
- `WorkspaceSettings` stores organization identity, actor/reminder configuration, certificate presentation, and the default decision rule.

The browser database uses Dexie over IndexedDB. Schema-v1 workspaces are migrated in memory to v2 before use. Legacy calibration snapshots are marked `legacy-migration` and reflect the gauge fields available at migration time; they must not be interpreted as evidence of the original completion-time configuration.

## Local persistence

Local mode stores one complete workspace under the `primary` key in IndexedDB. Autosave occurs after the state is hydrated. If IndexedDB loading or writing fails, the application enters a read-only recovery state instead of silently replacing data with the demo workspace.

Local attachments are encoded in the workspace and limited by the UI to 5 MB each. This is convenient and portable but can approach browser quota quickly. Quota and eviction policies are controlled by the browser and device, not GaugeBase.

Plain JSON backups contain the whole local state. Password-protected `.gaugebase` archives use PBKDF2-SHA256 with 250,000 iterations and a random salt to derive an AES-256-GCM key with a random IV. The envelope stores the algorithm, KDF, salt, IV, and ciphertext; the password is neither stored nor recoverable.

## Team persistence

The team data model uses these D1 tables:

- `team_workspaces`: workspace name, owner, serialized v2 state, canonical state hash, optimistic version, last event hash, and timestamps;
- `team_members`: workspace/user composite identity, email, display name, role, active flag, and join time;
- `team_invites`: normalized email, role, inviter, status, and acceptance timestamps;
- `team_events`: workspace sequence, authenticated actor, action, summary, state hash, predecessor hash, entry hash, and timestamp; and
- `team_attachments`: target, R2 object key, filename, media type, size, SHA-256, creator, and timestamp.

The operational domain is currently synchronized as a versioned JSON document rather than normalized into one SQL row per gauge or calibration. The server validates v2 shape and collection ceilings and rejects a synchronized document larger than 4.5 MB. Attachment bytes are removed before synchronization and stored separately in R2.

This design gives atomic workspace versions and a straightforward portable schema. It also means a write replaces the serialized workspace state, there is no field-level merge, and very large datasets will eventually need a normalized or partitioned server model.

### Synchronization

The browser keeps a `TeamSession` containing workspace ID, role, server version, last synchronized state hash, and timestamp. Editable changes are debounced and submitted with `expectedVersion`.

1. The server verifies active membership and edit permission.
2. It compares `expectedVersion` with the current workspace version and recalculates the stored canonical state hash before accepting a change.
3. It enforces server-owned integrity rules: application audit is based on the current server chain, attachments come from authoritative D1 metadata, retained record sets cannot be deleted, sealed calibrations cannot be replaced, and existing technical studies cannot be rewritten.
4. It adds an authenticated application-audit entry, calculates the next state hash, and stores the next state only when version, prior state hash, and prior event hash still match.
5. It appends a server-sequenced event containing the next state hash and linked to the previous server event hash.
6. A stale writer receives HTTP 409; automatic synchronization stops until the operator preserves any needed local copy and reloads the server version.

There is no collaborative cursor, record lease, automatic three-way merge, or offline write queue for team mode.

### Attachments

Team uploads are 1 byte to 20 MB and target either a gauge or calibration. The browser sends a SHA-256 digest; the server calculates the digest again and rejects a mismatch. The object is written under a workspace-scoped opaque R2 key, then its metadata is inserted in D1. If metadata insertion fails, the route removes the newly written object.

Downloads require active membership and return as attachments with `private, no-store` caching and `nosniff`. Filenames are normalized for response headers. The application does not scan for malware or confirm that a file’s contents match its stated media type.

## Authentication and authorization

The supported hosting gateway supplies authenticated user ID, email, and encoded full name through reserved request headers. Application code must never trust equivalent headers received directly from an untrusted client. A self-hosted deployment must place an equivalent trusted authentication proxy in front of the application and must strip client-supplied identity headers before setting its own. Sign-in, sign-out, and callback paths are guarded against unsafe external return URLs.

Invites are matched to a normalized authenticated email when the user next signs in. Membership and role are checked in every team route; UI visibility is not an authorization control. Owners/admins can cancel pending invitations, assign non-owner roles, and deactivate/reactivate non-owner memberships. Only the owner can manage an admin; actors cannot change their own membership through that route. These management actions advance workspace version and append server events while leaving the operational state hash unchanged.

| Role            | Edit workspace | Record authenticated review | Manage invitations | Read workspace |
| --------------- | -------------: | --------------------------: | -----------------: | -------------: |
| Owner           |            Yes |                         Yes |                Yes |            Yes |
| Admin           |            Yes |                         Yes |                Yes |            Yes |
| Quality manager |            Yes |                         Yes |                 No |            Yes |
| Technician      |            Yes |                          No |                 No |            Yes |
| Reviewer        |             No |                         Yes |                 No |            Yes |
| Auditor         |             No |                          No |                 No |            Yes |
| Viewer          |             No |                          No |                 No |            Yes |

This is application RBAC, not a complete identity-governance system. Deactivation preserves membership history and event attribution. The current release does not include ownership transfer, permanent member deletion, SCIM, SSO policy configuration, automated HR-driven deprovisioning, approval reauthentication, or configurable custom roles.

## Record and event integrity

A completed calibration captures selected gauge fields in `CalibrationGaugeSnapshot`. The snapshot gets a canonical SHA-256 digest. The calibration core, including that snapshot and lock timestamp, gets a second canonical SHA-256 digest. Approval objects and attachment-link arrays are excluded so evidence and review can be appended without changing the sealed core. Team synchronization verifies every sealed calibration, prevents deletion or re-hashing of an existing calibration, rejects pre-populated approvals on a new record, and permits authenticated approvals only through the dedicated approval route.

Local application audit entries form a separate SHA-256 predecessor chain. On team creation the server verifies that imported chain, rejects imported claims of authenticated approval, and appends its own authenticated promotion entry. On later team synchronization the client-proposed audit is not authoritative: the server starts from the stored chain and appends authenticated attribution. Team state writes additionally create a server-sequenced event chain that covers the resulting canonical state hash. Neither chain is signed or anchored outside the application infrastructure; a sufficiently privileged database or platform administrator can replace a whole chain.

PDF generation hashes the final downloaded bytes and writes that digest into a detached manifest along with record and snapshot hashes. See [Record integrity](RECORD_INTEGRITY.md) for verification semantics.

## Important domain invariants

- Due-soon begins inclusively at `nextDue - dueSoonDays`; overdue begins the day after the due date.
- Month intervals clamp to the last valid day of the target month.
- A failed calibration places the gauge out of service and does not advance the due date.
- Conditional pass requires a limitation, restriction review/expiry date, and approver. An expired restriction has its own dashboard state.
- Reading rows must contain finite numeric limits and values, and the lower limit cannot exceed the upper limit.
- The selected decision rule is applied explicitly; guard-banded and uncertainty-aware detailed readings require applicable uncertainty input in the workflow.
- Structured reference-standard IDs, rather than free text alone, drive downstream traceability-risk screening.
- Imported gauge rows are validated as a complete batch before any write, and formula-like CSV values are neutralized only in export output.
- An interval recommendation never changes the schedule until an authorized operator applies it.
- Team workspaces retain gauges, calibrations, attachments, technical studies, and quality cases instead of accepting client-side deletion. Existing technical studies are append-only. Technicians cannot change organization-wide settings or close an existing quality case.

## External interactions

The app can create `mailto:` drafts or make an operator-triggered POST to an HTTPS reminder webhook. It does not include SMTP delivery, a server scheduler, incoming equipment integration, or a general external REST authentication scheme. The `/api/team/*` routes are internal, same-origin browser APIs documented in [API](API.md).

## Deployment and scaling limits

- Team mode requires the D1 binding `DB`, R2 binding `FILES`, and the supported authentication gateway.
- D1 migrations under `drizzle/` must be applied before routes serve traffic.
- Workspace synchronization is capped at 4.5 MB; collection validation also imposes explicit maximum counts.
- R2 attachments are not embedded in workspace backups. Back up D1 and R2 as one recoverable system.
- The application has no built-in background job worker, email service, virus scanner, WORM store, or cross-region disaster-recovery manager.
- Operational logs, infrastructure encryption, data residency, retention, and administrative access are hosting responsibilities.

Read [Operations](OPERATIONS.md), [Security](../SECURITY.md), and [Threat model](THREAT_MODEL.md) before a production deployment.
