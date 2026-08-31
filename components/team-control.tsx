'use client';

import { useEffect, useState } from 'react';
import {
  Cloud,
  CloudAlert,
  CloudCheck,
  LogIn,
  LogOut,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ChatGPTUser } from '@/app/chatgpt-auth';
import type {
  TeamOverview,
  TeamEventPayload,
  TeamSession,
  TeamWorkspacePayload,
} from '@/lib/team-client';
import { fetchRemoteEvents } from '@/lib/team-client';
import type { TeamRole } from '@/lib/team-server';

export type TeamSyncStatus =
  | 'local'
  | 'connecting'
  | 'synced'
  | 'syncing'
  | 'conflict'
  | 'error';

export function TeamControl({
  identity,
  signInPath,
  signOutPath,
  overview,
  active,
  details,
  status,
  error,
  onRefresh,
  onCreate,
  onOpen,
  onDisconnect,
  onReloadRemote,
  onInvite,
  onUpdateMember,
  onCancelInvite,
}: {
  identity: ChatGPTUser | null;
  signInPath: string;
  signOutPath: string;
  overview?: TeamOverview;
  active?: TeamSession;
  details?: TeamWorkspacePayload;
  status: TeamSyncStatus;
  error?: string;
  onRefresh: () => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onOpen: (workspaceId: string) => Promise<void>;
  onDisconnect: () => void;
  onReloadRemote: () => Promise<void>;
  onInvite: (email: string, role: Exclude<TeamRole, 'owner'>) => Promise<void>;
  onUpdateMember: (
    userId: string,
    role: Exclude<TeamRole, 'owner'>,
    active: boolean,
  ) => Promise<void>;
  onCancelInvite: (inviteId: string) => Promise<void>;
}) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<Exclude<TeamRole, 'owner'>>('technician');
  const [busy, setBusy] = useState(false);
  const [eventProof, setEventProof] = useState<TeamEventPayload>();

  useEffect(() => {
    if (!active || status === 'local') {
      setEventProof(undefined);
      return;
    }
    fetchRemoteEvents(active.workspaceId, 8)
      .then(setEventProof)
      .catch(() => setEventProof(undefined));
  }, [active?.workspaceId, active?.version, status]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const statusIcon =
    status === 'synced' ? (
      <CloudCheck />
    ) : status === 'conflict' || status === 'error' ? (
      <CloudAlert />
    ) : (
      <Cloud />
    );

  return (
    <section className="panel team-control">
      <div className="settings-title">
        <span>
          <Users />
        </span>
        <div>
          <h2>Team workspace</h2>
          <p>
            Optional authenticated collaboration with roles, optimistic
            concurrency, server-side event sequencing, and shared evidence.
          </p>
        </div>
        {active && (
          <span className={`team-sync-status ${status}`}>
            {statusIcon} {status}
          </span>
        )}
      </div>

      {!identity ? (
        <div className="team-signin">
          <div>
            <ShieldCheck />
            <span>
              <strong>Local mode remains available without an account</strong>
              <p>
                Sign in only when you want a shared, identity-attributed team
                workspace.
              </p>
            </span>
          </div>
          <a
            className="primary-button team-auth-link"
            href={signInPath}
            target="_top"
          >
            <LogIn /> Sign in with ChatGPT
          </a>
        </div>
      ) : (
        <>
          <div className="team-identity">
            <span>{identity.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{identity.displayName}</strong>
              <p>{identity.email}</p>
            </div>
            <a className="team-signout" href={signOutPath} target="_top">
              <LogOut /> Sign out
            </a>
          </div>

          {error && (
            <div className="team-error">
              <CloudAlert />
              <span>
                <strong>Team workspace needs attention</strong>
                <p>{error}</p>
              </span>
            </div>
          )}

          {!active ? (
            <div className="team-picker">
              <div className="team-create">
                <label>
                  <span>New team workspace</span>
                  <Input
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    placeholder="Northstar Calibration Lab"
                  />
                </label>
                <Button
                  disabled={busy || workspaceName.trim().length < 2}
                  onClick={() =>
                    run(async () => {
                      await onCreate(workspaceName.trim());
                      setWorkspaceName('');
                    })
                  }
                >
                  <Cloud /> Create from current data
                </Button>
              </div>
              <div className="workspace-list">
                <div className="section-heading">
                  <div>
                    <h3>Your team workspaces</h3>
                    <p>
                      Opening one replaces the active view after a versioned
                      server read.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => run(onRefresh)}
                    aria-label="Refresh workspaces"
                  >
                    <RefreshCw />
                  </Button>
                </div>
                {!overview?.workspaces.length ? (
                  <p className="team-empty">No shared workspaces yet.</p>
                ) : (
                  overview.workspaces.map((workspace) => (
                    <button
                      key={workspace.workspaceId}
                      onClick={() => run(() => onOpen(workspace.workspaceId))}
                    >
                      <span>
                        <Cloud />
                      </span>
                      <div>
                        <strong>{workspace.workspaceName}</strong>
                        <p>
                          {workspace.role} · version {workspace.version}
                        </p>
                      </div>
                      <small>
                        {new Date(workspace.updatedAt).toLocaleString()}
                      </small>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="active-team">
              <div className="active-team-summary">
                <div>
                  <strong>{active.name}</strong>
                  <p>
                    {active.role} · server version {active.version} · last
                    synced {new Date(active.lastSyncedAt).toLocaleTimeString()}
                  </p>
                </div>
                <div>
                  <Button
                    variant="outline"
                    onClick={() => run(onReloadRemote)}
                    disabled={busy}
                  >
                    <RefreshCw /> Reload server copy
                  </Button>
                  <Button variant="ghost" onClick={onDisconnect}>
                    Return to local mode
                  </Button>
                </div>
              </div>
              {status === 'conflict' && (
                <div className="conflict-box">
                  <CloudAlert />
                  <div>
                    <strong>A concurrent change was detected</strong>
                    <p>
                      Automatic saving stopped. Export the local copy if needed,
                      then reload the current server version before continuing.
                    </p>
                  </div>
                </div>
              )}
              {eventProof && (
                <div
                  className={`team-event-proof ${eventProof.verification.valid ? 'verified' : 'invalid'}`}
                >
                  <ScrollText />
                  <div>
                    <strong>
                      {eventProof.verification.valid
                        ? 'Server event chain verified'
                        : 'Server event chain needs investigation'}
                    </strong>
                    <p>{eventProof.verification.reason}</p>
                  </div>
                  <code>
                    {eventProof.verification.stateHash?.slice(0, 16) ??
                      'unavailable'}
                    …
                  </code>
                </div>
              )}
              {(active.role === 'owner' || active.role === 'admin') && (
                <div className="member-admin">
                  <div>
                    <h3>Invite by verified email</h3>
                    <p>
                      The invite activates when that email signs in to
                      GaugeBase.
                    </p>
                  </div>
                  <div className="invite-row">
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="technician@example.com"
                    />
                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(
                          event.target.value as Exclude<TeamRole, 'owner'>,
                        )
                      }
                    >
                      {active.role === 'owner' && (
                        <option value="admin">Admin</option>
                      )}
                      <option value="quality-manager">Quality manager</option>
                      <option value="technician">Technician</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="auditor">Auditor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <Button
                      disabled={busy || !/^\S+@\S+\.\S+$/.test(inviteEmail)}
                      onClick={() =>
                        run(async () => {
                          await onInvite(inviteEmail, inviteRole);
                          setInviteEmail('');
                        })
                      }
                    >
                      <UserPlus /> Invite
                    </Button>
                  </div>
                  <div className="member-list">
                    {details?.members?.map((member) => {
                      const protectedMember =
                        member.role === 'owner' ||
                        member.userId === identity.userId ||
                        (active.role === 'admin' && member.role === 'admin');
                      return (
                        <div
                          key={member.userId}
                          className={member.active ? '' : 'inactive'}
                        >
                          <span>
                            {member.displayName.slice(0, 1).toUpperCase()}
                          </span>
                          <p>
                            <strong>{member.displayName}</strong>
                            <small>
                              {member.email}
                              {member.active ? '' : ' · access deactivated'}
                            </small>
                          </p>
                          {member.role === 'owner' ? (
                            <em>owner</em>
                          ) : (
                            <select
                              aria-label={`Role for ${member.displayName}`}
                              value={member.role}
                              disabled={
                                busy || protectedMember || !member.active
                              }
                              onChange={(event) =>
                                run(() =>
                                  onUpdateMember(
                                    member.userId,
                                    event.target.value as Exclude<
                                      TeamRole,
                                      'owner'
                                    >,
                                    true,
                                  ),
                                )
                              }
                            >
                              {active.role === 'owner' && (
                                <option value="admin">Admin</option>
                              )}
                              <option value="quality-manager">
                                Quality manager
                              </option>
                              <option value="technician">Technician</option>
                              <option value="reviewer">Reviewer</option>
                              <option value="auditor">Auditor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          )}
                          {!protectedMember &&
                            member.active &&
                            member.role !== 'owner' && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={busy}
                                aria-label={`Deactivate ${member.displayName}`}
                                onClick={() =>
                                  run(() =>
                                    onUpdateMember(
                                      member.userId,
                                      member.role as Exclude<TeamRole, 'owner'>,
                                      false,
                                    ),
                                  )
                                }
                              >
                                <UserMinus />
                              </Button>
                            )}
                          {!protectedMember &&
                            !member.active &&
                            member.role !== 'owner' && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  run(() =>
                                    onUpdateMember(
                                      member.userId,
                                      member.role as Exclude<TeamRole, 'owner'>,
                                      true,
                                    ),
                                  )
                                }
                              >
                                <UserPlus /> Reactivate
                              </Button>
                            )}
                        </div>
                      );
                    })}
                    {details?.invites
                      ?.filter((invite) => invite.status === 'pending')
                      .map((invite) => (
                        <div key={invite.id} className="pending">
                          <span>?</span>
                          <p>
                            <strong>{invite.email}</strong>
                            <small>Invitation pending</small>
                          </p>
                          <em>{invite.role}</em>
                          {(active.role === 'owner' ||
                            invite.role !== 'admin') && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={busy}
                              aria-label={`Cancel invitation for ${invite.email}`}
                              onClick={() =>
                                run(() => onCancelInvite(invite.id))
                              }
                            >
                              <UserMinus />
                            </Button>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="role-matrix">
        <span>Owner/Admin: members + all records</span>
        <span>Quality manager: records + release</span>
        <span>Technician: record work</span>
        <span>Reviewer: hash-bound approvals</span>
        <span>Auditor/Viewer: read-only</span>
      </div>
    </section>
  );
}
