# Record and certificate integrity

GaugeBase uses SHA-256 checks to make selected changes detectable. Hashing is not the same as access control, immutable/WORM storage, a digital signature, or an independently trusted timestamp.

## Sealed calibration core

At completion, a new calibration records:

- `gaugeSnapshot`: selected equipment identity, manufacturer/model/serial, range/unit, location/site/department, procedure, capture time, and capture source;
- `snapshotHash`: SHA-256 of the canonical snapshot;
- `lockedAt`: completion record creation time; and
- `recordHash`: SHA-256 of the immutable calibration core including the snapshot, snapshot hash, and lock time.

Canonical JSON sorts object keys, preserves array order, normalizes negative zero to zero, omits undefined object properties, represents undefined array entries as null, and rejects circular references and non-finite numbers. SHA-256 is calculated over its UTF-8 bytes.

The core hash excludes these appendable fields:

- `approvals`, so a review can be attached after completion; and
- `attachmentIds`, so evidence can be linked after completion.

The compatibility `certificateHash` alias is also excluded from verification. Changing an excluded field does not invalidate `recordHash`; each approval contains the record hash it reviewed, and attachment records carry their own digest.

`verifySealedCalibration` recalculates the snapshot and immutable-core hashes. A match shows that those in-memory values are identical to the values originally hashed. It does not show that the record was correct when entered or that a privileged actor has not replaced both the data and hashes.

## Historical migration

Schema-v1 calibrations did not contain a completion snapshot. Migration creates one using the related gauge values available at migration time, marks its source `legacy-migration`, and seals the migrated representation.

This makes subsequent changes detectable but cannot reconstruct missing historical truth. A migration-time snapshot must not be presented as proof of the equipment configuration at the original calibration date. Retain original certificates and migration reconciliation evidence.

## Application audit chain

Each application `AuditEntry` includes the previous entry hash, with the first entry linked to `GENESIS`. The entry hash covers its ID, timestamp, actor, action, entity, summary, optional before/after values, and predecessor.

The audit verifier walks the chain and recalculates every hash. Deleting, reordering, or altering an entry without rebuilding later hashes is detected. The chain is stored with the workspace, however, so a device or database administrator can replace the entire chain. It is not externally anchored, signed, or write-once.

Application audit coverage follows implemented application actions. It is not a complete operating-system, browser, authentication-provider, infrastructure-administrator, database-query, or file-access log.

When local data is promoted to team mode, the server first verifies the imported audit chain and rejects an imported claim that an approval already had authenticated assurance. The server then appends an authenticated promotion entry. On normal team synchronization, client-proposed audit entries are not trusted: the next state starts with the stored server copy of the application chain and adds a server-produced, authenticated sync entry.

## Team event chain

Every successful versioned team state write appends a D1 event containing a workspace sequence, authenticated actor, action, summary, time, resulting canonical state hash, previous event hash, and current hash. The workspace row records both the current state hash and last-event hash. Before an update, the server recalculates the stored state digest; the conditional write requires the expected version, prior state hash, and prior event hash to remain unchanged.

This creates an additional server-generated order independent of the browser’s local application history. Team synchronization also verifies sealed calibrations, rejects deletion or replacement of existing calibrations, prevents forged approval arrays, retains controlled record sets, and restores attachment metadata from D1 rather than accepting it from the client. It still shares the D1/platform trust boundary and has no external timestamp or signature. Membership, invitation, and infrastructure actions are not necessarily represented as versioned workspace-state events; use provider logs and organizational procedures for full security/accountability coverage.

## Attachment digests

Local and team attachment metadata includes SHA-256, but the covered representation differs. Local mode hashes the stored data-URL representation. Team mode hashes raw file bytes: the browser calculates a digest and the server independently recalculates it before accepting bytes; the D1 metadata and R2 object custom metadata record that byte digest.

A digest match detects byte changes relative to a trusted digest. It does not identify the author, scan for malware, prove the file type, validate certificate contents, or establish traceability. In local mode, an administrator able to replace the whole workspace can replace both bytes and digest.

## PDF and detached manifest

Certificate generation renders the source record to a PDF, obtains the final PDF bytes, and calculates their SHA-256. It downloads a paired JSON manifest containing:

- format/version identifier;
- certificate and event numbers;
- expected PDF filename;
- generation time;
- record and snapshot hashes;
- PDF SHA-256; and
- a verification note.

The built-in verifier parses a supported manifest, recomputes the selected PDF’s SHA-256, compares it to `pdfSha256`, and reports filename agreement separately.

### What a successful verification means

- The checked PDF bytes match the digest written in the checked manifest.
- The manifest reports which source record/snapshot hashes the generator associated with those bytes.

### What it does not mean

- The manifest came from GaugeBase or a particular organization; it is not signed.
- The record and snapshot currently exist on a trusted server.
- The measurement, uncertainty, decision rule, standard, approval, or traceability statement is technically valid.
- The PDF has not been backdated; `generatedAt` is not a trusted timestamp.
- A filename match proves identity; names are only a convenience check.

An attacker who can replace both files can create a matching checksum pair. For non-repudiation or independent authenticity, apply an approved public-key signature, trusted timestamp, controlled document repository, or archival service after generation and retain its verification evidence.

## Verification procedure

For a received GaugeBase certificate:

1. obtain the PDF and manifest through an approved channel;
2. use the Audit view’s certificate verifier to select both files;
3. require a matching PDF digest and investigate a filename mismatch;
4. compare certificate/event identity and source hashes to a trusted workspace or controlled record export;
5. review authenticated approvals, linked standards, evidence, restrictions, and technical content; and
6. preserve the PDF, manifest, verification evidence, and any external signature together.

The trusted comparison in step 4 is essential when authenticity matters. A self-consistent pair alone provides integrity, not provenance.
