import { useEffect, useState } from "react";
import { accountApi, type AiStatus } from "@/lib/account-api";
import { RecordNight } from "@/components/record-night";
import { LiveSessionView } from "./live-view";

type Mode = "paste" | "table";

/**
 * The Record tab. Two ways to put a night on the leaderboard: paste notes (or a photo), or run the table.
 * Pasting is for admins; anyone can open the table. The table mode is still the live ledger for now.
 */
export function RecordView({ memberName, availablePlayers, clubAdmin, onRecorded }: { memberName: string; availablePlayers: string[]; clubAdmin: boolean; onRecorded: () => void }) {
  const [mode, setMode] = useState<Mode>(clubAdmin ? "paste" : "table");
  const [ai, setAi] = useState<AiStatus | null>(null);

  useEffect(() => {
    if (!clubAdmin) return;
    let cancelled = false;
    accountApi.aiStatus().then((status) => { if (!cancelled) setAi(status); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [clubAdmin]);

  const tab = (id: Mode, label: string) => (
    <button type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} data-testid={`tab-record-${id}`}
      className={`min-h-[44px] flex-1 rounded-lg px-3 text-sm font-semibold ${mode === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4" data-testid="view-record">
      {clubAdmin && (
        <div role="tablist" aria-label="How to record" className="flex gap-1 rounded-xl border border-border bg-card p-1">
          {tab("paste", "Paste notes")}
          {tab("table", "At the table")}
        </div>
      )}
      {mode === "paste" && clubAdmin ? (
        <RecordNight roster={availablePlayers} ai={ai} onSaved={onRecorded} />
      ) : (
        <LiveSessionView memberName={memberName} availablePlayers={availablePlayers} />
      )}
    </div>
  );
}
