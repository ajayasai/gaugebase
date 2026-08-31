CREATE TABLE `team_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `team_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_attachments_object_key_unique` ON `team_attachments` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_team_attachments_target` ON `team_attachments` (`workspace_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `team_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`previous_hash` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `team_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_team_events_workspace_sequence` ON `team_events` (`workspace_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_team_events_workspace_hash` ON `team_events` (`workspace_id`,`hash`);--> statement-breakpoint
CREATE TABLE `team_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`accepted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `team_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_team_invites_workspace_email` ON `team_invites` (`workspace_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_team_invites_email_status` ON `team_invites` (`email`,`status`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `team_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_team_members_user` ON `team_members` (`user_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_team_members_email` ON `team_members` (`email`);--> statement-breakpoint
CREATE TABLE `team_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`state_json` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_event_hash` text DEFAULT 'GENESIS' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_team_workspaces_owner` ON `team_workspaces` (`owner_user_id`);