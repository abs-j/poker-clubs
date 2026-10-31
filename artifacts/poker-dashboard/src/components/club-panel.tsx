import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, ChevronDown, Copy, LogOut, QrCode, Trash2, UserPlus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ClubDataPanel } from "@/components/club-data-panel";
import { ClubSettingsPanel } from "@/components/club-settings-panel";
import { AccountSecurity, DeleteClub } from "@/components/account-security";
import {
  AccountError,
  accountApi,
  extractInviteCode,
  inviteLink,
  type ClubSummary,
  type InviteRow,
  type MeResponse,
  type MemberRow,
} from "@/lib/account-api";

const smallButton =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const inputClass = "h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

const roleLabel = (role: string | null) => (role === "owner" ? "Owner" : role === "admin" ? "Admin" : role === "member" ? "Member" : "Not joined yet");

function InviteItem({ invite, onRevoked }: { invite: InviteRow; onRevoked: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const link = inviteLink(invite.code);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this invite link", link);
    }
  };
  return (
    <li className="rounded-xl border border-border p-3" data-testid={`invite-${invite.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="w-full break-all rounded-md bg-secondary/60 px-2 py-1.5 text-xs">{link}</code>
        <button type="button" onClick={() => void copy()} className={smallButton} aria-label="Copy invite link">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => setShowQr((value) => !value)} className={smallButton} aria-label="Show QR code">
          <QrCode className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void accountApi.revokeInvite(invite.id).then(onRevoked)}
          className={smallButton}
          aria-label="Revoke invite"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {invite.uses} joined{invite.maxUses ? ` of ${invite.maxUses}` : ""}
        {invite.expiresAt ? ` · expires ${new Date(invite.expiresAt).toLocaleDateString()}` : ""}
        {!invite.usable ? " · no longer valid" : ""}
      </p>
      {showQr && (
        <div className="mt-3 inline-block rounded-xl bg-white p-3">
          <QRCodeSVG value={link} size={168} />
        </div>
      )}
    </li>
  );
}

function VerifyEmailNotice({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  return (
    <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-xs leading-5" data-testid="notice-verify-email">
      <p className="font-semibold">Confirm your email</p>
      <p className="text-muted-foreground">
        We sent a link to {email}. Confirming it means you can reset your password if you ever forget it.
      </p>
      <button
        type="button"
        disabled={state === "sending" || state === "sent"}
        className={`${smallButton} mt-2`}
        data-testid="button-resend-verification"
        onClick={() => {
          setState("sending");
          void accountApi.resendVerification(email).then(() => setState("sent")).catch(() => setState("failed"));
        }}
      >
        {state === "sent" ? "Sent. Check your inbox" : state === "failed" ? "Couldn't send. Try later" : "Send it again"}
      </button>
    </div>
  );
}


export function ClubPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [startName, setStartName] = useState("");
  const [busy, setBusy] = useState(false);

  const active: ClubSummary | undefined = me?.clubs.find((club) => club.slug === me.active) ?? me?.clubs[0];
  const isAdmin = active?.role === "owner" || active?.role === "admin";
  const isOwner = active?.role === "owner";

  const load = useCallback(async () => {
    try {
      const next = await accountApi.me();
      setMe(next);
      if (!next.user || next.clubs.length === 0) return;
      const [roster, inviteList] = await Promise.all([
        accountApi.members().catch(() => ({ members: [] as MemberRow[] })),
        next.clubs.find((club) => club.slug === next.active)?.role !== "member"
          ? accountApi.invites().catch(() => ({ invites: [] as InviteRow[] }))
          : Promise.resolve({ invites: [] as InviteRow[] }),
      ]);
      setMembers(roster.members);
      setInvites(inviteList.invites);
    } catch {
      /* The rest of the account page still works. */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Legacy access-code sessions have no account behind them, so there is nothing to manage.
  if (!me?.user || !active) return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const addName = (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    void run(async () => {
      await accountApi.addPlayer(newName.trim());
      setNewName("");
    });
  };

  return (
    <>
    <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="panel-club">
      <p className="section-label text-primary">Club</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">{active.name}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        You play as {active.playerName} · {roleLabel(active.role)} · {me.user.email}
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {me.options.email && !me.user.emailVerified && <VerifyEmailNotice email={me.user.email} />}

      {me.clubs.length > 1 && (
        <div className="mt-5">
          <p className="text-sm font-semibold">Your clubs</p>
          <ul className="mt-2 space-y-2" data-testid="list-clubs">
            {me.clubs.map((club) => (
              <li key={club.slug} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-semibold">{club.name}</span>
                {club.slug === active.slug ? (
                  <span className="text-xs text-muted-foreground">Current</span>
                ) : (
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() => void accountApi.switchClub(club.slug).then(() => window.location.reload())}
                  >
                    Switch
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin && (
        <div className="mt-6" data-testid="section-invites">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Invite people</p>
              <p className="text-xs text-muted-foreground">Anyone with a link can join, so share it only with your club.</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void run(() => accountApi.createInvite({}))} className={smallButton} data-testid="button-new-invite">
              <UserPlus className="h-4 w-4" />
              New link
            </button>
          </div>
          {invites.length > 0 && (
            <ul className="mt-3 space-y-2">
              {invites.map((invite) => (
                <InviteItem key={invite.id} invite={invite} onRevoked={() => void load()} />
              ))}
            </ul>
          )}
        </div>
      )}

      <details className="group mt-6" data-testid="section-members">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>Members ({members.length})</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <ul className="mt-2 divide-y divide-border/70 rounded-xl border border-border" data-testid="list-members">
          {members.map((member) => {
            const self = member.name === active.playerName;
            return (
              <li key={member.playerId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {member.name}
                    {self && <span className="ml-2 text-xs font-normal text-muted-foreground">you</span>}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {roleLabel(member.role)}
                    {isAdmin && member.email ? ` · ${member.email}` : ""}
                  </p>
                </div>
                {!member.role && (
                  <button
                    type="button"
                    disabled={busy}
                    className={smallButton}
                    data-testid={`button-claim-${member.playerId}`}
                    onClick={() => {
                      if (window.confirm(`Is ${member.name} you? Your results and profile will use that name.`)) {
                        void run(async () => {
                          await accountApi.claimPlayer(member.playerId);
                          window.location.reload();
                        });
                      }
                    }}
                  >
                    That&apos;s me
                  </button>
                )}
                {isAdmin && member.role && member.role !== "owner" && !self && (
                  <div className="flex shrink-0 gap-2">
                    {isOwner && (
                      <button
                        type="button"
                        disabled={busy}
                        className={smallButton}
                        onClick={() => void run(() => accountApi.setRole(member.playerId, member.role === "admin" ? "member" : "admin"))}
                      >
                        {member.role === "admin" ? "Make member" : "Make admin"}
                      </button>
                    )}
                    {isOwner && member.claimed && (
                      <button
                        type="button"
                        disabled={busy}
                        className={smallButton}
                        data-testid={`button-make-owner-${member.playerId}`}
                        onClick={() => {
                          if (window.confirm(`Make ${member.name} the owner of ${active.name}? You'll become an admin.`)) {
                            void run(async () => {
                              await accountApi.setRole(member.playerId, "owner");
                              window.location.reload();
                            });
                          }
                        }}
                      >
                        Make owner
                      </button>
                    )}
                    {(isOwner || member.role === "member") && (
                      <button
                        type="button"
                        disabled={busy}
                        className={smallButton}
                        onClick={() => {
                          if (window.confirm(`Remove ${member.name} from the club? Their history stays.`)) {
                            void run(() => accountApi.removeMember(member.playerId));
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {isAdmin && (
          <form onSubmit={addName} className="mt-3 flex gap-2">
            <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} placeholder="Add a player who hasn't joined yet" data-testid="input-add-player" />
            <button type="submit" disabled={busy || !newName.trim()} className={smallButton}>
              Add
            </button>
          </form>
        )}
      </details>

      <div className="mt-6 grid gap-4 border-t border-border/70 pt-5 sm:grid-cols-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (startName.trim().length >= 2) {
              void run(async () => {
                await accountApi.createClub({ name: startName.trim(), playerName: me.user!.name });
                window.location.reload();
              });
            }
          }}
        >
          <p className="text-sm font-semibold">Start another club</p>
          <div className="mt-2 flex gap-2">
            <input className={inputClass} value={startName} onChange={(e) => setStartName(e.target.value)} placeholder="Club name" />
            <button type="submit" disabled={busy || startName.trim().length < 2} className={smallButton}>
              Create
            </button>
          </div>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const clean = extractInviteCode(joinCode);
            if (clean.length >= 6) window.location.assign(`/join/${clean}`);
          }}
        >
          <p className="text-sm font-semibold">Join another club</p>
          <div className="mt-2 flex gap-2">
            <input className={inputClass} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Invite link or code" />
            <button type="submit" disabled={extractInviteCode(joinCode).length < 6} className={smallButton}>
              Join
            </button>
          </div>
        </form>
      </div>

      {!isOwner && (
        <button
          type="button"
          disabled={busy}
          className={`${smallButton} mt-5`}
          onClick={() => {
            if (window.confirm(`Leave ${active.name}? Your history stays with the club.`)) {
              void run(async () => {
                await accountApi.leaveClub();
                window.location.reload();
              });
            }
          }}
        >
          <LogOut className="h-4 w-4" />
          Leave this club
        </button>
      )}
    </div>
    {isAdmin && <ClubSettingsPanel />}
    {isAdmin && <ClubDataPanel roster={members.map((member) => member.name)} />}
    {isOwner && (
      <div className="soft-shadow mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="section-label text-primary">Danger zone</p>
        <DeleteClub clubName={active.name} />
      </div>
    )}
    <AccountSecurity user={me.user} />
    </>
  );
}
