# Privacy

GaugeBase contains no advertising SDK or application analytics telemetry. Privacy responsibilities still depend on the operating mode, deployment, data entered by operators, email/webhook choices, and infrastructure provider.

## Local mode

Gauge records, calibration records, local attachments, settings, quality cases, technical studies, and audit history are stored in IndexedDB in the current browser profile. No GaugeBase account is required.

The application fetches its own assets. Workspace data leaves the browser only when an operator takes an action such as:

- sending a configured reminder webhook;
- opening a prepared `mailto:` draft;
- joining or creating a team workspace;
- downloading, printing, importing, or restoring an artifact; or
- following a shared-attachment download link.

Clearing site data, removing the browser profile, or losing the device can delete the local workspace. Export regular backups to approved storage.

## Team mode

Team mode uses the identity supplied by ChatGPT sign-in. GaugeBase processes the authenticated user identifier, email address, and display name to create membership, attribute team events and approvals, and claim invites addressed to that verified email.

The team deployment stores:

- workspace name, version, timestamps, and the synchronized workspace document in D1;
- member identities, roles, active state, and join times in D1;
- invitations, invite status, and inviter identifiers in D1;
- server-sequenced event actors, summaries, timestamps, and hashes in D1;
- attachment metadata and SHA-256 digests in D1; and
- shared attachment bytes in R2.

The workspace document may contain names, email addresses, locations, free-text notes, procedures, quality-case details, and other organization-supplied information. Do not enter personal or sensitive data that is unnecessary for the intended calibration process.

Workspace members can read the synchronized operational records. Owners and admins can also see the membership and invitation lists. Access is controlled by application roles, but hosting-provider administrators may have infrastructure access under the provider’s controls and terms.

## Attachments and exports

Local attachments are stored as part of the local workspace and are included in a local workspace backup. Team attachments are stored as R2 objects; a workspace export contains their metadata and download references, not a standalone copy of the shared bytes.

Shared downloads require an active workspace membership. Downloaded PDFs, manifests, CSV files, calendar files, and backups are outside application access control once saved. Operators must handle them under their own classification and retention rules.

Optional backup passwords are processed in the browser. PBKDF2-SHA256 with 250,000 iterations derives an AES-256-GCM key. GaugeBase does not transmit, store, recover, or escrow that password. A lost password makes the encrypted archive unrecoverable through the application.

## Email and webhooks

A reminder webhook receives the configured recipient, subject, message text, and a minimal gauge summary. A `mailto:` draft transfers the prepared content to the operator’s email client. Those operators and providers process the supplied information under their own terms.

Webhook configuration is stored inside workspace settings. In team mode it is synchronized with the team state and may be visible to workspace members. Use a dedicated endpoint and avoid secrets in the URL.

## Retention and deletion

Retiring a gauge preserves its controlled history. Local data can be removed by clearing the site’s browser storage after exporting anything that must be retained.

The application does not currently provide a self-service team-workspace deletion, per-record erasure, automated retention schedule, or R2 lifecycle manager. A team deployer must establish provider-level retention, backup, legal-hold, access-removal, and deletion procedures for D1, R2, and infrastructure logs. Removing a membership does not by itself erase historical event attribution where retention is required.

## Controller responsibility

The organization operating GaugeBase determines why records and personal data are collected and is responsible for notices, lawful basis, data minimization, access requests, retention, cross-border processing, vendor assessment, and any controller/processor obligations. This document describes application behavior; it is not a privacy certification or legal opinion.
