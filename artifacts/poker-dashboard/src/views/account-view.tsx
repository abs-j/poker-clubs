import { useEffect, useMemo, useState } from "react";
import { Camera, Download, LogOut, Moon, Sun } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { AvatarPickerDialog } from "@/components/avatar-picker-dialog";
import { BadgeChips, FormDots } from "@/components/form-dots";
import { TrophyShelf } from "@/components/trophy-shelf";
import { useWrappedArchive } from "@/components/wrapped-host";
import { monthTitle } from "@/lib/wrapped";
import { badgesFor, buildAccountStats, buildFormDots } from "@/lib/achievements";
import { useAchievements } from "@/components/achievements-context";
import { careerFor } from "@/lib/career";
import { avatarKey, useAvatarMutations, useMemberAvatars } from "@/lib/avatars";
import type { ChartSession } from "@/lib/club-charts";
import { getBadgePopups, setBadgePopups } from "@/lib/preferences";
import { ordinal } from "@/lib/utils";
import { usePoints } from "@/components/points-context";
import { pointsFor, seasonLabel } from "@/lib/points";
import { AccountSecurity } from "@/components/account-security";
import { MeClubs, VerifyEmailNotice } from "@/components/club-panel";
import { accountApi, type MeResponse } from "@/lib/account-api";
import { PageIntro, signedCurrency } from "./shared";

type AccountViewProps = {
  memberName: string;
  sessions: ChartSession[];
  standing?: { rank: number; of: number; net: number };
  isDark: boolean;
  onToggleTheme: () => void;
  canInstall: boolean;
  onInstall: () => void;
  onLogout: () => void;
  onOpenProfile: () => void;
  onOpenRules: () => void;
};

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl bg-secondary/45 p-3">
      <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className={`mt-1.5 font-mono text-base font-semibold ${tone === "pos" ? "text-chart-1" : tone === "neg" ? "text-destructive" : ""}`}>{value}</p>
      {detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function SettingRow({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/70 py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      {children}
    </div>
  );
}

/** Personal page opened from the avatar: picture, record, trophies and account settings. Club admin lives on the Club tab. */
export function AccountView({
  memberName,
  sessions,
  standing,
  isDark,
  onToggleTheme,
  canInstall,
  onInstall,
  onLogout,
  onOpenProfile,
  onOpenRules,
}: AccountViewProps) {
  const memberAvatars = useMemberAvatars();
  const { currentSeason, rowsFor } = usePoints();
  const myPoints = currentSeason ? pointsFor(rowsFor(currentSeason), memberName) : null;
  const { remove } = useAvatarMutations();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [popups, setPopups] = useState(getBadgePopups);
  const [me, setMe] = useState<MeResponse | null>(null);
  const current = memberAvatars.get(avatarKey(memberName));
  useEffect(() => {
    let cancelled = false;
    accountApi.me().then((next) => { if (!cancelled) setMe(next); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const { badges: badgeMap, careers } = useAchievements();
  const career = careerFor(careers, memberName);
  const stats = useMemo(() => buildAccountStats(sessions, memberName), [sessions, memberName]);
  const badges = badgesFor(badgeMap, memberName);
  const dots = useMemo(() => buildFormDots(sessions, memberName), [sessions, memberName]);

  return (
    <section data-testid="section-account" className="space-y-4">
      <PageIntro eyebrow="You" title="Me" description="Your picture, record, trophies and settings." count={`${stats?.games ?? 0} ${stats?.games === 1 ? "game" : "games"} played`} />

      <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Change your profile picture"
            data-testid="button-account-avatar"
            className="group relative shrink-0 rounded-full"
          >
            <Avatar name={memberName} size={96} />
            <span className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow transition-transform group-hover:scale-110">
              <Camera className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-semibold tracking-tight" data-testid="text-account-name">{memberName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {standing ? `${ordinal(standing.rank)} of ${standing.of} on profit` : "Not on the leaderboard yet"}
              {myPoints && currentSeason ? ` · ${ordinal(myPoints.rank)} on club points (${Math.round(myPoints.points)} pts, ${seasonLabel(currentSeason)})` : ""}
              {career ? ` · ${career.games} games played` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <FormDots dots={dots} />
              <BadgeChips badges={badges} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                data-testid="button-account-change-picture"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                <Camera className="h-3.5 w-3.5" />
                {current ? "Change picture" : "Add a picture"}
              </button>
              {current && (
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                  className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60"
                >
                  Use automatic picture
                </button>
              )}
              <button
                type="button"
                onClick={onOpenProfile}
                data-testid="button-account-open-profile"
                className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary"
              >
                Full player profile
              </button>
            </div>
          </div>
        </div>
      </div>

      {career || stats ? (
        <div data-testid="grid-account-stats" className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat
            label="Net profit"
            value={signedCurrency(standing?.net ?? career?.net ?? stats?.net ?? 0)}
            tone={(standing?.net ?? career?.net ?? stats?.net ?? 0) >= 0 ? "pos" : "neg"}
            detail={standing ? `${ordinal(standing.rank)} of ${standing.of}` : undefined}
          />
          <Stat
            label="Club points"
            value={myPoints ? String(Math.round(myPoints.points)) : "—"}
            detail={myPoints && currentSeason ? `${ordinal(myPoints.rank)} · ${seasonLabel(currentSeason)}` : "Not scored yet"}
          />
          <Stat label="Games" value={String(career?.games ?? stats?.games ?? 0)} detail={career ? `${Math.round(career.inProfitPct)}% in profit` : undefined} />
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Your record will show here after your first recorded game.
        </div>
      )}

      <TrophyShelf sessions={sessions} playerName={memberName} badgeMap={badgeMap} careerGames={career?.games} />
      <WrappedArchive />

      {me?.options.email && me.user && !me.user.emailVerified && <VerifyEmailNotice email={me.user.email} />}
      {me?.user && <AccountSecurity user={me.user} part="password" />}

      <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6">
        <SettingRow title="Club" detail="Rules, members, invites and admin.">
          <button type="button" onClick={onOpenRules} data-testid="button-me-rules" className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary">
            Open
          </button>
        </SettingRow>
      </div>

      <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="section-label text-primary">Settings</p>
        <h2 className="mb-4 mt-1 text-lg font-semibold tracking-tight">This device</h2>
        <SettingRow title="Appearance" detail={isDark ? "Currently dark." : "Currently light."}>
          <button
            type="button"
            onClick={onToggleTheme}
            data-testid="button-account-theme"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {isDark ? "Switch to light" : "Switch to dark"}
          </button>
        </SettingRow>
        <SettingRow title="Badge pop-ups" detail="Show a message when you earn a new badge.">
          <button
            type="button"
            role="switch"
            aria-checked={popups}
            aria-label="Badge pop-ups"
            data-testid="switch-badge-popups"
            onClick={() => {
              setPopups(!popups);
              setBadgePopups(!popups);
            }}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${popups ? "bg-primary" : "bg-muted-foreground/30"}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${popups ? "translate-x-5" : ""}`} />
          </button>
        </SettingRow>
        {canInstall && (
          <SettingRow title="Install the app" detail="Add the site to your home screen for quick access.">
            <button type="button" onClick={onInstall} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary">
              <Download className="h-4 w-4" />
              Install
            </button>
          </SettingRow>
        )}
      </div>

      <MeClubs />

      <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6">
        <SettingRow title="Sign out" detail={`Signed in as ${memberName}.`}>
          <button
            type="button"
            onClick={onLogout}
            data-testid="button-account-logout"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </SettingRow>
      </div>

      {me?.user && <AccountSecurity user={me.user} part="danger" />}

      <AvatarPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} name={memberName} current={current} />
    </section>
  );
}

/** Past months as Poker Wrapped. The newest finished month also opens by itself once. */
function WrappedArchive() {
  const { months, openMonth } = useWrappedArchive();
  if (months.length === 0) return null;
  return (
    <section id="poker-wrapped" data-testid="section-wrapped-archive" className="soft-shadow rounded-2xl border border-border bg-card p-5">
      <p className="section-label text-primary">Poker Wrapped</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">Your months, replayed</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {months.slice(0, 12).map((month) => (
          <button
            key={month}
            type="button"
            onClick={() => openMonth(month)}
            data-testid={`button-wrapped-${month}`}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary"
          >
            {monthTitle(month)}
          </button>
        ))}
      </div>
    </section>
  );
}
