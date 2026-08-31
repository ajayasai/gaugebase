import { getChatGPTUser, type ChatGPTUser } from '@/app/chatgpt-auth';
import { getD1 } from '@/db';
import { sha256Hex } from '@/lib/record-integrity';
import { uid, type AppState, type AttachmentRecord } from '@/lib/model';
import { parseTeamAppState } from '@/lib/team-state-schema';
import {
  describeTeamTransition,
  prepareInitialTeamState,
  prepareTeamSyncState,
  teamEventHash,
} from '@/lib/team-integrity';
import { z } from 'zod';

export const TEAM_ROLES = [
  'owner',
  'admin',
  'quality-manager',
  'technician',
  'reviewer',
  'auditor',
  'viewer',
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

export interface TeamMembership {
  workspaceId: string;
  workspaceName: string;
  role: TeamRole;
  version: number;
  updatedAt: string;
}

const teamRoleSchema = z.enum(TEAM_ROLES);
export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      ...init?.headers,
    },
  });
}

export async function authenticatedUser() {
  const user = await getChatGPTUser();
  if (!user) return null;
  await claimPendingInvites(user);
  return user;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function claimPendingInvites(user: ChatGPTUser) {
  const d1 = getD1();
  const email = normalizeEmail(user.email);
  const invites = await d1
    .prepare(
      `SELECT id, workspace_id AS workspaceId, role
       FROM team_invites
       WHERE lower(email) = ? AND status = 'pending'`,
    )
    .bind(email)
    .all<{ id: string; workspaceId: string; role: TeamRole }>();
  if (!invites.results.length) return;
  for (const invite of invites.results) {
    const invitedRole = teamRoleSchema.safeParse(invite.role);
    if (!invitedRole.success || invitedRole.data === 'owner') continue;
    const current = await d1
      .prepare(
        `SELECT w.version, w.state_hash AS stateHash,
                w.last_event_hash AS lastEventHash,
                w.owner_user_id AS ownerUserId,
                EXISTS (
                  SELECT 1 FROM team_members m
                  WHERE m.workspace_id = w.id
                    AND (m.user_id = ? OR lower(m.email) = ?)
                ) AS membershipExists
         FROM team_workspaces w WHERE w.id = ?`,
      )
      .bind(user.userId, email, invite.workspaceId)
      .first<{
        version: number;
        stateHash: string;
        lastEventHash: string;
        ownerUserId: string;
        membershipExists: number;
      }>();
    if (
      !current ||
      current.ownerUserId === user.userId ||
      Boolean(current.membershipExists)
    )
      continue;
    const acceptedAt = new Date().toISOString();
    const nextVersion = current.version + 1;
    const eventBase = {
      id: uid('event'),
      workspaceId: invite.workspaceId,
      sequence: nextVersion,
      actorUserId: user.userId,
      actorEmail: email,
      action: 'member.invite-accepted',
      summary: `${email} accepted an invitation as ${invitedRole.data}`,
      stateHash: current.stateHash,
      previousHash: current.lastEventHash,
      createdAt: acceptedAt,
    };
    const hash = teamEventHash(eventBase);
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE team_workspaces SET version = ?, last_event_hash = ?, updated_at = ?
           WHERE id = ? AND version = ? AND last_event_hash = ? AND state_hash = ?
             AND owner_user_id <> ?
             AND NOT EXISTS (
               SELECT 1 FROM team_members
               WHERE workspace_id = ?
                 AND (user_id = ? OR lower(email) = ?)
             )`,
        )
        .bind(
          nextVersion,
          hash,
          acceptedAt,
          invite.workspaceId,
          current.version,
          current.lastEventHash,
          current.stateHash,
          user.userId,
          invite.workspaceId,
          user.userId,
          email,
        ),
      d1
        .prepare(
          `INSERT INTO team_members
           (workspace_id, user_id, email, display_name, role, active, joined_at)
           SELECT ?, ?, ?, ?, ?, 1, ?
           WHERE EXISTS (
             SELECT 1 FROM team_workspaces
             WHERE id = ? AND version = ? AND last_event_hash = ?
               AND owner_user_id <> ?
           )
             AND NOT EXISTS (
               SELECT 1 FROM team_members
               WHERE workspace_id = ?
                 AND (user_id = ? OR lower(email) = ?)
             )`,
        )
        .bind(
          invite.workspaceId,
          user.userId,
          email,
          user.displayName,
          invitedRole.data,
          acceptedAt,
          invite.workspaceId,
          nextVersion,
          hash,
          user.userId,
          invite.workspaceId,
          user.userId,
          email,
        ),
      d1
        .prepare(
          `UPDATE team_invites
           SET status = 'accepted', accepted_at = ?
           WHERE id = ? AND status = 'pending'
             AND EXISTS (
             SELECT 1 FROM team_workspaces
             WHERE id = ? AND version = ? AND last_event_hash = ?
           )
             AND EXISTS (
               SELECT 1 FROM team_members
               WHERE workspace_id = ? AND user_id = ?
                 AND lower(email) = ? AND joined_at = ?
           )`,
        )
        .bind(
          acceptedAt,
          invite.id,
          invite.workspaceId,
          nextVersion,
          hash,
          invite.workspaceId,
          user.userId,
          email,
          acceptedAt,
        ),
      d1
        .prepare(
          `INSERT INTO team_events
           (id, workspace_id, sequence, actor_user_id, actor_email, action, summary, state_hash, previous_hash, hash, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM team_workspaces
             WHERE id = ? AND version = ? AND last_event_hash = ?
           )
             AND EXISTS (
               SELECT 1 FROM team_members
               WHERE workspace_id = ? AND user_id = ?
                 AND lower(email) = ? AND joined_at = ?
           )`,
        )
        .bind(
          eventBase.id,
          invite.workspaceId,
          nextVersion,
          user.userId,
          email,
          eventBase.action,
          eventBase.summary,
          current.stateHash,
          current.lastEventHash,
          hash,
          acceptedAt,
          invite.workspaceId,
          nextVersion,
          hash,
          invite.workspaceId,
          user.userId,
          email,
          acceptedAt,
        ),
    ]);
    if (results.some((result) => (result.meta.changes ?? 0) !== 1)) continue;
  }
}

export async function listMemberships(user: ChatGPTUser) {
  const result = await getD1()
    .prepare(
      `SELECT m.workspace_id AS workspaceId, w.name AS workspaceName,
              m.role, w.owner_user_id AS ownerUserId,
              w.version, w.updated_at AS updatedAt
       FROM team_members m
       JOIN team_workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? AND m.active = 1
       ORDER BY w.updated_at DESC`,
    )
    .bind(user.userId)
    .all<TeamMembership & { ownerUserId: string }>();
  return result.results.flatMap((item) => {
    const { ownerUserId, ...membership } = item;
    const role = authoritativeMembershipRole({
      userId: user.userId,
      ownerUserId,
      storedRole: item.role,
    });
    return role ? [{ ...membership, role }] : [];
  });
}

export async function requireMembership(
  user: ChatGPTUser,
  workspaceId: string,
) {
  const membership = await getD1()
    .prepare(
      `SELECT m.role, w.owner_user_id AS ownerUserId,
              w.name AS workspaceName, w.version, w.updated_at AS updatedAt
       FROM team_members m
       JOIN team_workspaces w ON w.id = m.workspace_id
       WHERE m.workspace_id = ? AND m.user_id = ? AND m.active = 1`,
    )
    .bind(workspaceId, user.userId)
    .first<{
      role: TeamRole;
      ownerUserId: string;
      workspaceName: string;
      version: number;
      updatedAt: string;
    }>();
  if (!membership) return null;
  const { ownerUserId, ...details } = membership;
  const role = authoritativeMembershipRole({
    userId: user.userId,
    ownerUserId,
    storedRole: membership.role,
  });
  return role ? { ...details, role } : null;
}

export function authoritativeMembershipRole(input: {
  userId: string;
  ownerUserId: string;
  storedRole: unknown;
}): TeamRole | null {
  if (input.userId === input.ownerUserId) return 'owner';
  const storedRole = teamRoleSchema.safeParse(input.storedRole);
  if (!storedRole.success || storedRole.data === 'owner') return null;
  return storedRole.data;
}

export function canEdit(role: TeamRole) {
  return ['owner', 'admin', 'quality-manager', 'technician'].includes(role);
}

export function canReview(role: TeamRole) {
  return ['owner', 'admin', 'quality-manager', 'reviewer'].includes(role);
}

export function canManageMembers(role: TeamRole) {
  return role === 'owner' || role === 'admin';
}

const REDACTED_MEMBER_EVENT_SUMMARIES: Readonly<Record<string, string>> = {
  'member.invited': 'A workspace invitation was created.',
  'member.invite-accepted': 'A workspace invitation was accepted.',
  'member.role-updated': 'A workspace member role was updated.',
  'member.deactivated': 'A workspace member access was deactivated.',
  'member.invite-cancelled': 'A workspace invitation was cancelled.',
};

export function teamEventSummaryForRole(
  action: string,
  summary: string,
  role: TeamRole,
) {
  if (canManageMembers(role)) return summary;
  return REDACTED_MEMBER_EVENT_SUMMARIES[action] ?? summary;
}

export function validateTeamState(input: unknown): AppState {
  const parsed = parseTeamAppState(input);
  for (const attachment of parsed.attachments) {
    if (attachment.dataUrl)
      throw new Error(
        'Team workspace state cannot contain attachment bytes. Upload files to shared evidence storage first.',
      );
  }
  const encoded = JSON.stringify(parsed);
  if (new TextEncoder().encode(encoded).byteLength > 4_500_000)
    throw new Error('The synchronized workspace state exceeds 4.5 MB.');
  return parsed;
}

export async function createTeamWorkspace(input: {
  user: ChatGPTUser;
  name: string;
  state: AppState;
}) {
  const d1 = getD1();
  const owned = await d1
    .prepare(
      `SELECT COUNT(*) AS total FROM team_workspaces WHERE owner_user_id = ?`,
    )
    .bind(input.user.userId)
    .first<{ total: number }>();
  if ((owned?.total ?? 0) >= 20)
    throw new Error(
      'The authenticated account has reached its 20-workspace limit.',
    );
  const id = uid('team');
  const createdAt = new Date().toISOString();
  const state = prepareInitialTeamState({
    proposed: input.state,
    actorName: input.user.displayName,
    actorEmail: normalizeEmail(input.user.email),
  });
  const stateHash = sha256Hex(state);
  const eventId = uid('event');
  const eventBase = {
    id: eventId,
    workspaceId: id,
    sequence: 1,
    actorUserId: input.user.userId,
    actorEmail: normalizeEmail(input.user.email),
    action: 'workspace.created',
    summary: `${input.name} created`,
    stateHash,
    previousHash: 'GENESIS',
    createdAt,
  };
  const hash = teamEventHash(eventBase);
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO team_workspaces
         (id, name, owner_user_id, state_json, state_hash, version, last_event_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.user.userId,
        JSON.stringify(state),
        stateHash,
        hash,
        createdAt,
        createdAt,
      ),
    d1
      .prepare(
        `INSERT INTO team_members
         (workspace_id, user_id, email, display_name, role, active, joined_at)
         VALUES (?, ?, ?, ?, 'owner', 1, ?)`,
      )
      .bind(
        id,
        input.user.userId,
        normalizeEmail(input.user.email),
        input.user.displayName,
        createdAt,
      ),
    d1
      .prepare(
        `INSERT INTO team_events
         (id, workspace_id, sequence, actor_user_id, actor_email, action, summary, state_hash, previous_hash, hash, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'GENESIS', ?, ?)`,
      )
      .bind(
        eventId,
        id,
        input.user.userId,
        normalizeEmail(input.user.email),
        eventBase.action,
        eventBase.summary,
        stateHash,
        hash,
        createdAt,
      ),
  ]);
  return {
    id,
    name: input.name,
    role: 'owner' as const,
    version: 1,
    createdAt,
  };
}

export async function loadTeamWorkspace(
  user: ChatGPTUser,
  workspaceId: string,
) {
  const membership = await requireMembership(user, workspaceId);
  if (!membership) return null;
  const workspace = await getD1()
    .prepare(
      `SELECT state_json AS stateJson, state_hash AS stateHash,
              last_event_hash AS lastEventHash
       FROM team_workspaces WHERE id = ?`,
    )
    .bind(workspaceId)
    .first<{ stateJson: string; stateHash: string; lastEventHash: string }>();
  if (!workspace) return null;
  const parsedState = JSON.parse(workspace.stateJson) as AppState;
  if (sha256Hex(parsedState) !== workspace.stateHash)
    throw new Error(
      'The stored workspace digest is invalid; access is locked.',
    );
  const members = canManageMembers(membership.role)
    ? (
        await getD1()
          .prepare(
            `SELECT user_id AS userId, email, display_name AS displayName,
                    role, active, joined_at AS joinedAt
             FROM team_members WHERE workspace_id = ? ORDER BY joined_at`,
          )
          .bind(workspaceId)
          .all()
      ).results
    : undefined;
  const invites = canManageMembers(membership.role)
    ? (
        await getD1()
          .prepare(
            `SELECT id, email, role, status, created_at AS createdAt,
                    accepted_at AS acceptedAt
             FROM team_invites WHERE workspace_id = ? ORDER BY created_at DESC`,
          )
          .bind(workspaceId)
          .all()
      ).results
    : undefined;
  return {
    workspaceId,
    name: membership.workspaceName,
    role: membership.role,
    version: membership.version,
    updatedAt: membership.updatedAt,
    lastEventHash: workspace.lastEventHash,
    stateHash: workspace.stateHash,
    state: parsedState,
    members,
    invites,
  };
}

async function loadAuthoritativeAttachments(workspaceId: string) {
  const result = await getD1()
    .prepare(
      `SELECT id, filename AS name, content_type AS type, size, sha256,
              created_at AS createdAt, target_type AS targetType,
              target_id AS targetId
       FROM team_attachments WHERE workspace_id = ? ORDER BY created_at`,
    )
    .bind(workspaceId)
    .all<Omit<AttachmentRecord, 'dataUrl' | 'storage' | 'downloadUrl'>>();
  return new Map(
    result.results.map((attachment) => [
      attachment.id,
      {
        ...attachment,
        dataUrl: '',
        storage: 'team' as const,
        downloadUrl: `/api/team/files?workspaceId=${encodeURIComponent(workspaceId)}&id=${encodeURIComponent(attachment.id)}`,
      },
    ]),
  );
}

export async function updateTeamWorkspace(input: {
  user: ChatGPTUser;
  workspaceId: string;
  expectedVersion: number;
  state: AppState;
  summary: string;
  permission?: 'edit' | 'review';
  operation?: 'sync' | 'approval';
}) {
  const membership = await requireMembership(input.user, input.workspaceId);
  const permitted =
    membership &&
    (input.permission === 'review'
      ? canReview(membership.role)
      : canEdit(membership.role));
  if (!membership || !permitted) return { status: 'forbidden' as const };
  if (membership.version !== input.expectedVersion)
    return { status: 'conflict' as const, currentVersion: membership.version };
  const d1 = getD1();
  const current = await d1
    .prepare(
      `SELECT state_json AS stateJson, state_hash AS stateHash,
              last_event_hash AS lastEventHash
       FROM team_workspaces WHERE id = ? AND version = ?`,
    )
    .bind(input.workspaceId, input.expectedVersion)
    .first<{ stateJson: string; stateHash: string; lastEventHash: string }>();
  if (!current)
    return { status: 'conflict' as const, currentVersion: membership.version };
  const currentState = JSON.parse(current.stateJson) as AppState;
  if (sha256Hex(currentState) !== current.stateHash)
    throw new Error(
      'The stored workspace digest is invalid; synchronization is locked.',
    );
  const synchronizedSummary =
    input.operation === 'approval'
      ? input.summary.slice(0, 300)
      : describeTeamTransition(currentState, input.state).slice(0, 300);
  const nextState =
    input.operation === 'approval'
      ? input.state
      : prepareTeamSyncState({
          current: currentState,
          proposed: input.state,
          authoritativeAttachments: await loadAuthoritativeAttachments(
            input.workspaceId,
          ),
          actorName: input.user.displayName,
          actorEmail: normalizeEmail(input.user.email),
          actorRole: membership.role,
          summary: synchronizedSummary,
        });
  const stateHash = sha256Hex(nextState);
  const nextVersion = input.expectedVersion + 1;
  const createdAt = new Date().toISOString();
  const eventBase = {
    id: uid('event'),
    workspaceId: input.workspaceId,
    sequence: nextVersion,
    actorUserId: input.user.userId,
    actorEmail: normalizeEmail(input.user.email),
    action: 'workspace.state-updated',
    summary: synchronizedSummary,
    stateHash,
    previousHash: current.lastEventHash,
    createdAt,
  };
  const hash = teamEventHash(eventBase);
  const results = await d1.batch([
    d1
      .prepare(
        `UPDATE team_workspaces
         SET state_json = ?, state_hash = ?, version = ?, last_event_hash = ?, updated_at = ?
         WHERE id = ? AND version = ? AND state_hash = ? AND last_event_hash = ?`,
      )
      .bind(
        JSON.stringify(nextState),
        stateHash,
        nextVersion,
        hash,
        createdAt,
        input.workspaceId,
        input.expectedVersion,
        current.stateHash,
        current.lastEventHash,
      ),
    d1
      .prepare(
        `INSERT INTO team_events
         (id, workspace_id, sequence, actor_user_id, actor_email, action, summary, state_hash, previous_hash, hash, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM team_workspaces
           WHERE id = ? AND version = ? AND last_event_hash = ?
         )`,
      )
      .bind(
        eventBase.id,
        input.workspaceId,
        nextVersion,
        input.user.userId,
        normalizeEmail(input.user.email),
        eventBase.action,
        eventBase.summary,
        stateHash,
        current.lastEventHash,
        hash,
        createdAt,
        input.workspaceId,
        nextVersion,
        hash,
      ),
  ]);
  if (
    (results[0].meta.changes ?? 0) !== 1 ||
    (results[1].meta.changes ?? 0) !== 1
  ) {
    const latest = await d1
      .prepare(`SELECT version FROM team_workspaces WHERE id = ?`)
      .bind(input.workspaceId)
      .first<{ version: number }>();
    return {
      status: 'conflict' as const,
      currentVersion: latest?.version ?? membership.version,
    };
  }
  return {
    status: 'updated' as const,
    version: nextVersion,
    hash,
    stateHash,
    state: nextState,
    updatedAt: createdAt,
  };
}

export async function inviteTeamMember(input: {
  user: ChatGPTUser;
  workspaceId: string;
  email: string;
  role: TeamRole;
}) {
  const membership = await requireMembership(input.user, input.workspaceId);
  if (!membership || !canManageMembers(membership.role)) return null;
  if (input.role === 'owner') return null;
  if (membership.role === 'admin' && input.role === 'admin') return null;
  const d1 = getD1();
  const now = new Date().toISOString();
  const id = uid('invite');
  const email = normalizeEmail(input.email);
  const existingMember = await d1
    .prepare(
      `SELECT user_id AS userId FROM team_members
       WHERE workspace_id = ? AND lower(email) = ?
       LIMIT 1`,
    )
    .bind(input.workspaceId, email)
    .first<{ userId: string }>();
  if (existingMember) return null;
  const current = await d1
    .prepare(
      `SELECT version, state_hash AS stateHash, last_event_hash AS lastEventHash
       FROM team_workspaces WHERE id = ?`,
    )
    .bind(input.workspaceId)
    .first<{ version: number; stateHash: string; lastEventHash: string }>();
  if (!current) return null;
  const nextVersion = current.version + 1;
  const eventBase = {
    id: uid('event'),
    workspaceId: input.workspaceId,
    sequence: nextVersion,
    actorUserId: input.user.userId,
    actorEmail: normalizeEmail(input.user.email),
    action: 'member.invited',
    summary: `${email} invited as ${input.role}`,
    stateHash: current.stateHash,
    previousHash: current.lastEventHash,
    createdAt: now,
  };
  const hash = teamEventHash(eventBase);
  const results = await d1.batch([
    d1
      .prepare(
        `UPDATE team_workspaces
         SET version = ?, last_event_hash = ?, updated_at = ?
         WHERE id = ? AND version = ? AND last_event_hash = ? AND state_hash = ?
           AND NOT EXISTS (
             SELECT 1 FROM team_members
             WHERE workspace_id = ? AND lower(email) = ?
           )`,
      )
      .bind(
        nextVersion,
        hash,
        now,
        input.workspaceId,
        current.version,
        current.lastEventHash,
        current.stateHash,
        input.workspaceId,
        email,
      ),
    d1
      .prepare(
        `INSERT INTO team_invites
         (id, workspace_id, email, role, invited_by, status, created_at)
         SELECT ?, ?, ?, ?, ?, 'pending', ?
           WHERE EXISTS (
             SELECT 1 FROM team_workspaces
             WHERE id = ? AND version = ? AND last_event_hash = ?
           )
             AND NOT EXISTS (
               SELECT 1 FROM team_members
               WHERE workspace_id = ? AND lower(email) = ?
             )
         ON CONFLICT(workspace_id, email) DO UPDATE SET
           role = excluded.role,
           invited_by = excluded.invited_by,
           status = 'pending',
           created_at = excluded.created_at,
           accepted_at = NULL`,
      )
      .bind(
        id,
        input.workspaceId,
        email,
        input.role,
        input.user.userId,
        now,
        input.workspaceId,
        nextVersion,
        hash,
        input.workspaceId,
        email,
      ),
    d1
      .prepare(
        `INSERT INTO team_events
         (id, workspace_id, sequence, actor_user_id, actor_email, action, summary, state_hash, previous_hash, hash, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM team_workspaces
           WHERE id = ? AND version = ? AND last_event_hash = ?
         )`,
      )
      .bind(
        eventBase.id,
        input.workspaceId,
        nextVersion,
        input.user.userId,
        normalizeEmail(input.user.email),
        eventBase.action,
        eventBase.summary,
        current.stateHash,
        current.lastEventHash,
        hash,
        now,
        input.workspaceId,
        nextVersion,
        hash,
      ),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    const racedMember = await d1
      .prepare(
        `SELECT user_id AS userId FROM team_members
         WHERE workspace_id = ? AND lower(email) = ?
         LIMIT 1`,
      )
      .bind(input.workspaceId, email)
      .first<{ userId: string }>();
    if (racedMember) return null;
    throw new Error(
      'The workspace changed while the invitation was being recorded.',
    );
  }
  const stored = await d1
    .prepare(
      `SELECT id FROM team_invites WHERE workspace_id = ? AND lower(email) = ?`,
    )
    .bind(input.workspaceId, email)
    .first<{ id: string }>();
  return {
    id: stored?.id ?? id,
    workspaceId: input.workspaceId,
    email,
    role: input.role,
    status: 'pending',
    createdAt: now,
    version: nextVersion,
  };
}

export async function updateTeamMember(input: {
  user: ChatGPTUser;
  workspaceId: string;
  targetUserId: string;
  role: Exclude<TeamRole, 'owner'>;
  active: boolean;
}) {
  const actor = await requireMembership(input.user, input.workspaceId);
  if (!actor || !canManageMembers(actor.role)) return null;
  const d1 = getD1();
  const target = await d1
    .prepare(
      `SELECT m.role, m.email, m.active,
              w.owner_user_id AS ownerUserId
       FROM team_members m
       JOIN team_workspaces w ON w.id = m.workspace_id
       WHERE m.workspace_id = ? AND m.user_id = ?`,
    )
    .bind(input.workspaceId, input.targetUserId)
    .first<{
      role: TeamRole;
      email: string;
      active: number;
      ownerUserId: string;
    }>();
  if (
    !target ||
    target.ownerUserId === input.targetUserId ||
    input.targetUserId === input.user.userId
  )
    return null;
  if (
    actor.role === 'admin' &&
    (target.role === 'admin' || input.role === 'admin')
  )
    return null;
  const current = await d1
    .prepare(
      `SELECT version, state_hash AS stateHash, last_event_hash AS lastEventHash
       FROM team_workspaces WHERE id = ?`,
    )
    .bind(input.workspaceId)
    .first<{ version: number; stateHash: string; lastEventHash: string }>();
  if (!current) return null;
  const nextVersion = current.version + 1;
  const now = new Date().toISOString();
  const action = input.active ? 'member.role-updated' : 'member.deactivated';
  const eventBase = {
    id: uid('event'),
    workspaceId: input.workspaceId,
    sequence: nextVersion,
    actorUserId: input.user.userId,
    actorEmail: normalizeEmail(input.user.email),
    action,
    summary: input.active
      ? `${target.email} assigned ${input.role}`
      : `${target.email} access deactivated`,
    stateHash: current.stateHash,
    previousHash: current.lastEventHash,
    createdAt: now,
  };
  const hash = teamEventHash(eventBase);
  const results = await d1.batch([
    d1
      .prepare(
        `UPDATE team_workspaces SET version = ?, last_event_hash = ?, updated_at = ?
         WHERE id = ? AND version = ? AND last_event_hash = ? AND state_hash = ?
           AND owner_user_id <> ?`,
      )
      .bind(
        nextVersion,
        hash,
        now,
        input.workspaceId,
        current.version,
        current.lastEventHash,
        current.stateHash,
        input.targetUserId,
      ),
    d1
      .prepare(
        `UPDATE team_members SET role = ?, active = ?
         WHERE workspace_id = ? AND user_id = ?
           AND user_id <> (
             SELECT owner_user_id FROM team_workspaces WHERE id = ?
           )
           AND EXISTS (
             SELECT 1 FROM team_workspaces
             WHERE id = ? AND version = ? AND last_event_hash = ?
           )`,
      )
      .bind(
        input.role,
        input.active ? 1 : 0,
        input.workspaceId,
        input.targetUserId,
        input.workspaceId,
        input.workspaceId,
        nextVersion,
        hash,
      ),
    d1
      .prepare(
        `INSERT INTO team_events
         (id, workspace_id, sequence, actor_user_id, actor_email, action, summary, state_hash, previous_hash, hash, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM team_workspaces
           WHERE id = ? AND version = ? AND last_event_hash = ?
         )`,
      )
      .bind(
        eventBase.id,
        input.workspaceId,
        nextVersion,
        input.user.userId,
        normalizeEmail(input.user.email),
        action,
        eventBase.summary,
        current.stateHash,
        current.lastEventHash,
        hash,
        now,
        input.workspaceId,
        nextVersion,
        hash,
      ),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1))
    throw new Error(
      'The workspace changed while member access was being updated.',
    );
  return {
    userId: input.targetUserId,
    role: input.role,
    active: input.active,
    version: nextVersion,
  };
}

export async function cancelTeamInvite(input: {
  user: ChatGPTUser;
  workspaceId: string;
  inviteId: string;
}) {
  const actor = await requireMembership(input.user, input.workspaceId);
  if (!actor || !canManageMembers(actor.role)) return null;
  const d1 = getD1();
  const invite = await d1
    .prepare(
      `SELECT email, role FROM team_invites
       WHERE id = ? AND workspace_id = ? AND status = 'pending'`,
    )
    .bind(input.inviteId, input.workspaceId)
    .first<{ email: string; role: TeamRole }>();
  if (!invite || (actor.role === 'admin' && invite.role === 'admin'))
    return null;
  const current = await d1
    .prepare(
      `SELECT version, state_hash AS stateHash, last_event_hash AS lastEventHash
       FROM team_workspaces WHERE id = ?`,
    )
    .bind(input.workspaceId)
    .first<{ version: number; stateHash: string; lastEventHash: string }>();
  if (!current) return null;
  const nextVersion = current.version + 1;
  const now = new Date().toISOString();
  const eventBase = {
    id: uid('event'),
    workspaceId: input.workspaceId,
    sequence: nextVersion,
    actorUserId: input.user.userId,
    actorEmail: normalizeEmail(input.user.email),
    action: 'member.invite-cancelled',
    summary: `${invite.email} invitation cancelled`,
    stateHash: current.stateHash,
    previousHash: current.lastEventHash,
    createdAt: now,
  };
  const hash = teamEventHash(eventBase);
  const results = await d1.batch([
    d1
      .prepare(
        `UPDATE team_workspaces SET version = ?, last_event_hash = ?, updated_at = ?
         WHERE id = ? AND version = ? AND last_event_hash = ? AND state_hash = ?`,
      )
      .bind(
        nextVersion,
        hash,
        now,
        input.workspaceId,
        current.version,
        current.lastEventHash,
        current.stateHash,
      ),
    d1
      .prepare(
        `UPDATE team_invites SET status = 'cancelled'
         WHERE id = ? AND workspace_id = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM team_workspaces
             WHERE id = ? AND version = ? AND last_event_hash = ?
           )`,
      )
      .bind(
        input.inviteId,
        input.workspaceId,
        input.workspaceId,
        nextVersion,
        hash,
      ),
    d1
      .prepare(
        `INSERT INTO team_events
         (id, workspace_id, sequence, actor_user_id, actor_email, action, summary, state_hash, previous_hash, hash, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM team_workspaces
           WHERE id = ? AND version = ? AND last_event_hash = ?
         )`,
      )
      .bind(
        eventBase.id,
        input.workspaceId,
        nextVersion,
        input.user.userId,
        normalizeEmail(input.user.email),
        eventBase.action,
        eventBase.summary,
        current.stateHash,
        current.lastEventHash,
        hash,
        now,
        input.workspaceId,
        nextVersion,
        hash,
      ),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1))
    throw new Error(
      'The workspace changed while the invitation was being cancelled.',
    );
  return { id: input.inviteId, status: 'cancelled', version: nextVersion };
}

export async function listTeamEvents(
  user: ChatGPTUser,
  workspaceId: string,
  limit = 100,
) {
  const membership = await requireMembership(user, workspaceId);
  if (!membership) return null;
  const result = await getD1()
    .prepare(
      `SELECT id, sequence, actor_email AS actorEmail, action, summary,
              state_hash AS stateHash,
              previous_hash AS previousHash, hash, created_at AS createdAt
       FROM team_events WHERE workspace_id = ?
       ORDER BY sequence DESC LIMIT ?`,
    )
    .bind(workspaceId, Math.min(500, Math.max(1, limit)))
    .all<{
      id: string;
      sequence: number;
      actorEmail: string;
      action: string;
      summary: string;
      stateHash: string;
      previousHash: string;
      hash: string;
      createdAt: string;
    }>();
  return result.results.map((event) => ({
    ...event,
    summary: teamEventSummaryForRole(
      event.action,
      event.summary,
      membership.role,
    ),
  }));
}

export async function verifyTeamEventChain(
  user: ChatGPTUser,
  workspaceId: string,
) {
  if (!(await requireMembership(user, workspaceId))) return null;
  const d1 = getD1();
  const workspace = await d1
    .prepare(
      `SELECT state_json AS stateJson, state_hash AS stateHash,
              last_event_hash AS lastEventHash, version
       FROM team_workspaces WHERE id = ?`,
    )
    .bind(workspaceId)
    .first<{
      stateJson: string;
      stateHash: string;
      lastEventHash: string;
      version: number;
    }>();
  if (!workspace) return null;
  const events = await d1
    .prepare(
      `SELECT id, workspace_id AS workspaceId, sequence,
              actor_user_id AS actorUserId, actor_email AS actorEmail,
              action, summary, state_hash AS stateHash,
              previous_hash AS previousHash, hash, created_at AS createdAt
       FROM team_events WHERE workspace_id = ? ORDER BY sequence`,
    )
    .bind(workspaceId)
    .all<{
      id: string;
      workspaceId: string;
      sequence: number;
      actorUserId: string;
      actorEmail: string;
      action: string;
      summary: string;
      stateHash: string;
      previousHash: string;
      hash: string;
      createdAt: string;
    }>();
  let previousHash = 'GENESIS';
  for (let index = 0; index < events.results.length; index += 1) {
    const event = events.results[index];
    const { hash, ...base } = event;
    if (
      event.sequence !== index + 1 ||
      event.previousHash !== previousHash ||
      teamEventHash(base) !== hash
    )
      return {
        valid: false,
        eventCount: events.results.length,
        reason: `Event sequence ${event.sequence} failed chain verification.`,
      };
    previousHash = hash;
  }
  const actualStateHash = sha256Hex(JSON.parse(workspace.stateJson));
  const valid =
    events.results.length === workspace.version &&
    previousHash === workspace.lastEventHash &&
    actualStateHash === workspace.stateHash &&
    events.results.at(-1)?.stateHash === workspace.stateHash;
  return {
    valid,
    eventCount: events.results.length,
    version: workspace.version,
    stateHash: workspace.stateHash,
    lastEventHash: workspace.lastEventHash,
    reason: valid
      ? 'Every server event, link, sequence, and the current workspace state digest verified.'
      : 'The event count, terminal link, or current workspace state digest did not verify.',
  };
}
