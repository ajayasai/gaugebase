import { getD1, getFilesBucket } from '@/db';
import { sha256Bytes, sha256Hex } from '@/lib/record-integrity';
import {
  authenticatedUser,
  canEdit,
  json,
  requireMembership,
} from '@/lib/team-server';
import { uid } from '@/lib/model';

export const dynamic = 'force-dynamic';

export function safeFilename(value: string) {
  const sanitized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      ['"', '/', '\\'].includes(character)
      ? '_'
      : character;
  })
    .slice(0, 240)
    .join('');
  return sanitized || 'attachment';
}

export function attachmentContentDisposition(value: string) {
  const filename = safeFilename(value);
  const fallback = Array.from(filename, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x20 && codePoint <= 0x7e ? character : '_';
  }).join('');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback || 'attachment'}"; filename*=UTF-8''${encoded}`;
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get('workspaceId') ?? '';
  const targetType = params.get('targetType');
  const targetId = params.get('targetId') ?? '';
  const membership = await requireMembership(user, workspaceId);
  if (!membership || !canEdit(membership.role))
    return json(
      { error: 'File upload is not permitted for this role.' },
      { status: 403 },
    );
  if (!['gauge', 'calibration'].includes(targetType ?? '') || !targetId)
    return json({ error: 'A supported target is required.' }, { status: 400 });
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > 20_000_000)
    return json(
      { error: 'Shared attachments are limited to 20 MB.' },
      { status: 413 },
    );
  const workspace = await getD1()
    .prepare(
      `SELECT state_json AS stateJson, state_hash AS stateHash
       FROM team_workspaces WHERE id = ?`,
    )
    .bind(workspaceId)
    .first<{ stateJson: string; stateHash: string }>();
  if (!workspace)
    return json({ error: 'Workspace not found.' }, { status: 404 });
  let state: {
    gauges?: Array<{ id: string }>;
    calibrations?: Array<{ id: string }>;
  };
  try {
    state = JSON.parse(workspace.stateJson) as typeof state;
    if (sha256Hex(state) !== workspace.stateHash)
      throw new Error('Workspace state digest mismatch.');
  } catch {
    return json(
      {
        error:
          'The stored workspace digest is invalid; evidence upload is locked.',
      },
      { status: 409 },
    );
  }
  const targetExists =
    targetType === 'gauge'
      ? state.gauges?.some((item) => item.id === targetId)
      : state.calibrations?.some((item) => item.id === targetId);
  if (!targetExists)
    return json(
      { error: 'The evidence target does not exist.' },
      { status: 404 },
    );
  const usage = await getD1()
    .prepare(
      `SELECT COUNT(*) AS attachmentCount, COALESCE(SUM(size), 0) AS totalBytes
       FROM team_attachments WHERE workspace_id = ?`,
    )
    .bind(workspaceId)
    .first<{ attachmentCount: number; totalBytes: number }>();
  if ((usage?.attachmentCount ?? 0) >= 2_000)
    return json(
      { error: 'This workspace has reached its 2,000-file evidence limit.' },
      { status: 413 },
    );
  if ((usage?.totalBytes ?? 0) + declaredLength > 2_000_000_000)
    return json(
      { error: 'This workspace has reached its 2 GB evidence limit.' },
      { status: 413 },
    );
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 20_000_000)
    return json(
      { error: 'Shared attachments must be 1 byte–20 MB.' },
      { status: 413 },
    );
  let decodedFilename = 'attachment';
  try {
    decodedFilename = decodeURIComponent(
      request.headers.get('x-gaugebase-filename') ?? 'attachment',
    );
  } catch {
    return json(
      { error: 'The attachment filename is not valid.' },
      { status: 400 },
    );
  }
  const filename = safeFilename(decodedFilename);
  const suppliedContentType =
    request.headers.get('content-type') || 'application/octet-stream';
  const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(suppliedContentType)
    ? suppliedContentType.slice(0, 160)
    : 'application/octet-stream';
  if ((usage?.totalBytes ?? 0) + bytes.byteLength > 2_000_000_000)
    return json(
      { error: 'This workspace has reached its 2 GB evidence limit.' },
      { status: 413 },
    );
  const sha256 = await sha256Bytes(bytes);
  const claimedHash = request.headers.get('x-gaugebase-sha256');
  if (claimedHash && claimedHash.toLowerCase() !== sha256)
    return json(
      { error: 'Attachment digest does not match its bytes.' },
      { status: 400 },
    );
  const id = uid('attachment');
  const objectKey = `${workspaceId}/${targetType}/${targetId}/${id}`;
  const createdAt = new Date().toISOString();
  await getFilesBucket().put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      workspaceId,
      targetType: targetType!,
      targetId,
      filename,
      sha256,
      createdBy: user.userId,
    },
  });
  try {
    await getD1()
      .prepare(
        `INSERT INTO team_attachments
         (id, workspace_id, target_type, target_id, object_key, filename,
          content_type, size, sha256, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        workspaceId,
        targetType,
        targetId,
        objectKey,
        filename,
        contentType,
        bytes.byteLength,
        sha256,
        user.userId,
        createdAt,
      )
      .run();
  } catch (error) {
    await getFilesBucket().delete(objectKey);
    throw error;
  }
  return json(
    {
      id,
      name: filename,
      type: contentType,
      size: bytes.byteLength,
      dataUrl: '',
      storage: 'team',
      downloadUrl: `/api/team/files?workspaceId=${encodeURIComponent(workspaceId)}&id=${encodeURIComponent(id)}`,
      sha256,
      createdAt,
      targetType,
      targetId,
    },
    { status: 201 },
  );
}

export async function GET(request: Request) {
  const user = await authenticatedUser();
  if (!user)
    return json({ error: 'Authentication required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get('workspaceId') ?? '';
  const id = params.get('id') ?? '';
  if (!(await requireMembership(user, workspaceId)))
    return json({ error: 'Attachment not found.' }, { status: 404 });
  const record = await getD1()
    .prepare(
      `SELECT object_key AS objectKey, filename, content_type AS contentType,
              size, sha256
       FROM team_attachments WHERE id = ? AND workspace_id = ?`,
    )
    .bind(id, workspaceId)
    .first<{
      objectKey: string;
      filename: string;
      contentType: string;
      size: number;
      sha256: string;
    }>();
  if (!record) return json({ error: 'Attachment not found.' }, { status: 404 });
  const object = await getFilesBucket().get(record.objectKey);
  if (!object)
    return json(
      { error: 'Attachment bytes are unavailable.' },
      { status: 404 },
    );
  return new Response(object.body, {
    headers: {
      'content-type': record.contentType,
      'content-length': String(record.size),
      'content-disposition': attachmentContentDisposition(record.filename),
      'x-content-type-options': 'nosniff',
      'x-gaugebase-sha256': record.sha256,
      'cache-control': 'private, no-store',
    },
  });
}
