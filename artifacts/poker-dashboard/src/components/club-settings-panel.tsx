import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { pointsExamples } from "@/lib/points";
import { useClubSettings, type PresetChoice } from "@/components/club-settings-context";

const input = "h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const primary =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60";

const CURRENCIES = ["AUD", "NZD", "USD", "CAD", "GBP", "EUR", "SGD", "HKD", "INR", "JPY", "CNY", "MYR", "ZAR"];

function timezoneOptions(current: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return all.includes(current) ? all : [current, ...all];
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold">{label}</span>
      {children}
    </label>
  );
}

/** Name, money, timezone, club rules and how club points are scored. For club admins. */
export function ClubSettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const { settings, presets, save } = useClubSettings();
  const [name, setName] = useState(settings.name);
  const [currency, setCurrency] = useState(settings.currency);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [guidelines, setGuidelines] = useState(settings.guidelines ?? "");
  const [preset, setPreset] = useState<PresetChoice>(settings.points.preset);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const zones = useMemo(() => timezoneOptions(settings.timezone), [settings.timezone]);
  const currencies = CURRENCIES.includes(settings.currency) ? CURRENCIES : [settings.currency, ...CURRENCIES];
  const activeRules = presets.find((item) => item.id === preset)?.rules ?? settings.points.rules;
  const examples = useMemo(() => pointsExamples(activeRules), [activeRules]);

  const submit = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await save({
        name,
        currency,
        timezone,
        guidelines,
        // A club that already had custom numbers keeps them until it picks a preset.
        ...(preset === "custom" ? {} : { points: { preset } }),
      });
      setSaved(true);
      // Names, money and times are used all over the site, so start fresh with the new settings.
      window.setTimeout(() => window.location.reload(), 700);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save the settings.");
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? "" : "soft-shadow mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6"} data-testid="panel-club-settings">
      {!embedded && (
        <>
          <p className="section-label text-primary">Settings</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Club settings</h2>
        </>
      )}

      <div className={embedded ? "" : "mt-4"}>
        <Labeled label="Club name">
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-testid="input-setting-name" />
        </Labeled>
      </div>

      <details className="group mt-4" data-testid="section-advanced-settings">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>Advanced: currency and timezone</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-4 sm:grid-cols-2">
        <Labeled label="Currency">
          <select className={input} value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="select-setting-currency">
            {currencies.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Timezone (decides which date “tonight” is)">
          <select className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)} data-testid="select-setting-timezone">
            {zones.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
        </Labeled>
        </div>
      </details>

      <div className="mt-6">
        <Labeled label="Club rules">
          <textarea
            className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
            rows={6}
            value={guidelines}
            maxLength={8000}
            onChange={(e) => setGuidelines(e.target.value)}
            placeholder={"# Buy-ins\nFixed buy-in of $10, rebuys allowed until 9pm.\n\n- Phones away at the table\n- Settle up before you leave"}
            data-testid="input-setting-guidelines"
          />
        </Labeled>
        <p className="mt-1 text-[11px] text-muted-foreground">Plain text. Start a line with “# ” for a heading or “- ” for a bullet. Blank lines separate paragraphs.</p>
      </div>

      <div className="mt-6" data-testid="section-points-rules">
        <p className="text-sm font-semibold">How club points are scored</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[...presets.map((item) => ({ id: item.id as PresetChoice, label: item.label, description: item.description })), ...(settings.points.preset === "custom" ? [{ id: "custom" as PresetChoice, label: "Custom (current)", description: "The numbers set earlier. Pick a preset to replace them." }] : [])].map((option) => (
            <label key={option.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${preset === option.id ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="radio" name="points-preset" checked={preset === option.id} onChange={() => setPreset(option.id)} data-testid={`radio-points-${option.id}`} className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-border p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">What this scores</p>
          <ul className="mt-2 divide-y divide-border/70 text-sm">
            {examples.map((example) => (
              <li key={example.label} className="flex items-center justify-between gap-3 py-1.5">
                <span>{example.label}</span>
                <span className="font-mono font-semibold">{example.points}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {error && (
        <p role="alert" data-testid="status-settings-error" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}
      <div className="mt-5 flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void submit()} className={primary} data-testid="button-save-settings">
          {busy ? "Saving…" : "Save settings"}
        </button>
        {saved && <span data-testid="status-settings-saved" className="text-xs font-semibold">Saved.</span>}
      </div>
    </div>
  );
}
