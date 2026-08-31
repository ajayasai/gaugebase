import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const teamWorkspaces = sqliteTable(
  'team_workspaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    stateJson: text('state_json').notNull(),
    stateHash: text('state_hash').notNull(),
    version: integer('version').notNull().default(0),
    lastEventHash: text('last_event_hash').notNull().default('GENESIS'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_team_workspaces_owner').on(table.ownerUserId)],
);

export const teamMembers = sqliteTable(
  'team_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => teamWorkspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('idx_team_members_user').on(table.userId, table.active),
    index('idx_team_members_email').on(table.email),
  ],
);

export const teamInvites = sqliteTable(
  'team_invites',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => teamWorkspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    invitedBy: text('invited_by').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
    acceptedAt: text('accepted_at'),
  },
  (table) => [
    uniqueIndex('idx_team_invites_workspace_email').on(
      table.workspaceId,
      table.email,
    ),
    index('idx_team_invites_email_status').on(table.email, table.status),
  ],
);

export const teamEvents = sqliteTable(
  'team_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => teamWorkspaces.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    stateHash: text('state_hash').notNull(),
    previousHash: text('previous_hash').notNull(),
    hash: text('hash').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_team_events_workspace_sequence').on(
      table.workspaceId,
      table.sequence,
    ),
    uniqueIndex('idx_team_events_workspace_hash').on(
      table.workspaceId,
      table.hash,
    ),
  ],
);

export const teamAttachments = sqliteTable(
  'team_attachments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => teamWorkspaces.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    objectKey: text('object_key').notNull().unique(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_team_attachments_target').on(
      table.workspaceId,
      table.targetType,
      table.targetId,
    ),
  ],
);
