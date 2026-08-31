# Security policy

## Supported versions

Security fixes are applied to the latest 1.x release and `main`. The 0.x preview line is not maintained.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository’s **Security → Report a vulnerability** flow so the report and any proof of concept remain private.

Include the affected version or commit, operating mode, deployment environment, impact, reproduction steps, and any suggested mitigation. You should receive an acknowledgement within 7 days. Disclosure timing will be coordinated after a fix is available.

Do not include real calibration records, personal data, credentials, authentication headers, backup passwords, webhook endpoints, or attachment contents in a report. Use synthetic examples.

## Security boundaries

GaugeBase has two materially different operating modes.

### Local mode

The browser profile is the security boundary. Workspace records and local attachment bytes are stored in IndexedDB. There is no application account or server authorization layer in this mode.

- Anyone who can access the browser profile may be able to read, export, alter, or delete the workspace.
- A device or browser administrator can replace the entire local store, including hash-linked history.
- Hashes make application-level changes detectable when a trusted comparison value exists; they do not prevent changes.
- Unencrypted JSON backups contain the full local workspace. Encrypted backups protect confidentiality only as strongly as their password and endpoint handling.
- Local approvals are explicitly marked as asserted identity and are not independently authenticated.

Use managed browser profiles, full-disk encryption, endpoint access control, approved backup storage, and routine restore tests when local mode holds sensitive records.

### Team mode

Team mode relies on the supported hosting gateway to supply authenticated ChatGPT identity headers. The application scopes every team request through active D1 membership and role checks. Shared state and event metadata are held in D1; shared attachment bytes are held in R2.

- Only the trusted gateway may set the identity headers. Do not expose a deployment path that lets clients inject or overwrite them. Self-hosting team mode requires an equivalent trusted authentication proxy; ordinary reverse-proxy forwarding is not enough.
- Owner and admin roles can invite, cancel invitations, and manage non-owner memberships. Only the owner can manage an admin; actors cannot change their own membership through that route. Owner, admin, quality-manager, and technician roles can change workspace records. Owner, admin, quality-manager, and reviewer roles can create technical-review approvals. Auditor and viewer roles are read-only.
- Updates use an expected workspace version plus stored state/event hashes. A conflict stops automatic saving, but this is not a database-level field merge or record-locking system.
- The server verifies stored state before a write, preserves its own application-audit chain, appends authenticated attribution, verifies sealed calibrations, prevents removal of controlled record sets, and replaces client attachment metadata with workspace-authoritative D1 values.
- The synchronized workspace is a validated JSON document with a 4.5 MB request limit. Attachment bytes are excluded and uploaded separately.
- Shared attachments are limited to 20 MB. The server recalculates SHA-256, checks an optional caller digest, scopes downloads by membership, sets `Content-Disposition: attachment`, and adds `X-Content-Type-Options: nosniff`.
- Uploads are not malware scanned, content-disarm processed, or validated as genuine calibration evidence. Deployers should add those controls when their risk assessment requires them.
- Team event hashes are server sequenced but remain application-level controls. Database/platform administrators can alter or replace data, and no external timestamp or signing service anchors the chain.

Review [the threat model](docs/THREAT_MODEL.md) and [operations guide](docs/OPERATIONS.md) before production use.

## Release dependency audit

For 1.0.0, `npm audit --omit=dev` reports zero production vulnerabilities. The full development-tree audit reports four moderate findings from an older `esbuild` nested under the `drizzle-kit` migration CLI. That package is not bundled into the deployed application, and the suggested forced remediation would install a breaking, older Drizzle Kit release. Keep development services loopback-only, review upstream updates, and remove the exception when a compatible dependency path is available.

## Certificate and approval limits

Certificate manifests contain SHA-256 checksums. They are not digital signatures, public-key attestations, or trusted timestamps. A valid PDF/manifest match proves only that the checked PDF bytes match that manifest. It does not prove who created the files, that the source values were correct, or that a measurement was traceable.

Team approvals use the hosting identity and bind the approval to a sealed record hash. They are not claimed to implement all controls required for FDA 21 CFR Part 11 or another electronic-signature regime. Organizations must assess identity assurance, signature meaning, reauthentication, segregation of duties, retention, and procedural controls for their intended use.

## Deployment checklist

- Deploy only from a reviewed commit and preserve build provenance.
- Keep framework and dependency security fixes current; investigate audit findings rather than applying breaking upgrades blindly.
- Bind D1 and R2 only to the intended environment and restrict administrative access through the provider.
- Confirm the authentication gateway strips client-supplied identity headers before adding trusted values.
- Enforce HTTPS and expected same-origin behavior. The internal API does not advertise cross-origin or service-token access.
- Establish D1 and R2 backup, restore, retention, legal-hold, and deletion procedures outside the application.
- Treat reminder webhook URLs as sensitive configuration visible within the workspace; do not embed long-lived credentials in them.
- Restrict exported backups, PDFs, manifests, and CSV files according to their contents.
- Test role boundaries, concurrent-update behavior, backup recovery, manifest verification, and audit-chain verification after deployment changes.
- Define log handling and incident response at the hosting layer; GaugeBase does not include an operator-facing security log service.

## Out of scope for the application

The project does not supply endpoint security, malware scanning, SIEM integration, automatic account lifecycle management, customer-managed encryption keys, WORM retention, disaster-recovery replication, or a vendor validation package. These may be required controls in a particular deployment.
