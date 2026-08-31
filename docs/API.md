# Internal team API

`/api/team/*` is the same-origin browser API used by the GaugeBase team UI. Version 1.0 does **not** promise it as a stable public integration API and does not provide API keys, OAuth scopes for third-party clients, service accounts, cross-origin access, pagination for domain records, or webhook subscriptions.

Use the UI or contribute a separately reviewed integration layer rather than scripting these routes as a long-term contract.

## Authentication model

The supported hosting gateway authenticates ChatGPT sign-in and injects reserved identity headers. Route handlers read those headers server-side, claim matching pending invitations, and check active D1 membership and role. A self-hosted team deployment must supply an equivalent trusted authentication proxy and strip any client-supplied identity headers before setting verified values.

Clients must not send or emulate identity headers. A deployment is unsafe if an untrusted client can reach the route handler while choosing those headers. All responses are `Cache-Control: no-store` unless a file route supplies stricter download headers.

JSON errors generally use:

```json
{ "error": "Human-readable message." }
```

Common statuses are 400 for malformed/invalid input, 401 for missing authentication, 403 for denied role, 404 for inaccessible or missing workspace/object, 409 for version/hash conflicts, and 413 for an invalid attachment size.

## Roles

| Permission                                                       | Roles                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| Read workspace/events/files                                      | Any active member                                         |
| Edit synchronized workspace or upload evidence                   | owner, admin, quality-manager, technician                 |
| Record authenticated review                                      | owner, admin, quality-manager, reviewer                   |
| Invite/cancel non-owner invitations and manage non-owner members | owner, admin, with hierarchy restrictions described below |

An inaccessible file is returned as 404 where practical to avoid confirming cross-workspace object existence.

## Workspace state limits

The server accepts only schema-v2 state. A strict runtime schema validates every gauge, reading, calibration, snapshot, approval, attachment, audit entry, quality case, technical study, reminder, and settings field before domain integrity checks run. Unknown fields, invalid enums, impossible calendar dates, malformed timestamps, insecure non-local webhook URLs, empty reading sets, inconsistent passing results, and incomplete conditional approvals are rejected. Collections are limited to:

| Collection        | Maximum entries |
| ----------------- | --------------: |
| Gauges            |          50,000 |
| Calibrations      |         250,000 |
| Attachments       |         100,000 |
| Audit entries     |         500,000 |
| Quality cases     |         100,000 |
| Technical studies |         100,000 |

The serialized state must be no larger than 4.5 MB. Every synchronized attachment must have an empty `dataUrl`; shared bytes belong in R2.

## Routes

### `GET /api/team`

Returns the authenticated identity and active workspace memberships, newest workspace first.

```json
{
  "authenticated": true,
  "user": {
    "userId": "provider-user-id",
    "displayName": "Casey Example",
    "email": "casey@example.test",
    "fullName": "Casey Example"
  },
  "workspaces": [
    {
      "workspaceId": "team-…",
      "workspaceName": "Example laboratory",
      "role": "reviewer",
      "version": 8,
      "updatedAt": "2026-08-31T08:00:00.000Z"
    }
  ]
}
```

Without an authenticated identity, it returns 401 with `{ "authenticated": false }`.

### `POST /api/team`

Creates a team workspace and owner membership from a sanitized v2 state.

```json
{
  "name": "Example laboratory",
  "state": {
    "schemaVersion": 2,
    "gauges": [],
    "calibrations": [],
    "attachments": [],
    "audit": [],
    "qualityCases": [],
    "technicalStudies": [],
    "settings": { "organizationName": "Example" }
  }
}
```

The name must be 2–120 characters. Initial team state cannot contain attachments; required local evidence must be uploaded after creation. The server verifies the imported application audit chain and every sealed calibration, rejects duplicate calibration/certificate/event identifiers and imported claims of authenticated approval, and appends authenticated promotion attribution. Success is 201 with workspace ID, name, owner role, version 1, and creation timestamp. Creation also stores the canonical state hash and writes the first server event linked to `GENESIS`.

### `GET /api/team/workspace?workspaceId={id}`

Returns the current state, role, version, timestamp, canonical state hash, and last server event hash to an active member. Owners/admins additionally receive member and invite lists.

### `PUT /api/team/workspace`

Replaces the synchronized workspace document using optimistic concurrency.

```json
{
  "workspaceId": "team-…",
  "expectedVersion": 8,
  "state": { "schemaVersion": 2 },
  "summary": "Calibration event saved"
}
```

Only editing roles are accepted. `state` must be a complete valid v2 document; the abbreviated object above is illustrative, not valid.

Before accepting a normal synchronization, the server verifies the stored state hash and then applies integrity policy:

- the submitted application-audit array is not authoritative; the server preserves its stored chain and appends authenticated attribution;
- existing gauges, calibrations, attachment evidence, technical studies, and quality cases cannot be removed;
- every calibration must pass sealed-record verification, contain complete finite reading values, and keep certificate/event numbers unique;
- an existing calibration’s core/snapshot hashes cannot change, new calibrations cannot arrive with approvals, and existing approval arrays cannot be changed through this route;
- every new reading must store its decision outcome and explanation; uncertainty-dependent rules require a non-negative expanded uncertainty at every point;
- existing technical studies cannot be rewritten;
- attachment records are replaced with D1-authoritative metadata and must link bidirectionally to the correct target;
- a technician cannot change organization-wide settings, create a pre-closed quality case, or close an active one; closed cases are immutable through generic synchronization; and
- the conditional D1 write requires the expected version, prior state hash, and prior event hash.

A successful response reports the authoritative next state, next version, state hash, server event hash, and update time. Clients should adopt the returned state because it contains server-owned audit and attachment values.

A stale version returns 409:

```json
{
  "error": "Workspace changed on another device.",
  "currentVersion": 9
}
```

The client must not retry by substituting the new version without first loading and reconciling current state.

### `POST /api/team/invites`

Owner/admin only. Creates or refreshes a pending invite for a syntactically valid email and a non-owner role.

```json
{
  "workspaceId": "team-…",
  "email": "technician@example.test",
  "role": "technician"
}
```

The invite is claimed when the normalized email next authenticates. Claims are insert-only: they cannot overwrite an existing membership or the authoritative owner. An email already present in the member table, including an inactive member, cannot be invited again; use member reactivation instead. This endpoint does not send email by itself. The operation advances workspace version and appends a server event without changing the state hash. An admin cannot invite another admin; the owner can.

### `DELETE /api/team/invites`

Owner/admin only. Cancels a pending invitation.

```json
{
  "workspaceId": "team-…",
  "inviteId": "invite-…"
}
```

The invite must belong to the workspace and still be pending. An admin cannot cancel an admin invitation. Success marks it `cancelled`, advances workspace version, and appends a server event without changing operational state.

### `PATCH /api/team/members`

Owner/admin only. Changes a non-owner member’s role and active state.

```json
{
  "workspaceId": "team-…",
  "targetUserId": "provider-user-id",
  "role": "reviewer",
  "active": true
}
```

`role` must be a non-owner role even when deactivating. An actor cannot use this route on the workspace owner or themselves. An admin cannot manage an existing admin or assign the admin role; those operations require the owner. Setting `active` to `false` removes workspace access while retaining historical identity/event attribution. Setting it back to `true` reactivates the member with the supplied role.

Success advances workspace version and appends `member.role-updated` or `member.deactivated` to the server event chain without changing operational state.

### `GET /api/team/events?workspaceId={id}&limit={n}`

Returns newest-first server events plus a full-chain verification result to an active member. `limit` is clamped to 1–500 and defaults to 100. Each event includes sequence, authenticated actor email, action, summary, resulting state hash, previous event hash, current event hash, and timestamp. Invitation/member-management summaries are redacted for non-manager roles; owners and admins receive the detailed target summary.

The verification recomputes every stored event hash and link, checks contiguous sequence/version, verifies the current state digest, and compares the final event/state hashes to the workspace row. This route is an application event log, not a complete infrastructure security log.

### `POST /api/team/files?workspaceId={id}&targetType={type}&targetId={id}`

Uploads raw bytes for an editing member. `targetType` is `gauge` or `calibration`. Required/request headers are:

- `Content-Type`: stored media type, defaulting to `application/octet-stream`;
- `X-GaugeBase-Filename`: URI-encoded source filename; and
- `X-GaugeBase-SHA256`: optional but sent by the first-party client, 64-character digest of the bytes.

The body must be 1 byte–20,000,000 bytes. Before authorizing the target, the server recomputes the stored workspace-state digest. It then recomputes the file SHA-256, rejects a supplied mismatch, writes an opaque workspace-scoped R2 object, and inserts D1 metadata. Workspaces are capped at 2,000 shared files and 2 GB through application checks. Success is 201 with an `AttachmentRecord` containing an empty `dataUrl` and a same-origin download URL.

Do not infer file safety from a valid digest. The route does not scan content or verify the declared file format.

### `GET /api/team/files?workspaceId={id}&id={attachmentId}`

Downloads the object for an active member. The response includes stored content type/length, a sanitized attachment filename, `X-GaugeBase-SHA256`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`.

### `POST /api/team/approvals`

Records an authenticated approval against an unchanged sealed calibration.

```json
{
  "workspaceId": "team-…",
  "expectedVersion": 8,
  "calibrationId": "calibration-…",
  "recordHash": "64-character-sha256",
  "meaning": "technical-review"
}
```

The route accepts `technical-review`, `release`, or `conditional-use` meanings at the domain boundary. The current first-party UI records technical review. The server requires a review-capable role, current workspace version, exact stored record hash, valid sealed-record verification, and no prior approval with the same authenticated user identity and meaning. `release` is restricted to a passing record; `conditional-use` is restricted to a conditional pass. It appends the approval and application audit entry, then writes a versioned team state event.

A successful approval identifies the authenticated signer, role, time, meaning, source record hash, and `authenticated-identity` assurance. It is not represented as a regulatory electronic signature.

## Missing lifecycle operations

The 1.0 internal API does not include a public search endpoint, per-record CRUD model, permanent member deletion, ownership transfer, attachment deletion, team-workspace deletion, retention endpoint, externally anchored audit proof, or service credential. Deactivation preserves the member row and historical attribution. Handle provider-level deletion, backup, ownership continuity, and retention through controlled operational processes.

## Change policy

Routes may change with application releases. A proposal to make them public should add a versioned schema, formal authentication/authorization model, CSRF/origin controls, rate limiting, idempotency, pagination, stable error codes, audit coverage, lifecycle endpoints, compatibility policy, OpenAPI specification, and dedicated integration tests.
