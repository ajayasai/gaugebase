# Security policy

## Supported versions

GaugeBase is pre-1.0 software. Security fixes are applied to the latest release and `main`. Older preview releases are not maintained.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the repository’s **Security → Report a vulnerability** flow so the report and any proof of concept remain private.

Include the affected version or commit, impact, reproduction steps, and any suggested mitigation. You should receive an acknowledgement within 7 days. Disclosure timing will be coordinated after a fix is available.

## Security model

The hosted app is local-first: records and attachments are stored in the browser’s IndexedDB, with no GaugeBase account or application server. This removes a central data store, but it also means:

- anyone with access to the browser profile may be able to access the workspace;
- browser or device administrators can alter or delete local data;
- the hash-linked audit history is tamper-evident at the application level, not tamper-proof;
- backups are the operator’s responsibility; and
- reminder webhook URLs are device-local configuration and should not embed long-lived secrets.

Use password-protected backups, full-disk encryption, managed browser profiles, and appropriate endpoint controls for sensitive deployments. A future multi-user edition will require a separate threat model, authentication, authorization, server-side audit controls, and data-retention design.
