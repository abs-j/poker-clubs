import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accountApi, type AiStatus } from "@/lib/account-api";
import { JackpotPanel } from "@/components/jackpot-panel";
import { RecordNight } from "@/components/record-night";
import { LiveSessionView } from "./live-view";

type Mode = "paste" | "table";

/**
 * The Record tab. Two ways to put a night on the leaderboard: paste notes (or a photo), or run the table.
 * Pasting is for admins; anyone can open the table. The table mode is still the live ledger for now.
 */
export function RecordView({ memberName, availablePlayers, clubAdmin, onRecorded }: { memberName: string; availablePlayers: string[]; clubAdmin: boolean; onRecorded: () => void }) {
  const [mode, setMode] = useState<Mode>(clubAdmin ? "paste" : "table");
  const queryClient = useQueryClient();
  const [ai, setAi] = useState<AiStatus | null>(null);

  useEffect(() => {
    if (!clubAdmin) return;
    let cancelled = false;
    accountApi.aiStatus().then((status) => { if (!cancelled) setAi(status); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [clubAdmin]);

  // A night's host who isn't an admin can still pay out the jackpot.
  const role = useQuery({ queryKey: ["live-session-role"], queryFn: () => accountApi.liveSessionRole() });
  const canPay = clubAdmin || role.data?.canManage === true;

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
        <RecordNight roster={availablePlayers} ai={ai} onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["jackpot"] }); onRecorded(); }} />
      ) : (
        <LiveSessionView memberName={memberName} availablePlayers={availablePlayers} />
      )}
      <JackpotPanel players={availablePlayers} canPay={canPay} admin={clubAdmin} showWhenEmpty={clubAdmin} />
    </div>
  );
}
