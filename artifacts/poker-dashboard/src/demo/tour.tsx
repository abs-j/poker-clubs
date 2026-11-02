// Guided walkthrough for the public demo. A small card steps through the main sections,
// switching the page underneath and ringing the control it is talking about.
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Compass, X } from "lucide-react";
import type { DashboardView } from "@/components/app-nav";

type Step = {
  view: DashboardView;
  title: string;
  body: string;
  /** data-testid values to ring, first visible one wins (desktop and phone layouts differ). */
  targets?: string[];
  /** Extra lines shown as a list under the body. */
  points?: string[];
  id?: string;
};

const STEPS: Step[] = [
  {
    view: "overview",
    title: "Welcome to Riverside Poker Club",
    body: "A two-minute tour of Poker Clubs: the results tracker for uni clubs and friend groups. Everything here is made up. Follow along, or close this and explore freely.",
  },
  {
    view: "overview",
    title: "Home: your last game and the month",
    body: "Your result from the last game, how far you moved on the leaderboard, and the month's club points and profit podiums. Open the Share menu to turn a result into a picture, with an option to hide the money.",
    targets: ["text-dashboard-title", "card-my-night"],
  },
  {
    view: "sessions",
    title: "Games: every night on record",
    body: "Cash nights and tournaments each get a history. Open a night to see who bought in and cashed out, share it as a picture, or build Instagram-sized slides from it.",
    targets: ["nav-sessions"],
  },
  {
    view: "live",
    title: "Live ledger: run tonight",
    body: "One game is already running. Add a buy-in or cash-out, edit an entry (a reason is recorded), then close the night to check the table balances. Changes only last until you refresh.",
    targets: ["nav-live"],
  },
  {
    view: "months",
    title: "Leaderboard: points and profit",
    body: "Monthly club points that reward turning up and finishing high, plus the full profit table. Tap anyone for a profile with their form, trophies and a you-versus-them comparison.",
    targets: ["nav-months"],
  },
  {
    view: "guidelines",
    title: "Club: people, rules and invites",
    body: "Club Buzz, the invite link and QR code, house rules and the member list. Joining is invite-only, so there is no public directory.",
    targets: ["nav-guidelines"],
  },
  {
    view: "account",
    title: "Me: pictures, trophies and Wrapped",
    body: "Your picture, record and trophies, and Poker Wrapped: a swipeable replay of each finished month you can share as pictures.",
    targets: ["button-open-account"],
  },
  {
    view: "overview",
    id: "built",
    title: "How it's built",
    body: "This demo is a static copy of the real app with a fake in-browser API. The real one has accounts, a database and live data. For anyone curious about the engineering:",
    points: [
      "React 19 + Vite + Tailwind front end, installable as a PWA",
      "Express 5 API with Better Auth sign-in and invite-only clubs",
      "Postgres with Drizzle; every row scoped to a club",
      "Results, points and recaps are pure, unit-tested functions",
      "Typed OpenAPI contract with generated clients and validators",
      "CI runs typecheck, unit tests and an end-to-end browser test",
    ],
  },
];

/** Index of the "How it's built" step, so a link can open the tour right there. */
const BUILT_INDEX = STEPS.findIndex((candidate) => candidate.id === "built");

const SEEN_KEY = "riverside-demo-tour-seen";

const wantsBuilt = () => {
  try {
    return new URLSearchParams(window.location.search).get("tour") === "built";
  } catch {
    return false;
  }
};

function visibleTarget(ids: string[] | undefined): HTMLElement | null {
  for (const id of ids ?? []) {
    for (const node of document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)) {
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return node;
    }
  }
  return null;
}

export function DemoTour({ activeView, onNavigate }: { activeView: DashboardView; onNavigate: (view: DashboardView) => void }) {
  const [open, setOpen] = useState(() => {
    if (wantsBuilt()) return true;
    try {
      return window.sessionStorage.getItem(SEEN_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const [index, setIndex] = useState(() => (wantsBuilt() ? BUILT_INDEX : 0));
  const [ring, setRing] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const step = STEPS[index];

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // The tour simply offers itself again on the next visit.
    }
  }, []);

  const go = (next: number) => {
    const target = Math.min(Math.max(next, 0), STEPS.length - 1);
    setIndex(target);
    if (STEPS[target].view !== activeView) onNavigate(STEPS[target].view);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Ring the control this step is about. It is measured again after the new view has rendered.
  useLayoutEffect(() => {
    if (!open) {
      setRing(null);
      return;
    }
    const measure = () => {
      const node = visibleTarget(step.targets);
      if (!node) return setRing(null);
      const box = node.getBoundingClientRect();
      setRing({ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 });
    };
    const timer = window.setTimeout(measure, 350);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step, activeView]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setIndex(0); setOpen(true); }}
        data-testid="button-demo-tour"
        className="print-hidden fixed bottom-20 right-4 z-50 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5 lg:bottom-6 lg:right-6"
      >
        <Compass className="h-4 w-4" />
        Take the tour
      </button>
    );
  }

  const last = index === STEPS.length - 1;
  return (
    <>
      {ring && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-xl ring-2 ring-primary transition-all duration-300"
          style={{ top: ring.top, left: ring.left, width: ring.width, height: ring.height, boxShadow: "0 0 0 6px hsl(var(--primary) / 0.18)" }}
        />
      )}
      <aside
        role="dialog"
        aria-label="Guided tour"
        data-testid="demo-tour"
        className="print-hidden fixed inset-x-3 bottom-20 z-50 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl sm:left-auto sm:right-4 sm:w-[380px] lg:bottom-6 lg:right-6"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="section-label text-primary">Tour · {index + 1} of {STEPS.length}</p>
          <button type="button" onClick={close} aria-label="Close tour" data-testid="button-demo-tour-close" className="-m-2 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 className="mt-2 text-base font-semibold tracking-tight">{step.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
        {step.points && (
          <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
            {step.points.map((point) => (
              <li key={point} className="flex gap-2"><span aria-hidden="true" className="text-primary">•</span>{point}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {STEPS.map((_, dot) => <span key={dot} className={`h-1 flex-1 rounded-full ${dot <= index ? "bg-primary" : "bg-secondary"}`} />)}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" />Back
          </button>
          {last ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={close} data-testid="button-demo-tour-done" className="inline-flex h-10 items-center rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:text-foreground">Keep exploring</button>
              <a href="/" data-testid="link-demo-create-club" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground">Create your club</a>
            </div>
          ) : (
            <button type="button" onClick={() => go(index + 1)} data-testid="button-demo-tour-next" className="inline-flex h-10 items-center gap-1 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground">
              {index === 0 ? "Start tour" : "Next"}<ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
