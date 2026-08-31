# Privacy

GaugeBase is designed to work without an account, telemetry, advertising, or a vendor-operated data service.

## Where data lives

In the hosted local-first edition, gauge records, calibration records, attachments, settings, and audit history are stored in IndexedDB inside the current browser profile. Clearing site data, removing the browser profile, or losing the device can delete the workspace. Export regular backups.

## Network activity

The app fetches its own static assets. It does not include analytics or phone-home telemetry. Network requests containing workspace data occur only when an operator explicitly:

- configures and sends to a reminder webhook;
- opens a prepared `mailto:` draft; or
- downloads or prints a generated artifact using browser facilities.

Webhook operators and email providers process the data sent to them under their own terms. Deployers are responsible for choosing appropriate providers and for their data-controller or processor obligations.

## Attachments and backups

Attachments are stored in the local workspace and included in exports. Optional backup passwords use PBKDF2-SHA256 and AES-256-GCM in the browser. GaugeBase does not receive or recover backup passwords.

## Deletion

Retiring a gauge preserves its controlled history. To delete all local data, clear the site’s storage in browser settings. Export anything that must be retained first.
