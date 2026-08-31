import {
  appendAudit,
  isoNow,
  uid,
  type CalibrationApproval,
} from '@/lib/model';
import {
  authenticatedUser,
  canReview,
  json,
  loadTeamWorkspace,
  requireMembership,
  updateTeamWorkspace,
} from '@/lib/team-server';
import { verifySealedCalibration } from '@/lib/record-integrity';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  const body = (await request.json()) as {
    workspaceId?: unknown;
    expectedVersion?: unknown;
    calibrationId?: unknown;
    recordHash?: unknown;
    meaning?: unknown;
  };
  if (
    typeof body.workspaceId !== 'string' ||
    typeof body.expectedVersion !== 'number' ||
    typeof body.calibrationId !== 'string' ||
    typeof body.recordHash !== 'string' ||
    !['technical-review', 'release', 'conditional-use'].includes(
      String(body.meaning),
    )
  )
    return json({ error: 'Approval request is incomplete.' }, { status: 400 });
  const membership = await requireMembership(user, body.workspaceId);
  if (!membership || !canReview(membership.role))
    return json(
      { error: 'This role cannot approve calibration records.' },
      { status: 403 },
    );
  const workspace = await loadTeamWorkspace(user, body.workspaceId);
  if (!workspace || workspace.version !== body.expectedVersion)
    return json(
      {
        error: 'Workspace changed before approval.',
        currentVersion: workspace?.version,
      },
      { status: 409 },
    );
  const calibration = workspace.state.calibrations.find(
    (item) => item.id === body.calibrationId,
  );
  if (!calibration || calibration.recordHash !== body.recordHash)
    return json(
      {
        error: 'The sealed record hash no longer matches the approval request.',
      },
      { status: 409 },
    );
  if (!verifySealedCalibration(calibration).valid)
    return json(
      { error: 'The calibration record failed sealed-record verification.' },
      { status: 409 },
    );
  if (body.meaning === 'release' && calibration.result !== 'pass')
    return json(
      { error: 'Only a passing calibration can receive a release approval.' },
      { status: 409 },
    );
  if (
    body.meaning === 'conditional-use' &&
    calibration.result !== 'conditional'
  )
    return json(
      { error: 'Conditional-use approval applies only to a conditional pass.' },
      { status: 409 },
    );
  if (
    calibration.approvals?.some(
      (item) =>
        (item.signerUserId === user.userId ||
          (!item.signerUserId &&
            item.signerEmail?.toLowerCase() === user.email.toLowerCase())) &&
        item.meaning === body.meaning,
    )
  )
    return json(
      { error: 'This identity already recorded that approval.' },
      { status: 409 },
    );
  const approval: CalibrationApproval = {
    id: uid('approval'),
    meaning: body.meaning as CalibrationApproval['meaning'],
    signerName: user.displayName,
    signerUserId: user.userId,
    signerEmail: user.email,
    signerRole: membership.role,
    signedAt: isoNow(),
    recordHash: calibration.recordHash,
    assurance: 'authenticated-identity',
  };
  const nextState = {
    ...workspace.state,
    calibrations: workspace.state.calibrations.map((item) =>
      item.id === calibration.id
        ? { ...item, approvals: [...(item.approvals ?? []), approval] }
        : item,
    ),
    audit: appendAudit(workspace.state.audit, {
      actor: `${user.displayName} <${user.email}>`,
      action: `calibration.${approval.meaning}-signed`,
      entityType: 'approval',
      entityId: approval.id,
      summary: `${calibration.certificateNumber} ${approval.meaning.replaceAll('-', ' ')} signed by authenticated identity`,
      after: approval,
    }),
  };
  const result = await updateTeamWorkspace({
    user,
    workspaceId: body.workspaceId,
    expectedVersion: body.expectedVersion,
    state: nextState,
    summary: `${calibration.certificateNumber} approval recorded`,
    permission: 'review',
    operation: 'approval',
  });
  if (result.status === 'conflict')
    return json(
      {
        error: 'Workspace changed before approval.',
        currentVersion: result.currentVersion,
      },
      { status: 409 },
    );
  if (result.status === 'forbidden')
    return json({ error: 'Approval is not permitted.' }, { status: 403 });
  return json({ approval, state: nextState, version: result.version });
}
