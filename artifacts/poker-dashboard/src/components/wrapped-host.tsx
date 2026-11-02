import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ErrorBoundary, type ErrorFallbackProps } from "@/components/error-boundary";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildSeasonRecap } from "@/lib/achievements";
import type { ChartSession } from "@/lib/club-charts";
import {
  completedMonthKeys,
  dismissMonth,
  loadDismissed,
  monthTitle,
  resolveAsOf,
  saveDismissed,
  WRAPPED_Z_INDEX,
} from "@/lib/wrapped";

const SeasonRecapDialog = lazy(() => import("@/components/season-recap"));

type WrappedContextValue = {
  months: string[];
  openMonth: (month: string) => void;
};

const WrappedContext = createContext<WrappedContextValue | null>(null);

export function useWrappedArchive(): WrappedContextValue {
  return useContext(WrappedContext) ?? { months: [], openMonth: () => undefined };
}

function safeRecap(sessions: ChartSession[], viewer: string, month: string) {
  try {
    return buildSeasonRecap(sessions, viewer, month);
  } catch {
    return null;
  }
}

function QuietFallback(_props: ErrorFallbackProps) {
  return null;
}

type WrappedHostProps = {
  sessions: ChartSession[];
  viewer: string;
  children: ReactNode;
  /** Open the latest finished month by itself once. The demo turns this off so its tour is not covered. */
  autoOpen?: boolean;
};

/** Owns the Wrapped popup and the archive opener. A failure here does not take the page down. */
export function WrappedHost({ sessions, viewer, children, autoOpen = true }: WrappedHostProps) {
  const asOf = useMemo(
    () => resolveAsOf(typeof window === "undefined" ? "" : window.location.search, import.meta.env.DEV),
    [],
  );
  const months = useMemo(
    () => completedMonthKeys(sessions.map((session) => session.date), asOf),
    [sessions, asOf],
  );
  const [manual, setManual] = useState<string | null>(null);
  const [skipAuto, setSkipAuto] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(() => loadDismissed(viewer));
  useEffect(() => {
    setDismissed(loadDismissed(viewer));
  }, [viewer]);

  const latest = months[0] ?? null;
  const latestReady = useMemo(
    () => (latest ? Boolean(safeRecap(sessions, viewer, latest)) : false),
    [sessions, viewer, latest],
  );
  const auto = autoOpen && !skipAuto && !manual && latest && latestReady && !dismissed.includes(latest) ? latest : null;
  const shown = manual ?? auto;

  const value = useMemo<WrappedContextValue>(() => ({ months, openMonth: (month) => setManual(month) }), [months]);

  const close = () => {
    if (manual) {
      setManual(null);
      setSkipAuto(true);
      return;
    }
    if (auto) {
      const next = dismissMonth(dismissed, auto);
      saveDismissed(viewer, next);
      setDismissed(next);
      setSkipAuto(true);
    }
  };

  return (
    <WrappedContext.Provider value={value}>
      {children}
      <ErrorBoundary FallbackComponent={QuietFallback}>
        {shown ? (
          safeRecap(sessions, viewer, shown) ? (
            <Suspense fallback={null}>
              <SeasonRecapDialog
                open
                onOpenChange={(open) => {
                  if (!open) close();
                }}
                sessions={sessions}
                viewer={viewer}
                month={shown}
              />
            </Suspense>
          ) : (
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open) close();
              }}
            >
              <DialogContent layer={WRAPPED_Z_INDEX} data-testid="dialog-poker-wrapped" className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{monthTitle(shown)}</DialogTitle>
                  <DialogDescription>There are no recorded games for that month.</DialogDescription>
                </DialogHeader>
                <button
                  type="button"
                  onClick={close}
                  data-testid="button-dismiss-wrapped"
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  Done
                </button>
              </DialogContent>
            </Dialog>
          )
        ) : null}
      </ErrorBoundary>
    </WrappedContext.Provider>
  );
}
