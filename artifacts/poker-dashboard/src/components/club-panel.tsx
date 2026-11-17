import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronDown, Copy, LogOut, QrCode, Settings, Share2, Trash2, UserPlus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ClubDataPanel } from "@/components/club-data-panel";
import { ClubSettingsPanel } from "@/components/club-settings-panel";
import { DeleteClub } from "@/components/account-security";
import { MergeNames } from "@/components/merge-names";
import { SettleHistory } from "@/components/settle-history";
import {
  AccountError,
  accountApi,
  extractInviteCode,
  inviteLink,
  type ClubSummary,
  type InviteRow,
  type JackpotSummary,
  type MeResponse,
  type MemberRow,
} from "@/lib/account-api";
import { formatCurrency, formatDate } from "@/views/shared";

const smallButton =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const inputClass = "h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

const roleLabel = (role: string | null) => (role === "owner" ? "Owner" : role === "admin" ? "Admin" : role === "member" ? "Member" : "Not joined yet");

const isClubAdmin = (role: string | null | undefined) => role === "owner" || role === "admin";

function useMeLoader() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const next = await accountApi.me();
    setMe(next);
    return next;
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Something went wrong.");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  return { me, setMe, error, setError, busy, load, run };
}

export function VerifyEmailNotice({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-xs leading-5" data-testid="notice-verify-email">
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

/** Switch club, or start and join another. Personal, so it lives on Me. */
export function MeClubs() {
  const { me, error, busy, load, run } = useMeLoader();
  const [joinCode, setJoinCode] = useState("");
  const [startName, setStartName] = useState("");
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  if (!me?.user) return null;
  const active: ClubSummary | undefined = me.clubs.find((club) => club.slug === me.active) ?? me.clubs[0];
  if (!active) return null;

  return (
    <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-switch-club">
      <p className="section-label text-primary">Clubs</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">Switch club</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        You play as {active.playerName} in {active.name}.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {me.clubs.length > 1 && (
        <ul className="mt-4 space-y-2" data-testid="list-clubs">
          {me.clubs.map((club) => (
            <li key={club.slug} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-semibold">{club.name}</span>
              {club.slug === active.slug ? (
                <span className="text-xs text-muted-foreground">Current</span>
              ) : (
                <button
                  type="button"
                  className={smallButton}
                  data-testid={`button-switch-${club.slug}`}
                  onClick={() => void accountApi.switchClub(club.slug).then(() => window.location.reload())}
                >
                  Switch
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 grid gap-4 border-t border-border/70 pt-5 sm:grid-cols-2">
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
            <input className={inputClass} value={startName} onChange={(e) => setStartName(e.target.value)} placeholder="Club name" data-testid="input-start-club" />
            <button type="submit" disabled={busy || startName.trim().length < 2} className={smallButton} data-testid="button-start-club">
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
            <input className={inputClass} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Invite link or code" data-testid="input-join-club" />
            <button type="submit" disabled={extractInviteCode(joinCode).length < 6} className={smallButton} data-testid="button-join-club">
              Join
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InviteItem({ invite, clubName, primary }: { invite: InviteRow; clubName: string; primary: boolean }) {
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
  const share = async () => {
    const payload = { title: clubName, text: `Join ${clubName}`, url: link };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copy();
  };
  return (
    <li className="rounded-xl border border-border p-3" data-testid={`invite-${invite.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="w-full break-all rounded-md bg-secondary/60 px-2 py-1.5 text-xs">{link}</code>
        <button type="button" onClick={() => void copy()} className={smallButton} aria-label="Copy invite link" data-testid={primary ? "button-copy-invite" : `button-copy-invite-${invite.id}`}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => void share()} className={smallButton} aria-label="Share invite link" data-testid={primary ? "button-share-invite" : `button-share-invite-${invite.id}`}>
          <Share2 className="h-4 w-4" />
          Share
        </button>
        <button type="button" onClick={() => setShowQr((value) => !value)} className={smallButton} aria-label="Show QR code" data-testid={primary ? "button-invite-qr" : `button-invite-qr-${invite.id}`}>
          <QrCode className="h-4 w-4" />
          QR
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

function MemberRoster({
  members,
  active,
  busy,
  manage,
  isOwner,
  onRun,
}: {
  members: MemberRow[];
  active: ClubSummary;
  busy: boolean;
  manage: boolean;
  isOwner: boolean;
  onRun: (action: () => Promise<unknown>) => void;
}) {
  return (
    <ul className="mt-2 divide-y divide-border/70 rounded-xl border border-border" data-testid={manage ? "list-people" : "list-members"}>
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
                {manage && member.email ? ` · ${member.email}` : ""}
              </p>
            </div>
            {!manage && !member.role && (
              <button
                type="button"
                disabled={busy}
                className={smallButton}
                data-testid={`button-claim-${member.playerId}`}
                onClick={() => {
                  if (window.confirm(`Is ${member.name} you? Your results and profile will use that name.`)) {
                    onRun(async () => {
                      await accountApi.claimPlayer(member.playerId);
                      window.location.reload();
                    });
                  }
                }}
              >
                That&apos;s me
              </button>
            )}
            {manage && member.role && member.role !== "owner" && !self && (
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {isOwner && (
                  <button
                    type="button"
                    disabled={busy}
                    className={smallButton}
                    onClick={() => onRun(() => accountApi.setRole(member.playerId, member.role === "admin" ? "member" : "admin"))}
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
                        onRun(async () => {
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
                        onRun(() => accountApi.removeMember(member.playerId));
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
  );
}

function AdminBlock({ id, testId, title, detail, children }: { id: string; testId: string; title: string; detail: string; children: ReactNode }) {
  return (
    <details id={id} data-testid={testId} className="group soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block">{title}</span>
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{detail}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function ClubJackpot() {
  const [jackpot, setJackpot] = useState<JackpotSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    accountApi.jackpot().then((value) => { if (!cancelled) setJackpot(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return (
    <section className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-club-jackpot">
      <p className="section-label text-primary">Jackpot</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">Bad beat jackpot</h2>
      <p className="mt-2 font-mono text-2xl font-semibold" data-testid="text-club-jackpot">
        {jackpot ? formatCurrency(jackpot.total) : "…"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {jackpot
          ? `Built from the surplus of ${jackpot.nights} ${jackpot.nights === 1 ? "night" : "nights"} that closed over.${jackpot.payouts.length > 0 ? ` ${jackpot.payouts.length} ${jackpot.payouts.length === 1 ? "payout" : "payouts"} so far.` : ""}`
          : "Loading the pot."}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">The host or an admin records a payout from the Record tab.</p>
      {jackpot && jackpot.payouts.length > 0 && (
        <ul className="mt-4 divide-y divide-border/70 rounded-xl border border-border" data-testid="list-club-jackpot-payouts">
          {jackpot.payouts.map((payout) => (
            <li key={payout.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-semibold">{payout.name}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">by {payout.by} · {formatDate(payout.at)}</span>
              </span>
              <span className="shrink-0 font-mono text-sm font-semibold">{formatCurrency(payout.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Rules stay in the guidelines view. This is the rest of the Club tab: members, the invite, the jackpot, and admin tools. */
function useClubData() {
  const { me, error, busy, load, run } = useMeLoader();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [adminInvites, setAdminInvites] = useState<InviteRow[]>([]);

  const reload = useCallback(async () => {
    const next = await load();
    if (!next.user || next.clubs.length === 0) return;
    const activeClub = next.clubs.find((club) => club.slug === next.active) ?? next.clubs[0];
    const admin = isClubAdmin(activeClub?.role);
    const [roster, shareable, managed] = await Promise.all([
      accountApi.members().catch(() => ({ members: [] as MemberRow[] })),
      accountApi.shareableInvites().catch(() => ({ invites: [] as InviteRow[] })),
      admin ? accountApi.invites().catch(() => ({ invites: [] as InviteRow[] })) : Promise.resolve({ invites: [] as InviteRow[] }),
    ]);
    setMembers(roster.members);
    setInvites(shareable.invites);
    setAdminInvites(managed.invites.filter((invite) => invite.role === "admin"));
  }, [load]);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  const openedHash = useRef(false);
  useEffect(() => {
    if (!me || openedHash.current) return;
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    openedHash.current = true;
    const node = document.getElementById(id);
    if (node instanceof HTMLDetailsElement) node.open = true;
    node?.scrollIntoView({ block: "start" });
  }, [me]);

  const active: ClubSummary | undefined = me?.user ? me.clubs.find((club) => club.slug === me.active) ?? me.clubs[0] : undefined;
  const act = (action: () => Promise<unknown>) =>
    void run(async () => {
      try {
        await action();
      } finally {
        await reload().catch(() => undefined);
      }
    });

  return {
    me,
    active,
    error,
    busy,
    run,
    act,
    reload,
    members,
    invites,
    adminInvites,
    isAdmin: isClubAdmin(active?.role),
    isOwner: active?.role === "owner",
  };
}

/** The Club tab: what every member uses. Admin tools live on their own page (see ClubAdmin). */
export function ClubHome({ top, rules, onOpenAdmin }: { top?: ReactNode; rules?: ReactNode; onOpenAdmin?: () => void }) {
  const { error, busy, run, act, members, invites, active, isAdmin, isOwner } = useClubData();
  if (!active) return null;

  const resetLink = () => {
    if (!window.confirm("Reset the invite link? Existing member links will stop working.")) return;
    act(async () => {
      for (const invite of invites) await accountApi.revokeInvite(invite.id);
      await accountApi.createInvite({});
    });
  };

  return (
    <div className="space-y-4" data-testid="section-club-home">
      {isAdmin && onOpenAdmin && (
        <div className="flex justify-end">
          <button type="button" onClick={onOpenAdmin} data-testid="button-open-club-admin" className={smallButton}>
            <Settings className="h-4 w-4" aria-hidden="true" />
            Club admin
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {top}
      <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-invites" id="section-invites">
        <p className="section-label text-primary">Invite</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Invite link</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Anyone with this link can join {active.name}. Share it only with your club.</p>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => act(() => accountApi.createInvite({}))} className={smallButton} data-testid="button-new-invite">
                <UserPlus className="h-4 w-4" />
                New link
              </button>
              {invites.length > 0 && (
                <button type="button" disabled={busy} onClick={resetLink} className={smallButton} data-testid="button-reset-invite">
                  Reset link
                </button>
              )}
            </div>
          )}
        </div>
        {invites.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {invites.map((invite, index) => (
              <InviteItem key={invite.id} invite={invite} clubName={active.name} primary={index === 0} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="text-invite-empty">
            {isAdmin ? "There isn't a link yet. Create one to let people join." : "Ask a club admin for an invite link."}
          </p>
        )}
      </div>

      {rules}

      <ClubJackpot />

      <details className="group soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-members">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>Members ({members.length})</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <MemberRoster members={members} active={active} busy={busy} manage={false} isOwner={isOwner} onRun={act} />
      </details>
      {!isOwner && (
        <button
          type="button"
          disabled={busy}
          className={smallButton}
          data-testid="button-leave-club"
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
  );
}

/** Admin tools on their own page, only for owners and admins. */
export function ClubAdmin({ onBack }: { onBack: () => void }) {
  const { error, busy, act, reload, members, adminInvites, active, isAdmin, isOwner } = useClubData();
  const [newName, setNewName] = useState("");
  if (!active) return null;
  if (!isAdmin) {
    return (
      <p className="soft-shadow rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground" data-testid="text-admin-members-only">
        Club admin tools are for club admins.
      </p>
    );
  }

  const addName = (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    act(async () => {
      await accountApi.addPlayer(newName.trim());
      setNewName("");
    });
  };

  return (
    <section className="space-y-3" data-testid="section-admin">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <p className="section-label text-primary">Admin</p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Club admin</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">People, history, settings and deleting the club. Only admins see this page.</p>
        </div>
        <button type="button" onClick={onBack} data-testid="button-admin-back" className={smallButton}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Club
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <AdminBlock id="admin-people" testId="section-admin-people" title="People" detail="Roles, emails and names that haven't joined.">
        <MemberRoster members={members} active={active} busy={busy} manage isOwner={isOwner} onRun={act} />
        <form onSubmit={addName} className="mt-3 flex gap-2">
          <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} placeholder="Add a player who hasn't joined yet" data-testid="input-add-player" />
          <button type="submit" disabled={busy || !newName.trim()} className={smallButton}>
            Add
          </button>
        </form>
        <MergeNames names={members.map((member) => member.name)} mine={active.playerName} onMerged={() => { void reload(); }} />
        {adminInvites.length > 0 && (
          <ul className="mt-4 space-y-2" data-testid="list-admin-invites">
            {adminInvites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-xs">
                <span className="font-semibold">Admin invite</span>
                <code className="min-w-0 flex-1 break-all rounded-md bg-secondary/60 px-2 py-1">{inviteLink(invite.code)}</code>
                <button
                  type="button"
                  className={smallButton}
                  aria-label="Revoke admin invite"
                  onClick={() => act(() => accountApi.revokeInvite(invite.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminBlock>
      <AdminBlock id="admin-setup" testId="section-admin-setup" title="Setup" detail="One-time history import, and CSV export of cash nights and tournaments.">
        <ClubDataPanel embedded />
        <SettleHistory />
      </AdminBlock>
      <AdminBlock id="admin-settings" testId="section-admin-settings" title="Settings" detail="Name, rules, points, currency and timezone.">
        <ClubSettingsPanel embedded />
      </AdminBlock>
      <AdminBlock id="admin-danger" testId="section-admin-danger" title="Danger" detail="Delete the club. This cannot be undone.">
        {isOwner ? (
          <DeleteClub clubName={active.name} />
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-danger-owner-only">Only the club owner can delete the club.</p>
        )}
      </AdminBlock>
    </section>
  );
}
