'use client';

import type { ChatGPTUser } from '@/app/chatgpt-auth';
import type {
  AppState,
  AttachmentRecord,
  CalibrationApproval,
} from '@/lib/model';
import { sha256Bytes, sha256Hex } from '@/lib/record-integrity';
import type { TeamMembership, TeamRole } from '@/lib/team-server';

export type TeamOverview = {
  authenticated: true;
  user: ChatGPTUser;
  workspaces: TeamMembership[];
};

export type TeamWorkspacePayload = {
  workspaceId: string;
  name: string;
  role: TeamRole;
  version: number;
  updatedAt: string;
  lastEventHash: string;
  stateHash: string;
  state: AppState;
  members?: Array<{
    userId: string;
    email: string;
    displayName: string;
    role: TeamRole;
    active: boolean;
    joinedAt: string;
  }>;
  invites?: Array<{
    id: string;
    email: string;
    role: TeamRole;
    status: string;
    createdAt: string;
    acceptedAt?: string;
  }>;
};

export type TeamSession = {
  workspaceId: string;
  name: string;
  role: TeamRole;
  version: number;
  lastSyncedHash: string;
  lastSyncedAt: string;
};

export type TeamEventPayload = {
  events: Array<{
    id: string;
    sequence: number;
    actorEmail: string;
    action: string;
    summary: string;
    stateHash: string;
    previousHash: string;
    hash: string;
    createdAt: string;
  }>;
  verification: {
    valid: boolean;
    eventCount: number;
    version?: number;
    stateHash?: string;
    lastEventHash?: string;
    reason: string;
  };
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok)
    throw Object.assign(
      new Error(body.error || `Request failed (${response.status}).`),
      { status: response.status, payload: body },
    );
  return body as T;
}

export function stateForTeam(state: AppState): AppState {
  const sharedAttachments = state.attachments
    .filter((attachment) => attachment.storage === 'team')
    .map((attachment) => ({ ...attachment, dataUrl: '' }));
  const sharedIds = new Set(
    sharedAttachments.map((attachment) => attachment.id),
  );
  return {
    ...state,
    gauges: state.gauges.map((gauge) => ({
      ...gauge,
      attachmentIds: gauge.attachmentIds.filter((id) => sharedIds.has(id)),
    })),
    calibrations: state.calibrations.map((calibration) => ({
      ...calibration,
      attachmentIds: calibration.attachmentIds.filter((id) =>
        sharedIds.has(id),
      ),
    })),
    attachments: sharedAttachments,
  };
}

export function teamStateHash(state: AppState) {
  return sha256Hex(stateForTeam(state));
}

export async function fetchTeamOverview() {
  return parseResponse<TeamOverview>(
    await fetch('/api/team', { credentials: 'same-origin', cache: 'no-store' }),
  );
}

export async function createRemoteWorkspace(name: string, state: AppState) {
  return parseResponse<{
    id: string;
    name: string;
    role: 'owner';
    version: number;
    createdAt: string;
  }>(
    await fetch('/api/team', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, state: stateForTeam(state) }),
    }),
  );
}

export async function loadRemoteWorkspace(workspaceId: string) {
  return parseResponse<TeamWorkspacePayload>(
    await fetch(
      `/api/team/workspace?workspaceId=${encodeURIComponent(workspaceId)}`,
      { credentials: 'same-origin', cache: 'no-store' },
    ),
  );
}

export async function fetchRemoteEvents(workspaceId: string, limit = 20) {
  return parseResponse<TeamEventPayload>(
    await fetch(
      `/api/team/events?workspaceId=${encodeURIComponent(workspaceId)}&limit=${Math.max(1, Math.min(100, limit))}`,
      { credentials: 'same-origin', cache: 'no-store' },
    ),
  );
}

export async function syncRemoteWorkspace(input: {
  session: TeamSession;
  state: AppState;
  summary: string;
}) {
  return parseResponse<{
    status: 'updated';
    version: number;
    hash: string;
    stateHash: string;
    state: AppState;
    updatedAt: string;
  }>(
    await fetch('/api/team/workspace', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: input.session.workspaceId,
        expectedVersion: input.session.version,
        state: stateForTeam(input.state),
        summary: input.summary,
      }),
    }),
  );
}

export async function inviteRemoteMember(input: {
  workspaceId: string;
  email: string;
  role: Exclude<TeamRole, 'owner'>;
}) {
  return parseResponse<Record<string, unknown>>(
    await fetch('/api/team/invites', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateRemoteMember(input: {
  workspaceId: string;
  targetUserId: string;
  role: Exclude<TeamRole, 'owner'>;
  active: boolean;
}) {
  return parseResponse<{ version: number }>(
    await fetch('/api/team/members', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function cancelRemoteInvite(input: {
  workspaceId: string;
  inviteId: string;
}) {
  return parseResponse<{ version: number }>(
    await fetch('/api/team/invites', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function uploadTeamAttachment(input: {
  workspaceId: string;
  targetType: 'gauge' | 'calibration';
  targetId: string;
  file: File;
}): Promise<AttachmentRecord> {
  const bytes = await input.file.arrayBuffer();
  const digest = await sha256Bytes(bytes);
  return parseResponse<AttachmentRecord>(
    await fetch(
      `/api/team/files?workspaceId=${encodeURIComponent(input.workspaceId)}&targetType=${input.targetType}&targetId=${encodeURIComponent(input.targetId)}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': input.file.type || 'application/octet-stream',
          'x-gaugebase-filename': encodeURIComponent(input.file.name),
          'x-gaugebase-sha256': digest,
        },
        body: bytes,
      },
    ),
  );
}

export async function approveRemoteCalibration(input: {
  session: TeamSession;
  calibrationId: string;
  recordHash: string;
  meaning: CalibrationApproval['meaning'];
}) {
  return parseResponse<{
    approval: CalibrationApproval;
    state: AppState;
    version: number;
  }>(
    await fetch('/api/team/approvals', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: input.session.workspaceId,
        expectedVersion: input.session.version,
        calibrationId: input.calibrationId,
        recordHash: input.recordHash,
        meaning: input.meaning,
      }),
    }),
  );
}
