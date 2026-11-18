import { useMemo, useState } from "react";
import { Copy, MoreHorizontal, Search } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { accountApi, inviteLink, type ClubSummary, type InviteRow, type MemberRow } from "@/lib/account-api";
import {
  filterPeople,
  looksLikeJunk,
  peopleCounts,
  type PeopleFilter,
  type PersonRow,
} from "@/lib/admin-people";

const chip = "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold";
const smallButton =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60";

const roleLabel = (role: string | null) => (role === "owner" ? "Owner" : role === "admin" ? "Admin" : role === "member" ? "Member" : "Not joined yet");

const FILTERS: Array<{ id: PeopleFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "admins", label: "Admins" },
  { id: "members", label: "Members" },
  { id: "unjoined", label: "Not joined" },
];

/** The admin People list: search, filter chips, role actions behind a menu, and an invite shortcut for names not yet joined. */
export function AdminPeople({
  members,
  played,
  active,
  busy,
  isOwner,
  inviteCode,
  onRun,
}: {
  members: MemberRow[];
  played: Map<number, number>;
  active: ClubSummary;
  busy: boolean;
  isOwner: boolean;
  inviteCode: InviteRow | undefined;
  onRun: (action: () => Promise<unknown>) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [copied, setCopied] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<null | { kind: "remove" | "owner" | "role"; member: MemberRow }>(null);

  const people = useMemo<PersonRow[]>(
    () => members.map((m) => ({ playerId: m.playerId, name: m.name, role: m.role, played: played.get(m.playerId) ?? 0 })),
    [members, played],
  );
  const byId = useMemo(() => new Map(members.map((m) => [m.playerId, m])), [members]);
  const counts = peopleCounts(people);
  const shown = filterPeople(people, query, filter);
  // Unjoined names are noise most of the time, so they stay folded away until asked for.
  const hideUnjoined = filter === "all" && !query.trim();
  const rows = hideUnjoined ? shown.filter((p) => p.role !== null) : shown;
  const hiddenCount = hideUnjoined ? shown.length - rows.length : 0;

  const copyInvite = async (playerId: number) => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteLink(inviteCode.code));
      setCopied(playerId);
      window.setTimeout(() => setCopied((value) => (value === playerId ? null : value)), 1800);
    } catch {
      window.prompt("Copy this invite link", inviteLink(inviteCode.code));
    }
  };

  const confirmCopy = confirming
    ? confirming.kind === "owner"
      ? `Make ${confirming.member.name} the owner of ${active.name}? You will become an admin and can't take ownership back yourself.`
      : confirming.kind === "remove"
        ? `Remove ${confirming.member.name} from ${active.name}? Their history stays, but they lose access.`
        : `Make ${confirming.member.name} ${confirming.member.role === "admin" ? "a regular member" : "an admin"}?`
    : "";

  const runConfirmed = () => {
    if (!confirming) return;
    const { kind, member } = confirming;
    setConfirming(null);
    if (kind === "remove") onRun(() => accountApi.removeMember(member.playerId));
    else if (kind === "owner") onRun(async () => { await accountApi.setRole(member.playerId, "owner"); window.location.reload(); });
    else onRun(() => accountApi.setRole(member.playerId, member.role === "admin" ? "member" : "admin"));
  };

  return (
    <div data-testid="admin-people">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search names"
          aria-label="Search people"
          data-testid="input-people-search"
          className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Filter people">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            data-testid={`chip-people-${item.id}`}
            onClick={() => setFilter(item.id)}
            className={`${chip} ${filter === item.id ? "border-primary bg-primary/15 text-foreground" : "border-border bg-background text-muted-foreground"}`}
          >
            {item.label}
            <span className="font-mono text-[11px]">{counts[item.id === "all" ? "all" : item.id]}</span>
          </button>
        ))}
      </div>

      <ul className="mt-3 divide-y divide-border/70 rounded-xl border border-border" data-testid="list-people">
        {rows.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">Nobody matches.</li>}
        {rows.map((person) => {
          const member = byId.get(person.playerId)!;
          const self = member.name === active.playerName;
          const canRole = isOwner && member.role && member.role !== "owner" && !self;
          const canRemove = member.role && member.role !== "owner" && !self && (isOwner || member.role === "member");
          return (
            <li key={person.playerId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {member.name}
                  {self && <span className="ml-2 text-xs font-normal text-muted-foreground">you</span>}
                  {looksLikeJunk(person) && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">Check name</span>}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {roleLabel(member.role)}
                  {member.email ? ` · ${member.email}` : ""}
                  {` · ${person.played === 0 ? "no games" : `${person.played} ${person.played === 1 ? "game" : "games"}`}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!member.role && inviteCode && (
                  <button type="button" className={smallButton} data-testid={`button-invite-${member.playerId}`} onClick={() => void copyInvite(member.playerId)}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {copied === member.playerId ? "Link copied" : "Invite"}
                  </button>
                )}
                {(canRole || canRemove) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" disabled={busy} aria-label={`Actions for ${member.name}`} data-testid={`button-person-menu-${member.playerId}`} className={`${smallButton} w-9 px-0`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canRole && (
                        <DropdownMenuItem onSelect={() => setConfirming({ kind: "role", member })}>
                          {member.role === "admin" ? "Make member" : "Make admin"}
                        </DropdownMenuItem>
                      )}
                      {canRole && member.claimed && (
                        <DropdownMenuItem onSelect={() => setConfirming({ kind: "owner", member })} data-testid={`button-make-owner-${member.playerId}`}>
                          Make owner…
                        </DropdownMenuItem>
                      )}
                      {canRole && canRemove && <DropdownMenuSeparator />}
                      {canRemove && (
                        <DropdownMenuItem className="text-destructive" onSelect={() => setConfirming({ kind: "remove", member })}>
                          Remove from club…
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <button type="button" onClick={() => setFilter("unjoined")} data-testid="button-show-unjoined" className="mt-2 text-xs font-semibold text-primary">
          Show {hiddenCount} {hiddenCount === 1 ? "name" : "names"} that haven&apos;t joined
        </button>
      )}

      {confirming && (
        <div role="alertdialog" aria-label="Confirm" data-testid="dialog-person-confirm" className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold">{confirmCopy}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={runConfirmed} data-testid="button-person-confirm" className={`${smallButton} ${confirming.kind === "remove" ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}`}>
              {confirming.kind === "remove" ? "Remove" : "Confirm"}
            </button>
            <button type="button" onClick={() => setConfirming(null)} className={smallButton}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
