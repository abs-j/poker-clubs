import { Download, X } from "lucide-react";

/** Shown on Home after someone arrives from the club's old website, until they dismiss it or install. */
export function MovedCard({ clubName, canInstall, oneTap, onInstall, onDismiss }: { clubName: string; canInstall: boolean; oneTap: boolean; onInstall: () => void; onDismiss: () => void }) {
  return (
    <div data-testid="card-moved" className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-3 pl-4">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{clubName} lives here now</span>
        <span className="block text-xs text-muted-foreground">
          {canInstall ? "If you had the old site on your home screen, delete that icon and add this one." : "Bookmark this page; the old link only sends you here."}
        </span>
      </span>
      {canInstall && (
        <button
          type="button"
          onClick={() => {
            onInstall();
            onDismiss();
          }}
          data-testid="button-moved-install"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {oneTap ? "Install" : "Show me"}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        data-testid="button-moved-dismiss"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
