import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown, Database, EyeOff, HardDriveDownload, LayoutDashboard, LogOut, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";
import { AuthCard } from "@/components/auth-card";
import { Avatar } from "@/components/avatar";
import { formatVisibleDuration } from "@/lib/member-usage";
import { MetricCard, slug } from "./shared";

const AdminAvatarsPanel = lazy(() => import("@/components/admin-avatars").then((m) => ({ default: m.AdminAvatarsPanel })));
const AdminLedgerResetPanel = lazy(() => import("@/components/admin-ledger-reset").then((m) => ({ default: m.AdminLedgerResetPanel })));
const AdminLedgerSessionsPanel = lazy(() => import("@/components/admin-ledger-sessions").then((m) => ({ default: m.AdminLedgerSessionsPanel })));

type AdminUsageSection = {
  memberName: string;
  section: string;
  pageViews: number;
  activeSeconds: number;
  lastActiveAt: string;
};
type AdminVisitResponse = {
  totalVisits: number;
  uniqueMembers: number;
  usage: AdminUsageSection[];
};
type AdminMember = {
  name: string;
  signIns: number;
  signInsLast30: number;
  activeSeconds: number;
  recentActiveSeconds: number;
  lastSeenAt: string | null;
  picture: "none" | "preset" | "upload";
};
type AdminHealth = {
  sheet: { ok: true; lastUpdated: string | null; isStale: boolean } | { ok: false; error: string };
  live: { ok: true; sessionStatus: string; syncStatus: string; lastSyncedAt: string | null; entries: number } | { ok: false; error: string };
  tournaments: { count: number; flagged: string[] };
  lastBackupAt: string | null;
  lastMemberSignInAt: string | null;
};
type AuditEntry = { id: number; action: string; detail: string; ip: string | null; createdAt: string };

const DAY_MS = 24 * 60 * 60 * 1000;
type MemberSort = "lastSeenAt" | "activeSeconds" | "recentActiveSeconds";

function relativeTime(value: string | null, now = Date.now()): string {
  if (!value) return "Never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return value;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const usageSectionLabels: Record<string, string> = {
  overview: "Overview",
  sessions: "Session log",
  live: "Live ledger",
  months: "Leaderboards",
  "head-to-head": "Head-to-head",
  account: "My account",
  players: "Players",
  guidelines: "Guidelines & Rules",
};
const usageSectionLabel = (section: string) => usageSectionLabels[section] ?? section;

const AUDIT_LABELS: Record<string, string> = {
  admin_login: "Admin signed in",
  admin_login_failed: "Failed admin sign-in",
  ledger_reset: "Ledger reset",
  ledger_session_deleted: "Session deleted",
  ledger_backup: "Backup downloaded",
  avatar_updated: "Picture updated",
  avatar_removed: "Picture removed",
  history_imported: "History imported",
  history_import_undone: "Import undone",
  night_deleted: "Night deleted",
  tournament_deleted: "Tournament deleted",
  night_recorded: "Night recorded",
  settings_updated: "Settings changed",
  results_exported: "Results downloaded",
};

// ---------------------------------------------------------------- hidden test members

const HIDDEN_KEY = "admin:hidden-members";
const isTestName = (name: string) => /^dev\b|^test\b/i.test(name.trim());
const nameKey = (name: string) => name.trim().toLocaleLowerCase();

function readHidden(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function useHiddenMembers() {
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [showHidden, setShowHidden] = useState(false);
  const isHidden = useCallback((name: string) => isTestName(name) || hidden.includes(nameKey(name)), [hidden]);
  const hide = (name: string) => {
    const next = [...new Set([...hidden, nameKey(name)])];
    setHidden(next);
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    } catch {
      // Not saved; hidden for this visit only.
    }
  };
  const unhideAll = () => {
    setHidden([]);
    try {
      window.localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // Ignore.
    }
  };
  return { isHidden, hide, unhideAll, showHidden, setShowHidden, hiddenCount: hidden.length };
}

// ---------------------------------------------------------------- data hook

function useAdminJson<T>(path: string, refreshKey: number, refetchIntervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(path, { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error(`${response.status}`);
        const json = (await response.json()) as T;
        if (!cancelled) {
          setData(json);
          setError("");
        }
      } catch {
        if (!cancelled) setError("Couldn't load this section.");
      }
      if (!cancelled && refetchIntervalMs) {
        refreshTimer = window.setTimeout(() => void load(), refetchIntervalMs);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [path, refreshKey, refetchIntervalMs]);
  return { data, error };
}

// ---------------------------------------------------------------- panels

function StatusTile({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "good" | "warn" | "neutral" }) {
  const dot = tone === "good" ? "bg-chart-1" : tone === "warn" ? "bg-amber-500" : "bg-muted-foreground/40";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
        {label}
      </p>
      <p className="mt-2 text-base font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function HealthStrip({ refreshKey, activeMembers }: { refreshKey: number; activeMembers: number | null }) {
  const { data, error } = useAdminJson<AdminHealth>("/api/admin/health", refreshKey);
  if (error) return <p className="mt-5 text-xs text-destructive">{error}</p>;
  if (!data) return <div className="mt-5 h-24 skeleton rounded-2xl" />;

  const sheet = data.sheet;
  const noSheet = !sheet.ok && /No Google Sheet is linked/i.test(sheet.error ?? "");
  const live = data.live;
  const backupAge = data.lastBackupAt ? Date.now() - new Date(data.lastBackupAt).getTime() : null;
  return (
    <section data-testid="section-admin-health" aria-label="Status" className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatusTile
        label="Club sheet"
        value={!sheet.ok ? (noSheet ? "Not used" : "Unavailable") : sheet.isStale ? "Out of date" : "Up to date"}
        detail={sheet.ok ? `Read ${relativeTime(sheet.lastUpdated)}` : noSheet ? "This club records its results in the app." : sheet.error}
        tone={noSheet ? "good" : !sheet.ok || sheet.isStale ? "warn" : "good"}
      />
      <StatusTile
        label="Live ledger"
        value={!live.ok ? "Unavailable" : live.sessionStatus === "open" ? "Game in progress" : live.sessionStatus === "ended" ? "Last game closed" : "No game running"}
        detail={
          live.ok
            ? live.syncStatus === "synced"
              ? `Backed up to the sheet ${relativeTime(live.lastSyncedAt)}`
              : live.syncStatus === "pending"
                ? "Sheet backup pending"
                : "Sheet backup needs attention"
            : live.error
        }
        tone={!live.ok || live.syncStatus === "error" ? "warn" : live.sessionStatus === "open" ? "good" : "neutral"}
      />
      <StatusTile
        label="Tournaments"
        value={data.tournaments.count === 0 ? "None read" : `${data.tournaments.count} on the site`}
        detail={
          data.tournaments.flagged.length > 0
            ? `Sheet flagged: ${data.tournaments.flagged.join(", ")}`
            : data.tournaments.count === 0
              ? "Record one under Club settings, Record a tournament"
              : "All data checks passed"
        }
        tone={data.tournaments.flagged.length > 0 || data.tournaments.count === 0 ? "warn" : "good"}
      />
      <StatusTile
        label="Ledger backup"
        value={data.lastBackupAt ? relativeTime(data.lastBackupAt) : "None yet"}
        detail={data.lastBackupAt ? "Last JSON download" : "Download one before resets or deletions"}
        tone={backupAge === null || backupAge > 30 * DAY_MS ? "warn" : "good"}
      />
      <StatusTile
        label="Members"
        value={activeMembers === null ? "…" : `${activeMembers} active this week`}
        detail={`Last sign-in ${relativeTime(data.lastMemberSignInAt)}`}
        tone="neutral"
      />
    </section>
  );
}

function MembersPanel({
  members,
  error,
  hiddenApi,
  onRefresh,
}: {
  members: AdminMember[] | null;
  error: string;
  hiddenApi: ReturnType<typeof useHiddenMembers>;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy] = useState<MemberSort>("lastSeenAt");
  const { isHidden, hide, unhideAll, showHidden, setShowHidden, hiddenCount } = hiddenApi;

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = (members ?? [])
      .filter((member) => showHidden || !isHidden(member.name))
      .filter((member) => !needle || member.name.toLocaleLowerCase().includes(needle));
    return filtered.sort((left, right) => {
      if (sortBy === "lastSeenAt") {
        const leftTime = left.lastSeenAt ? new Date(left.lastSeenAt).getTime() : Number.NEGATIVE_INFINITY;
        const rightTime = right.lastSeenAt ? new Date(right.lastSeenAt).getTime() : Number.NEGATIVE_INFINITY;
        if (leftTime !== rightTime) return rightTime > leftTime ? 1 : -1;
      } else {
        const difference = right[sortBy] - left[sortBy];
        if (difference !== 0) return difference;
      }
      return left.name.localeCompare(right.name);
    });
  }, [members, query, showHidden, isHidden, sortBy]);
  const rows = showAll ? visible : visible.slice(0, 12);
  const testCount = (members ?? []).filter((member) => isHidden(member.name)).length;
  const neverSignedIn = (members ?? []).filter((member) => !isHidden(member.name) && member.signIns === 0).length;

  return (
    <section data-testid="section-admin-members" className="mt-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="section-label text-primary">Members</p>
          <h2 className="mt-1 text-xl font-semibold">Who&apos;s using the site</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {members ? `${members.filter((m) => !isHidden(m.name)).length} ${members.filter((m) => !isHidden(m.name)).length === 1 ? "member" : "members"}` : "Loading…"}
            {neverSignedIn > 0 ? ` · ${neverSignedIn} never signed in` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              aria-label="Search members"
              className="h-9 w-44 rounded-lg border border-border bg-card pl-8 pr-3 text-xs outline-none focus:border-primary"
            />
          </label>
          <label>
            <span className="sr-only">Sort members by</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as MemberSort)}
              aria-label="Sort members by"
              className="h-9 rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary"
            >
              <option value="lastSeenAt">Sort: Last seen</option>
              <option value="activeSeconds">Sort: Time on site</option>
              <option value="recentActiveSeconds">Sort: Time on site (3 days)</option>
            </select>
          </label>
          <button onClick={onRefresh} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      {(testCount > 0 || hiddenCount > 0) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {showHidden ? "Showing" : "Hiding"} {testCount} test {testCount === 1 ? "member" : "members"}.{" "}
          <button type="button" onClick={() => setShowHidden(!showHidden)} className="font-semibold text-primary hover:underline">
            {showHidden ? "Hide them" : "Show them"}
          </button>
          {hiddenCount > 0 && (
            <>
              {" · "}
              <button type="button" onClick={unhideAll} className="font-semibold text-primary hover:underline">Reset hidden list</button>
            </>
          )}
        </p>
      )}

      <div className="soft-shadow mt-3 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-secondary/35 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Last active</th>
                <th className="px-4 py-3">Sign-ins (30 days)</th>
                <th className="px-4 py-3">Time on site</th>
                <th className="px-4 py-3">Time on site (3 days)</th>
                <th className="px-4 py-3">Picture</th>
                <th className="px-2 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => (
                <tr key={member.name} data-testid={`row-admin-member-${slug(member.name)}`} className="border-t border-border/70">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5 font-semibold">
                      <Avatar name={member.name} size={28} />
                      {member.name}
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 ${member.lastSeenAt ? "" : "text-muted-foreground"}`}>{relativeTime(member.lastSeenAt)}</td>
                  <td className="px-4 py-2.5 font-mono">{member.signInsLast30}</td>
                  <td className="px-4 py-2.5 font-mono">{member.activeSeconds ? formatVisibleDuration(member.activeSeconds) : "—"}</td>
                  <td className="px-4 py-2.5 font-mono">{member.recentActiveSeconds ? formatVisibleDuration(member.recentActiveSeconds) : "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{member.picture === "upload" ? "Photo" : member.picture === "preset" ? "Preset" : "None"}</td>
                  <td className="px-2 py-1.5 text-right">
                    {!isHidden(member.name) && (
                      <button
                        type="button"
                        onClick={() => hide(member.name)}
                        aria-label={`Hide ${member.name} from these numbers`}
                        title="Hide from these numbers"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <EyeOff className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {members && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No members match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {visible.length > 12 && (
          <div className="border-t border-border p-3 text-center">
            <button type="button" onClick={() => setShowAll(!showAll)} className="rounded-lg px-4 py-2 text-xs font-semibold text-primary hover:bg-secondary">
              {showAll ? "Show fewer" : `Show all ${visible.length} members`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ActivityLog({ refreshKey }: { refreshKey: number }) {
  const { data, error } = useAdminJson<{ entries: AuditEntry[] }>("/api/admin/audit", refreshKey);
  const [showAll, setShowAll] = useState(false);
  const entries = data?.entries ?? [];
  const rows = showAll ? entries : entries.slice(0, 8);
  return (
    <section data-testid="section-admin-audit" className="mt-8">
      <p className="section-label text-primary">Accountability</p>
      <h2 className="mt-1 text-xl font-semibold">Admin activity</h2>
      <p className="mt-1 text-xs text-muted-foreground">Admin sign-ins, backups, resets, deletions and removed pictures.</p>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      <div className="soft-shadow mt-3 rounded-2xl border border-border bg-card">
        {data && entries.length === 0 && <p className="p-5 text-sm text-muted-foreground">Nothing recorded yet.</p>}
        <ul className="divide-y divide-border/70">
          {rows.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-4">
              <span className={`shrink-0 text-xs font-semibold sm:w-44 ${entry.action === "admin_login_failed" || entry.action === "ledger_reset" || entry.action === "ledger_session_deleted" ? "text-destructive" : ""}`}>
                {AUDIT_LABELS[entry.action] ?? entry.action}
              </span>
              <span className="min-w-0 flex-1 text-muted-foreground">{entry.detail}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatWhen(entry.createdAt)}</span>
            </li>
          ))}
        </ul>
        {entries.length > 8 && (
          <div className="border-t border-border p-3 text-center">
            <button type="button" onClick={() => setShowAll(!showAll)} className="rounded-lg px-4 py-2 text-xs font-semibold text-primary hover:bg-secondary">
              {showAll ? "Show fewer" : `Show all ${entries.length}`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function UsageSection({ usage, memberVisible, onRefresh }: { usage: AdminUsageSection[]; memberVisible: (name: string) => boolean; onRefresh: () => void }) {
  const groups = useMemo(() => {
    const byMember = new Map<string, { memberName: string; pageViews: number; activeSeconds: number; lastActiveAt: string; sections: AdminUsageSection[] }>();
    for (const entry of usage) {
      if (!memberVisible(entry.memberName)) continue;
      const current = byMember.get(entry.memberName) ?? { memberName: entry.memberName, pageViews: 0, activeSeconds: 0, lastActiveAt: entry.lastActiveAt, sections: [] };
      current.pageViews += entry.pageViews;
      current.activeSeconds += entry.activeSeconds;
      if (entry.lastActiveAt > current.lastActiveAt) current.lastActiveAt = entry.lastActiveAt;
      current.sections.push(entry);
      byMember.set(entry.memberName, current);
    }
    return [...byMember.values()].sort((a, b) => b.activeSeconds - a.activeSeconds);
  }, [usage, memberVisible]);
  const totalSeconds = groups.reduce((sum, group) => sum + group.activeSeconds, 0);
  const totalViews = groups.reduce((sum, group) => sum + group.pageViews, 0);

  return (
    <section data-testid="section-admin-usage" className="mt-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="section-label text-primary">Member usage</p>
          <h2 className="mt-1 text-xl font-semibold">What members open</h2>
          <p className="mt-1 text-xs text-muted-foreground">Section views and time while the tab is visible. No page content, access codes or passwords are collected.</p>
        </div>
        <button onClick={onRefresh} data-testid="button-refresh-admin-usage" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary">
          <Activity className="h-4 w-4" />
          Refresh usage
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard testId="metric-admin-visible-time" label="Visible dashboard time" value={formatVisibleDuration(totalSeconds)} detail="Across members and sections" icon={<Activity />} />
        <MetricCard testId="metric-admin-section-views" label="Section views" value={String(totalViews)} detail="Dashboard sections opened" icon={<LayoutDashboard />} />
        <MetricCard testId="metric-admin-active-members" label="Members with usage" value={String(groups.length)} detail="At least one view recorded" icon={<Users />} />
      </div>
      <details open className="group mt-4 rounded-2xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold">
          Usage by member and section
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-3 border-t border-border p-4 xl:grid-cols-2">
          {groups.length ? groups.map((member) => (
            <article key={member.memberName} data-testid={`card-admin-member-usage-${slug(member.memberName)}`} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{member.memberName}</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">Last active · {formatWhen(member.lastActiveAt)}</p>
                </div>
                <div className="flex gap-4 text-right">
                  <div><p className="section-label">Visible time</p><p className="mt-1 font-mono text-sm font-semibold">{formatVisibleDuration(member.activeSeconds)}</p></div>
                  <div><p className="section-label">Views</p><p className="mt-1 font-mono text-sm font-semibold">{member.pageViews}</p></div>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                {member.sections.slice().sort((a, b) => b.activeSeconds - a.activeSeconds).map((section) => (
                  <div key={section.section} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-medium">{usageSectionLabel(section.section)}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">{section.pageViews} views · {formatVisibleDuration(section.activeSeconds)}</span>
                  </div>
                ))}
              </div>
            </article>
          )) : <p className="col-span-full p-6 text-center text-sm text-muted-foreground">Usage will appear after members browse the dashboard.</p>}
        </div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------- page

function AdminLogin({ onLogin, initialError }: { onLogin: (password: string) => Promise<void>; initialError: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    setWaitSeconds(0);
    try {
      await onLogin(password);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That admin password could not be verified.";
      setError(message);
      const wait = cause as { retryAfterSeconds?: number };
      if (wait.retryAfterSeconds) setWaitSeconds(wait.retryAfterSeconds);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      tone="admin"
      icon={<ShieldCheck className="h-5 w-5" />}
      areaLabel="Admin area"
      eyebrow="Restricted area"
      title="Admin sign in"
      intro={
        <p>
          This area can view member activity and <strong className="text-foreground">permanently erase ledger data</strong>.
          Sign-ins and actions are recorded.
        </p>
      }
      fieldLabel="Admin password"
      value={password}
      onChange={setPassword}
      error={error}
      waitSeconds={waitSeconds}
      submitting={submitting}
      submitLabel="Open admin area"
      onSubmit={() => void submit()}
      testIds={{ input: "input-admin-password", submit: "button-admin-login", error: "status-admin-login-error" }}
      note={<p>Forgotten it? Whoever manages the Replit project can reset the <span className="font-mono">ADMIN_PASSWORD</span> secret.</p>}
      footer={<a href="/dashboard" className="hover:text-primary hover:underline">Back to the member dashboard</a>}
    />
  );
}

function sessionEndsIn(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "Session has ended";
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return `Signed in · session ends in ${days} ${days === 1 ? "day" : "days"}`;
  return `Signed in · session ends in ${Math.max(1, Math.round(ms / 3_600_000))} h`;
}

export function AdminPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [data, setData] = useState<AdminVisitResponse | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadVisits = useCallback(async () => {
    const response = await fetch("/api/admin/visits", { credentials: "include" });
    if (response.status === 401) {
      setAuthenticated(false);
      setData(null);
      return;
    }
    if (!response.ok) throw new Error("Unable to load usage.");
    setData((await response.json()) as AdminVisitResponse);
    setAuthenticated(true);
    setError("");
  }, []);

  const loadSession = useCallback(async () => {
    const session = (await (await fetch("/api/auth/admin/session", { credentials: "include" })).json()) as { authenticated: boolean; expiresAt?: string | null };
    setExpiresAt(session.expiresAt ?? null);
    return session.authenticated;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSession()
      .then(async (ok) => {
        if (cancelled) return;
        if (ok) {
          try {
            await loadVisits();
          } catch {
            if (!cancelled) setError("Usage could not be loaded.");
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError("The admin service is unavailable. Try again shortly.");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSession, loadVisits]);

  useEffect(() => {
    if (!authenticated) return;
    const interval = window.setInterval(() => {
      void loadVisits().catch(() => setError("Usage could not be refreshed."));
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [authenticated, loadVisits]);

  const login = async (password: string) => {
    const response = await fetch("/api/auth/admin/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = (await response.json()) as { error?: string; retryAfterSeconds?: number };
    if (!response.ok) {
      throw Object.assign(new Error(result.error ?? "That admin password could not be verified."), { retryAfterSeconds: result.retryAfterSeconds });
    }
    await loadSession();
    await loadVisits();
  };

  const logout = async () => {
    await fetch("/api/auth/admin/logout", { method: "POST", credentials: "include" });
    setAuthenticated(false);
    setData(null);
  };

  if (checking) {
    return <div data-testid="state-auth-loading" className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">Checking sign-in…</div>;
  }
  if (!authenticated) return <AdminLogin onLogin={login} initialError={error} />;

  return (
    <AdminDashboard
      data={data}
      error={error}
      expiresAt={expiresAt}
      refreshKey={refreshKey}
      onLogout={logout}
      onRefresh={() => {
        setError("");
        setRefreshKey((value) => value + 1);
        void loadVisits().catch(() => setError("Usage could not be loaded."));
      }}
    />
  );
}

function AdminDashboard({
  data,
  error,
  expiresAt,
  refreshKey,
  onLogout,
  onRefresh,
}: {
  data: AdminVisitResponse | null;
  error: string;
  expiresAt: string | null;
  refreshKey: number;
  onLogout: () => Promise<void>;
  onRefresh: () => void;
}) {
  const hiddenApi = useHiddenMembers();
  const { data: memberData, error: memberError } = useAdminJson<{ members: AdminMember[] }>("/api/admin/members", refreshKey, 30_000);
  const members = memberData?.members ?? null;
  const activeThisWeek = members
    ? members.filter((member) => !hiddenApi.isHidden(member.name) && member.lastSeenAt && Date.now() - new Date(member.lastSeenAt).getTime() < 7 * DAY_MS).length
    : null;
  const memberVisible = useCallback((name: string) => hiddenApi.showHidden || !hiddenApi.isHidden(name), [hiddenApi]);
  const endsIn = sessionEndsIn(expiresAt);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <div className="bg-amber-500/15 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-200">
        Restricted · club admins only
      </div>
      <main className="mx-auto max-w-[1200px] px-4 py-5 sm:px-7 lg:px-10 lg:py-8">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Admin dashboard</h1>
              {endsIn && <p className="mt-0.5 text-xs text-muted-foreground">{endsIn}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/dashboard" className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary">Member dashboard</a>
            <button onClick={onRefresh} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary"><RefreshCw className="h-3.5 w-3.5" />Refresh all</button>
            <button onClick={() => void onLogout()} data-testid="button-admin-logout" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary"><LogOut className="h-3.5 w-3.5" />Sign out</button>
          </div>
        </header>

        {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

        <HealthStrip refreshKey={refreshKey} activeMembers={activeThisWeek} />
        <MembersPanel members={members} error={memberError} hiddenApi={hiddenApi} onRefresh={onRefresh} />
        <UsageSection usage={data?.usage ?? []} memberVisible={memberVisible} onRefresh={onRefresh} />
        <ActivityLog refreshKey={refreshKey} />

        <Suspense fallback={<p className="mt-8 text-xs text-muted-foreground">Loading tools…</p>}>
          <div className="mt-8"><AdminAvatarsPanel /></div>
        </Suspense>

        <details data-testid="section-admin-danger" className="group mt-10 rounded-2xl border border-destructive/40 bg-destructive/[0.04]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
            <span>
              <span className="flex items-center gap-2 text-sm font-semibold text-destructive"><Database className="h-4 w-4" />Danger zone</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Reset the live ledger or delete closed sessions. Both are permanent and need a fresh backup first.</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="space-y-4 border-t border-destructive/30 p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><HardDriveDownload className="h-4 w-4" />Every backup, reset and deletion is written to the activity log above.</p>
            <Suspense fallback={<p className="text-xs text-muted-foreground">Loading ledger tools…</p>}>
              <AdminLedgerResetPanel />
              <AdminLedgerSessionsPanel />
            </Suspense>
          </div>
        </details>
      </main>
    </div>
  );
}
