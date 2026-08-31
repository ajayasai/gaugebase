import {
  authenticatedUser,
  createTeamWorkspace,
  json,
  listMemberships,
  validateTeamState,
} from '@/lib/team-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await authenticatedUser();
  if (!user) return json({ authenticated: false }, { status: 401 });
  return json({
    authenticated: true,
    user,
    workspaces: await listMemberships(user),
  });
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  try {
    const body = (await request.json()) as { name?: unknown; state?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 120)
      return json(
        { error: 'Workspace name must be 2–120 characters.' },
        { status: 400 },
      );
    const state = validateTeamState(body.state);
    return json(await createTeamWorkspace({ user, name, state }), {
      status: 201,
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : 'Workspace creation failed.',
      },
      { status: 400 },
    );
  }
}
