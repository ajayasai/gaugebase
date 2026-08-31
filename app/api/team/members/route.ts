import {
  authenticatedUser,
  json,
  TEAM_ROLES,
  updateTeamMember,
  type TeamRole,
} from '@/lib/team-server';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  const body = (await request.json()) as {
    workspaceId?: unknown;
    targetUserId?: unknown;
    role?: unknown;
    active?: unknown;
  };
  if (
    typeof body.workspaceId !== 'string' ||
    typeof body.targetUserId !== 'string' ||
    !TEAM_ROLES.includes(body.role as TeamRole) ||
    body.role === 'owner' ||
    typeof body.active !== 'boolean'
  )
    return json(
      { error: 'A target, non-owner role, and active state are required.' },
      { status: 400 },
    );
  const result = await updateTeamMember({
    user,
    workspaceId: body.workspaceId,
    targetUserId: body.targetUserId,
    role: body.role as Exclude<TeamRole, 'owner'>,
    active: body.active,
  });
  if (!result)
    return json(
      { error: 'Member management is not permitted.' },
      { status: 403 },
    );
  return json(result);
}
