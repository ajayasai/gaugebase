# Threat model

This threat model describes GaugeBase 1.0 application behavior. It does not assess a particular hosting account, identity tenant, device fleet, network, browser extension set, webhook receiver, or organizational process. Deployers must update it for their environment and intended use.

## Assets

- equipment identity, ownership, location, schedule, status, and procedures;
- calibration readings, uncertainty values, outcomes, restrictions, and certificates;
- reference-standard relationships and quality/recall cases;
- personal identifiers such as names and email addresses;
- attachments that may contain certificates, procedures, photos, or customer information;
- local and team audit/event history;
- approvals and their association to a sealed record hash;
- backup archives and passwords;
- team membership, invitations, roles, and authenticated identity attributes;
- D1/R2 administrative access, deployment authority, source and dependency integrity; and
- reminder recipients, content, and webhook configuration.

## Actors

- authorized local operator;
- authorized team owner/admin, quality manager, technician, reviewer, auditor, or viewer;
- user with access to another authorized user’s browser/device/session;
- uninvited or inactive authenticated user;
- malicious site or network actor attempting cross-origin or request manipulation;
- contributor or dependency/supply-chain attacker;
- hosting, database, object-storage, repository, or device administrator;
- compromised webhook/email provider; and
- recipient or attacker holding exported files outside GaugeBase.

## Trust boundaries

1. **Local browser profile:** IndexedDB and the running UI share the endpoint/browser trust boundary.
2. **Authentication gateway:** reserved identity headers become trusted only after the gateway has authenticated the user and stripped client-supplied equivalents.
3. **Application routes:** same-origin requests cross from browser code into server membership, role, schema, and version validation.
4. **D1:** stores shared state, identities, roles, invites, metadata, and hash-linked events under infrastructure-administrator control.
5. **R2:** stores opaque-key attachment bytes; D1 metadata links logical IDs to object keys.
6. **Exports and integrations:** downloads, email drafts, and webhooks leave GaugeBase controls.
7. **Build/deployment:** repository, lockfile, package registry, CI, and deployment credentials determine executable provenance.

## Threats, controls, and residual risks

| Threat                              | Current application controls                                                                                                                                                                                                                                                      | Residual risk / operator action                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spoofed team identity               | Identity is read server-side from reserved hosting headers; every team route requires authentication and active membership.                                                                                                                                                       | A bypass or misconfigured gateway that accepts client-chosen headers defeats identity. Verify gateway behavior and isolate route handlers from direct untrusted access.                                                  |
| Invite claimed by wrong person      | Invite email is normalized and must match the authenticated email. Owner invitations and existing-member emails are rejected; claiming is insert-only and cannot replace a membership.                                                                                            | Email-account compromise or mistaken address grants access. Use an external identity/access-review process and revoke access promptly.                                                                                   |
| Role bypass through UI manipulation | Permissions are checked again in server handlers, not only hidden in UI. Owner authority derives from the workspace owner ID; owner/admin hierarchy prevents admins managing admins; self-change and owner targeting are denied; membership can be deactivated.                   | Application RBAC has no custom conditions, step-up authentication, ownership transfer, or automatic deprovisioning. Test every route for every role after changes.                                                       |
| Cross-workspace record/file access  | Queries include workspace ID and active membership; inaccessible files generally return 404. R2 object keys are not accepted directly from clients.                                                                                                                               | Authorization bugs remain possible. Add negative integration tests and monitor unusual access.                                                                                                                           |
| Cross-site request or origin abuse  | First-party requests are same-origin, JSON/custom upload headers trigger normal browser origin protections, and authentication is hosted.                                                                                                                                         | There is no explicit application CSRF token or documented Origin-header enforcement. Preserve strict same-origin deployment/cookie policy and add a dedicated CSRF control before exposing alternate clients.            |
| Concurrent overwrite                | Every state write and approval carries `expectedVersion`; stale writes receive 409 and autosave stops.                                                                                                                                                                            | Workspace-level conflict resolution is manual. A user can lose unsynchronized work if they reload without export/reconciliation.                                                                                         |
| Completed-record tampering          | Canonical snapshot/core hashes and hash-bound approvals expose inconsistent changes. Team sync verifies seals, prevents deletion/re-hashing, rejects approval-array forgery, preserves a server-owned application audit, and links each server event to the resulting state hash. | Privileged infrastructure actors can replace data and all hashes; hashes are not signed or externally anchored. Use restricted administration, external backups, and approved signing/archival where needed.             |
| Counterfeit certificate/manifest    | Verifier recomputes final PDF-byte SHA-256 and reports filename agreement.                                                                                                                                                                                                        | Anyone can generate a self-consistent unsigned pair. Compare to a trusted source and add digital signing/timestamping for authenticity.                                                                                  |
| Malicious or misleading attachment  | Size limit, server-side digest, opaque R2 keys, membership-scoped download, attachment disposition, `nosniff`, sanitized response filename.                                                                                                                                       | No antivirus, content-disarm, format validation, or evidence authenticity check. Add scanning/quarantine and reviewer procedures.                                                                                        |
| R2/D1 inconsistency                 | Upload verifies the stored state digest and target before accepting bytes, deletes the new R2 object if D1 metadata insertion fails, excludes bytes from state, and rebuilds attachment metadata from D1 during sync.                                                             | A later sync conflict or administrative change can leave orphaned/missing objects. Reconcile D1 metadata, workspace links, and R2 inventory; back them up together.                                                      |
| Local data disclosure/tampering     | No network account is required; encrypted backup option is available; audit changes can be checked.                                                                                                                                                                               | Anyone controlling the browser profile/device can read or replace data. Use managed profiles, device encryption, access control, and separate backups.                                                                   |
| Team data disclosure                | Membership checks, role-aware edit/review, private no-store downloads, separate R2 objects.                                                                                                                                                                                       | Every active member can read workspace operational data; owners/admins see membership/invites. Provider admins may have access. Minimize personal/free-text data and review membership.                                  |
| Export disclosure                   | Encrypted archive option; every CSV field is checked for formula prefixes after leading whitespace/control characters and neutralized on export.                                                                                                                                  | Plain JSON, CSV, PDF, manifest, calendar, and downloaded attachments are no longer access controlled. Classify and protect exports; encrypted backup does not protect separately exported artifacts.                     |
| Backup loss or ransomware           | Portable local backup; team infrastructure can be backed up by provider mechanisms.                                                                                                                                                                                               | No automatic application backup, immutable copy, or one-click D1/R2 restore. Maintain offline/immutable copies and test recovery.                                                                                        |
| Webhook/email exfiltration          | Reminders are operator triggered and webhook must be HTTPS; content is limited by the feature.                                                                                                                                                                                    | Misconfigured recipient/endpoint, synced webhook URL, downstream retention, or URL-embedded credentials can disclose data. Approve endpoints and monitor delivery outside GaugeBase.                                     |
| Resource exhaustion                 | Workspace is capped at 4.5 MB with collection ceilings; uploads are capped at 20 MB; event response limit is capped.                                                                                                                                                              | No application rate limiting, quota dashboard, per-user upload quota, or abuse worker is documented. Apply gateway/provider rate and storage controls.                                                                   |
| Shared data in browser caches       | The service worker caches only the static `/local` shell and static assets; team APIs, auth paths, and identity-rendered navigation responses are always network-only.                                                                                                            | Browser storage and HTTP caches still require endpoint controls, managed-profile policy, and clearing procedures on shared devices.                                                                                      |
| Stored/script injection             | React escapes ordinary text; download filenames are sanitized; file responses use attachment disposition and `nosniff`; CSV export neutralizes formula prefixes.                                                                                                                  | Free text and imported/exported artifacts remain untrusted. Avoid unsafe HTML rendering, sanitize new output contexts, and keep content-security/browser controls under review.                                          |
| Dependency/build compromise         | Lockfile, open source, automated type/lint/test/build gates, and reviewable deployment source.                                                                                                                                                                                    | Registry, maintainer, CI, or credential compromise can alter a build. Use protected branches/tags, dependency review, provenance, least-privilege deploy credentials, and reproducible release evidence.                 |
| Time manipulation                   | ISO timestamps and date-only domain rules are recorded consistently in the application.                                                                                                                                                                                           | Browser/server clocks are not trusted timestamps. Incorrect clocks can affect due state, restriction expiry, event time, and artifact generation time. Monitor time sources and use trusted timestamping where required. |
| Data deletion/retention failure     | Retirement preserves application history; referential D1 tables use cascade on workspace deletion.                                                                                                                                                                                | No self-service team deletion, legal hold, configurable retention, undelete, or attachment lifecycle UI. Establish provider-level procedures and require backups/approval before destructive administration.             |

## Abuse cases to test

- Send a valid state for workspace A while authenticated only to workspace B.
- Change a role in the browser payload or call an edit route directly as reviewer/viewer.
- Re-invite the owner/existing member under a weaker role, claim an invite over an inactive membership, or target the owner through member management.
- As a technician, create a pre-closed quality case, close an active one, or rewrite/reopen a closed case.
- Submit a stale version repeatedly or approve a record after another user changes the workspace.
- Submit an approval for a different record hash, duplicate signer/meaning, or missing calibration.
- Upload zero bytes, more than 20 MB, a mismatched digest, CR/LF filename, active content, or a misleading MIME type.
- Guess an attachment ID across workspaces or request a file after membership is inactive.
- Create an oversized or malformed workspace document with attachment bytes in `dataUrl`.
- Change a sealed snapshot/core, reorder/delete audit entries, or replace PDF/manifest independently.
- Import CSV values beginning with spreadsheet formulas and inspect the exported file in approved spreadsheet tooling.
- Lose network during upload/sync, force a storage-quota error, corrupt a backup, and restore D1 without matching R2.
- Attempt unsafe external sign-in return URLs and reserved authentication callback paths.

## Assumptions

- HTTPS and the supported authentication gateway are correctly configured.
- Hosting identity headers cannot be chosen by clients.
- D1/R2 bindings are private to the intended application environment.
- Application, repository, and infrastructure administrators are fewer and more strongly controlled than ordinary users.
- Supported browsers correctly enforce origin and cryptographic APIs.
- Organizations review technical content, roles, procedures, and downstream impact rather than relying solely on application labels.

If any assumption is false, reassess the affected risks before use.

## Explicit non-goals in 1.0

GaugeBase does not claim defense against a fully compromised endpoint, browser, application build, identity gateway, or hosting administrator. It does not provide malware scanning, public-key document signing, externally anchored audit logs, SIEM, SCIM, customer-managed keys, field-level encryption, WORM retention, rate limiting, or automatic disaster recovery.

Security controls support recordkeeping; they do not automatically satisfy ISO/IEC 17025, FDA 21 CFR Part 11, or another standard/regulation.
