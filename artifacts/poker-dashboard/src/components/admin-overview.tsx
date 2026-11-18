import { formatCurrency } from "@/views/shared";
import type { AdminOverview } from "@/lib/account-api";
import { peopleCounts, suggestDuplicates, looksLikeJunk, type PersonRow } from "@/lib/admin-people";

const ACTION_LABEL: Record<string, string> = {
  players_merged: "Merged names",
  member_role_changed: "Role changed",
  member_removed: "Member removed",
  owner_handed_over: "Ownership handed over",
  player_added: "Name added",
  history_imported: "History imported",
  history_import_undone: "Import undone",
  night_deleted: "Night deleted",
  night_edited: "Night edited",
  night_recorded: "Night recorded",
  settings_updated: "Settings changed",
  results_exported: "Cash nights exported",
  tournaments_exported: "Tournaments exported",
  jackpot_paid: "Jackpot paid",
  jackpot_changed: "Jackpot changed",
  settle_history: "Old nights settled",
  tournament_edited: "Tournament edited",
  tournament_deleted: "Tournament deleted",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never";

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold" data-testid={testId}>{value}</p>
    </div>
  );
}

/** The top of the admin page: club numbers, what needs attention, and what admins did recently. */
export function AdminSummary({
  people,
  overview,
  jackpotTotal,
  onOpen,
  onOpenRecord,
}: {
  people: PersonRow[];
  overview: AdminOverview | null;
  jackpotTotal: number | null;
  onOpen: (id: "admin-people" | "admin-setup") => void;
  onOpenRecord?: () => void;
}) {
  const counts = peopleCounts(people);
  const dupes = suggestDuplicates(people).length;
  const junk = people.filter((p) => looksLikeJunk(p) && p.played === 0 && !p.role).length;

  const attention: Array<{ key: string; text: string; action?: { label: string; run: () => void } }> = [];
  if (dupes > 0) attention.push({ key: "dupes", text: `${dupes} possible duplicate ${dupes === 1 ? "name" : "names"}`, action: { label: "Review", run: () => onOpen("admin-people") } });
  if (junk > 0) attention.push({ key: "junk", text: `${junk} ${junk === 1 ? "name looks" : "names look"} like test or bookkeeping rows`, action: { label: "Review", run: () => onOpen("admin-people") } });
  if (jackpotTotal !== null && jackpotTotal > 0 && onOpenRecord) {
    attention.push({ key: "jackpot", text: `Bad beat jackpot is at ${formatCurrency(jackpotTotal)}`, action: { label: "Manage on Record", run: onOpenRecord } });
  }
  if (overview && !overview.lastImportAt && people.length === 0) {
    attention.push({ key: "import", text: "No history imported yet", action: { label: "Import", run: () => onOpen("admin-setup") } });
  }

  return (
    <div className="space-y-3" data-testid="section-admin-summary">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Members" value={String(counts.admins + counts.members)} testId="stat-admin-members" />
        <Stat label="Not joined" value={String(counts.unjoined)} testId="stat-admin-unjoined" />
        <Stat label="Last import" value={when(overview?.lastImportAt ?? null)} testId="stat-admin-import" />
        <Stat label="Last export" value={when(overview?.lastExportAt ?? null)} testId="stat-admin-export" />
      </div>

      <div className="soft-shadow rounded-2xl border border-border bg-card p-4" data-testid="panel-admin-attention">
        <p className="text-sm font-semibold">Needs attention</p>
        {attention.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Nothing right now.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border/70">
            {attention.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{item.text}</span>
                {item.action && (
                  <button type="button" onClick={item.action.run} className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary">
                    {item.action.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Recent admin actions: who changed what is otherwise invisible. */
export function AdminActivity({ overview }: { overview: AdminOverview | null }) {
  const rows = overview?.activity ?? [];
  return (
    <div data-testid="list-admin-activity">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No admin actions recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-xl border border-border">
          {rows.map((row) => (
            <li key={row.id} className="px-3 py-2 text-sm">
              <p className="font-semibold">{ACTION_LABEL[row.action] ?? row.action.replace(/_/g, " ")}</p>
              <p className="text-xs text-muted-foreground">{row.detail}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{new Date(row.at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
