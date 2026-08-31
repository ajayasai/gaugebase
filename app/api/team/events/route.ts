import {
  authenticatedUser,
  json,
  listTeamEvents,
  verifyTeamEventChain,
} from '@/lib/team-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get('workspaceId') ?? '';
  const [events, verification] = await Promise.all([
    listTeamEvents(user, workspaceId, Number(params.get('limit') || 100)),
    verifyTeamEventChain(user, workspaceId),
  ]);
  if (!events) return json({ error: 'Workspace not found.' }, { status: 404 });
  return json({ events, verification });
}
