import {
  authenticatedUser,
  json,
  loadTeamWorkspace,
  updateTeamWorkspace,
  validateTeamState,
} from '@/lib/team-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  try {
    const workspaceId =
      new URL(request.url).searchParams.get('workspaceId') ?? '';
    const workspace = await loadTeamWorkspace(user, workspaceId);
    if (!workspace)
      return json({ error: 'Workspace not found.' }, { status: 404 });
    return json(workspace);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Workspace verification failed.',
      },
      { status: 409 },
    );
  }
}

export async function PUT(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  try {
    const body = (await request.json()) as {
      workspaceId?: unknown;
      expectedVersion?: unknown;
      state?: unknown;
      summary?: unknown;
    };
    if (
      typeof body.workspaceId !== 'string' ||
      typeof body.expectedVersion !== 'number'
    )
      return json(
        { error: 'workspaceId and expectedVersion are required.' },
        { status: 400 },
      );
    const state = validateTeamState(body.state);
    const result = await updateTeamWorkspace({
      user,
      workspaceId: body.workspaceId,
      expectedVersion: body.expectedVersion,
      state,
      summary:
        typeof body.summary === 'string'
          ? body.summary
          : 'Workspace data synchronized',
    });
    if (result.status === 'forbidden')
      return json({ error: 'This role is read-only.' }, { status: 403 });
    if (result.status === 'conflict')
      return json(
        {
          error: 'Workspace changed on another device.',
          currentVersion: result.currentVersion,
        },
        { status: 409 },
      );
    return json(result);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : 'Synchronization failed.',
      },
      { status: 400 },
    );
  }
}
