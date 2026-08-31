import {
  authenticatedUser,
  cancelTeamInvite,
  inviteTeamMember,
  json,
  TEAM_ROLES,
  type TeamRole,
} from '@/lib/team-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  const body = (await request.json()) as {
    workspaceId?: unknown;
    email?: unknown;
    role?: unknown;
  };
  if (
    typeof body.workspaceId !== 'string' ||
    typeof body.email !== 'string' ||
    !/^\S+@\S+\.\S+$/.test(body.email) ||
    !TEAM_ROLES.includes(body.role as TeamRole) ||
    body.role === 'owner'
  )
    return json(
      { error: 'A valid email and non-owner role are required.' },
      { status: 400 },
    );
  const invite = await inviteTeamMember({
    user,
    workspaceId: body.workspaceId,
    email: body.email,
    role: body.role as TeamRole,
  });
  if (!invite)
    return json(
      { error: 'Member management is not permitted.' },
      { status: 403 },
    );
  return json(invite, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  const body = (await request.json()) as {
    workspaceId?: unknown;
    inviteId?: unknown;
  };
  if (typeof body.workspaceId !== 'string' || typeof body.inviteId !== 'string')
    return json(
      { error: 'workspaceId and inviteId are required.' },
      { status: 400 },
    );
  const result = await cancelTeamInvite({
    user,
    workspaceId: body.workspaceId,
    inviteId: body.inviteId,
  });
  if (!result)
    return json(
      { error: 'Invitation cancellation is not permitted.' },
      { status: 403 },
    );
  return json(result);
}
