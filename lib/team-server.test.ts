import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChatGPTUser: vi.fn(),
  getD1: vi.fn(),
}));

vi.mock('@/app/chatgpt-auth', () => ({
  getChatGPTUser: mocks.getChatGPTUser,
}));

vi.mock('@/db', () => ({
  getD1: mocks.getD1,
}));

vi.mock('@/lib/record-integrity', () => ({
  sha256Hex: vi.fn(() => 'state-hash'),
}));

vi.mock('@/lib/model', () => ({
  uid: vi.fn((prefix: string) => `${prefix}-test`),
}));

vi.mock('@/lib/team-state-schema', () => ({
  parseTeamAppState: vi.fn((value: unknown) => value),
}));

vi.mock('@/lib/team-integrity', () => ({
  describeTeamTransition: vi.fn(() => 'Changed'),
  prepareInitialTeamState: vi.fn(
    (input: { proposed: unknown }) => input.proposed,
  ),
  prepareTeamSyncState: vi.fn((input: { proposed: unknown }) => input.proposed),
  teamEventHash: vi.fn(() => 'event-hash'),
}));

import {
  authenticatedUser,
  authoritativeMembershipRole,
  inviteTeamMember,
  teamEventSummaryForRole,
  updateTeamMember,
  type TeamRole,
} from './team-server';

const owner = {
  userId: 'owner-user',
  displayName: 'Owner',
  email: 'owner@example.com',
  fullName: 'Owner',
};

function statement(input: { first?: unknown; all?: { results: unknown[] } }) {
  return {
    bind: vi.fn(() => ({
      first: vi.fn(async () => input.first ?? null),
      all: vi.fn(async () => input.all ?? { results: [] }),
    })),
  };
}

describe('team authorization invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives owner authority from workspace.owner_user_id', () => {
    expect(
      authoritativeMembershipRole({
        userId: 'owner-user',
        ownerUserId: 'owner-user',
        storedRole: 'technician',
      }),
    ).toBe('owner');
    expect(
      authoritativeMembershipRole({
        userId: 'other-user',
        ownerUserId: 'owner-user',
        storedRole: 'owner',
      }),
    ).toBeNull();
  });

  it('does not let a manager invite an email already held by a member', async () => {
    const batch = vi.fn();
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('m.user_id = ? AND m.active = 1'))
        return statement({
          first: {
            role: 'owner',
            ownerUserId: owner.userId,
            workspaceName: 'Lab',
            version: 1,
            updatedAt: '2026-08-31T00:00:00.000Z',
          },
        });
      if (sql.includes('SELECT user_id AS userId FROM team_members'))
        return statement({ first: { userId: 'existing-user' } });
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.getD1.mockReturnValue({ prepare, batch });

    await expect(
      inviteTeamMember({
        user: owner,
        workspaceId: 'workspace-1',
        email: ' Existing@Example.com ',
        role: 'technician',
      }),
    ).resolves.toBeNull();
    expect(batch).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('does not claim an invitation over an existing membership', async () => {
    const existingUser = {
      userId: 'existing-user',
      displayName: 'Existing',
      email: 'existing@example.com',
      fullName: 'Existing',
    };
    const batch = vi.fn();
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM team_invites'))
        return statement({
          all: {
            results: [
              {
                id: 'invite-1',
                workspaceId: 'workspace-1',
                role: 'admin',
              },
            ],
          },
        });
      if (sql.includes('AS membershipExists'))
        return statement({
          first: {
            version: 4,
            stateHash: 'state-hash',
            lastEventHash: 'event-hash',
            ownerUserId: owner.userId,
            membershipExists: 1,
          },
        });
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.getChatGPTUser.mockResolvedValue(existingUser);
    mocks.getD1.mockReturnValue({ prepare, batch });

    await expect(authenticatedUser()).resolves.toEqual(existingUser);
    expect(batch).not.toHaveBeenCalled();
  });

  it('does not claim an invitation over the authoritative owner', async () => {
    const batch = vi.fn();
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM team_invites'))
        return statement({
          all: {
            results: [
              {
                id: 'invite-1',
                workspaceId: 'workspace-1',
                role: 'technician',
              },
            ],
          },
        });
      if (sql.includes('AS membershipExists'))
        return statement({
          first: {
            version: 4,
            stateHash: 'state-hash',
            lastEventHash: 'event-hash',
            ownerUserId: owner.userId,
            membershipExists: 0,
          },
        });
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.getChatGPTUser.mockResolvedValue(owner);
    mocks.getD1.mockReturnValue({ prepare, batch });

    await expect(authenticatedUser()).resolves.toEqual(owner);
    expect(batch).not.toHaveBeenCalled();
  });

  it('protects the authoritative owner even if their stored role is wrong', async () => {
    const admin = {
      userId: 'admin-user',
      displayName: 'Admin',
      email: 'admin@example.com',
      fullName: 'Admin',
    };
    const batch = vi.fn();
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('m.user_id = ? AND m.active = 1'))
        return statement({
          first: {
            role: 'admin',
            ownerUserId: owner.userId,
            workspaceName: 'Lab',
            version: 1,
            updatedAt: '2026-08-31T00:00:00.000Z',
          },
        });
      if (sql.includes('w.owner_user_id AS ownerUserId'))
        return statement({
          first: {
            role: 'technician',
            email: owner.email,
            active: 1,
            ownerUserId: owner.userId,
          },
        });
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.getD1.mockReturnValue({ prepare, batch });

    await expect(
      updateTeamMember({
        user: admin,
        workspaceId: 'workspace-1',
        targetUserId: owner.userId,
        role: 'viewer',
        active: false,
      }),
    ).resolves.toBeNull();
    expect(batch).not.toHaveBeenCalled();
  });

  it('redacts member target details for every non-manager role', () => {
    const detail = 'target@example.com invited as technician';
    const nonManagers: TeamRole[] = [
      'quality-manager',
      'technician',
      'reviewer',
      'auditor',
      'viewer',
    ];
    for (const role of nonManagers) {
      const visible = teamEventSummaryForRole('member.invited', detail, role);
      expect(visible).toBe('A workspace invitation was created.');
      expect(visible).not.toContain('target@example.com');
    }
    expect(teamEventSummaryForRole('member.invited', detail, 'owner')).toBe(
      detail,
    );
    expect(teamEventSummaryForRole('member.invited', detail, 'admin')).toBe(
      detail,
    );
  });
});
