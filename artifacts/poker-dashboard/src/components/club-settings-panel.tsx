import { useMemo, useState, type ReactNode } from "react";
import { pointsExamples, type PointsRules } from "@/lib/points";
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

type Field = { label: string; path: string[]; step?: number };
const RULE_FIELDS: Field[] = [
  { label: "Turn-up points (cash night)", path: ["turnUp", "cash"] },
  { label: "Turn-up points (tournament)", path: ["turnUp", "tournament"] },
  { label: "Top placement points", path: ["placementMax"] },
  { label: "Win bonus", path: ["win", "flat"] },
  { label: "Win bonus per player", path: ["win", "perPlayer"], step: 0.5 },
  { label: "Players needed for a win bonus", path: ["win", "minPlayers"] },
  { label: "Second place bonus", path: ["podium", "second"] },
  { label: "Third place bonus", path: ["podium", "third"] },
  { label: "Players needed for podium bonuses", path: ["podium", "minPlayers"] },
  { label: "In-profit bonus", path: ["inProfit"] },
  { label: "Points per knockout", path: ["perKnockout"] },
  { label: "Players needed for a night to count", path: ["minPlayersToCount"] },
  { label: "Nights before a player is no longer provisional", path: ["provisionalBelowNights"] },
];

const read = (rules: PointsRules, path: string[]): number =>
  path.reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], rules) as number;

function withValue(rules: PointsRules, path: string[], value: number): PointsRules {
  const next = JSON.parse(JSON.stringify(rules)) as PointsRules;
  let target = next as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[path[path.length - 1]] = value;
  return next;
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
export function ClubSettingsPanel() {
  const { settings, presets, save } = useClubSettings();
  const [name, setName] = useState(settings.name);
  const [hashtag, setHashtag] = useState(settings.hashtag ?? "");
  const [currency, setCurrency] = useState(settings.currency);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [guidelines, setGuidelines] = useState(settings.guidelines ?? "");
  const [preset, setPreset] = useState<PresetChoice>(settings.points.preset);
  const [custom, setCustom] = useState<PointsRules>(settings.points.rules);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const zones = useMemo(() => timezoneOptions(settings.timezone), [settings.timezone]);
  const currencies = CURRENCIES.includes(settings.currency) ? CURRENCIES : [settings.currency, ...CURRENCIES];
  const activeRules = preset === "custom" ? custom : (presets.find((item) => item.id === preset)?.rules ?? settings.points.rules);
  const examples = useMemo(() => pointsExamples(activeRules), [activeRules]);

  const submit = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await save({
        name,
        hashtag,
        currency,
        timezone,
        guidelines,
        points: preset === "custom" ? { preset, rules: custom } : { preset },
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
    <div className="soft-shadow mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="panel-club-settings">
      <p className="section-label text-primary">Settings</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">Club settings</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Labeled label="Club name">
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-testid="input-setting-name" />
        </Labeled>
        <Labeled label="Hashtag for shared recaps">
          <span className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">#</span>
            <input className={input} value={hashtag} onChange={(e) => setHashtag(e.target.value.replace(/^#+/, ""))} maxLength={40} placeholder="fridaynightpoker" data-testid="input-setting-hashtag" />
          </span>
        </Labeled>
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
          {[...presets.map((item) => ({ id: item.id as PresetChoice, label: item.label, description: item.description })), { id: "custom" as PresetChoice, label: "Custom", description: "Set every number yourself." }].map((option) => (
            <label key={option.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${preset === option.id ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="radio" name="points-preset" checked={preset === option.id} onChange={() => { setPreset(option.id); if (option.id === "custom") setCustom(activeRules); }} data-testid={`radio-points-${option.id}`} className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </div>

        {preset === "custom" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="grid-custom-rules">
            {RULE_FIELDS.map((field) => (
              <Labeled key={field.path.join(".")} label={field.label}>
                <input
                  className={input}
                  type="number"
                  inputMode="decimal"
                  step={field.step ?? 1}
                  value={read(custom, field.path)}
                  onChange={(e) => setCustom(withValue(custom, field.path, Number(e.target.value)))}
                  data-testid={`rule-${field.path.join("-")}`}
                />
              </Labeled>
            ))}
          </div>
        )}

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
