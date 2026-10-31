import { useEffect, useState } from "react";
import { Spade } from "lucide-react";
import { formatVisibleDuration } from "@/lib/member-usage";

type SectionUsage = {
  section: string;
  pageViews: number;
  activeSeconds: number;
  lastActiveAt: string;
};

type MemberUsage = {
  name: string;
  signIns: number;
  lastSignInAt: string | null;
  activeSeconds: number;
  lastActiveAt: string | null;
  sections: SectionUsage[];
};

type ClubUsage = {
  id: number;
  name: string;
  slug: string;
  signIns: number;
  lastSignInAt: string | null;
  activeSeconds: number;
  members: MemberUsage[];
};

const SECTION_LABELS: Record<string, string> = {
  overview: "Home",
  sessions: "Games",
  live: "Live",
  months: "Leaderboard",
  "head-to-head": "Head-to-head",
  players: "Profile",
  guidelines: "Club",
  account: "Me",
};

const sectionLabel = (section: string) => SECTION_LABELS[section] ?? section;

function formatWhen(value: string | null): string {
  if (!value) return "No sign-ins yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "item";
}

export function PlatformUsagePage() {
  const [state, setState] = useState<"loading" | "denied" | "ready" | "error">("loading");
  const [clubs, setClubs] = useState<ClubUsage[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/platform/usage", { credentials: "include", cache: "no-store" });
        if (cancelled) return;
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          setState("denied");
          return;
        }
        if (!response.ok) {
          setState("error");
          return;
        }
        const json = (await response.json()) as { clubs?: ClubUsage[] };
        if (cancelled) return;
        setClubs(Array.isArray(json.clubs) ? json.clubs : []);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div data-testid="state-auth-loading" className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">
        Checking sign-in…
      </div>
    );
  }
  if (state === "denied") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 text-foreground">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">404 Page not found</h1>
          <a href="/" className="mt-4 inline-flex h-10 items-center text-sm font-semibold text-primary">Back to the club</a>
        </div>
      </main>
    );
  }
  if (state === "error") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 text-foreground">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load usage. Try again shortly.</p>
      </main>
    );
  }

  const signIns = clubs.reduce((sum, club) => sum + club.signIns, 0);
  const activeSeconds = clubs.reduce((sum, club) => sum + club.activeSeconds, 0);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <main data-testid="section-platform-usage" className="mx-auto max-w-3xl px-5 py-8">
        <a href="/" className="mb-6 flex items-center gap-3" data-testid="link-platform-home">
          <span className="brand-mark flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_3px_0_hsl(262_80%_40%)]">
            <Spade className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Back to your club</span>
        </a>
        <p className="section-label text-primary">Platform</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Site usage</h1>
        <p data-testid="text-platform-readonly" className="mt-2 text-sm leading-6 text-muted-foreground">
          View only. Sign-ins, time on site and sections opened, across every club. Nothing here changes a club.
        </p>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat label="Clubs" value={String(clubs.length)} />
          <Stat label="Sign-ins" value={String(signIns)} />
          <Stat label="Time on site" value={formatVisibleDuration(activeSeconds)} />
        </div>
        <div className="mt-8 space-y-4">
          {clubs.length === 0 && <p className="text-sm text-muted-foreground">No clubs yet.</p>}
          {clubs.map((club) => (
            <article key={club.id} data-testid={`card-platform-club-${club.slug}`} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 data-testid={`text-platform-club-${club.slug}`} className="text-lg font-semibold">{club.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Last sign-in · {formatWhen(club.lastSignInAt)}</p>
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  {club.signIns} {club.signIns === 1 ? "sign-in" : "sign-ins"} · {formatVisibleDuration(club.activeSeconds)}
                </p>
              </div>
              {club.members.length === 0 ? (
                <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">No usage recorded yet.</p>
              ) : (
                <ul className="mt-4 space-y-4 border-t border-border pt-4">
                  {club.members.map((member) => (
                    <li key={member.name} data-testid={`row-platform-member-${slug(member.name)}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-semibold">{member.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {member.signIns} {member.signIns === 1 ? "sign-in" : "sign-ins"} · {formatVisibleDuration(member.activeSeconds)}
                        </p>
                      </div>
                      {member.sections.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {member.sections.map((section) => (
                            <li key={section.section} className="flex items-center justify-between gap-3 text-xs">
                              <span>{sectionLabel(section.section)}</span>
                              <span className="font-mono text-muted-foreground">
                                {section.pageViews} {section.pageViews === 1 ? "view" : "views"} · {formatVisibleDuration(section.activeSeconds)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}
