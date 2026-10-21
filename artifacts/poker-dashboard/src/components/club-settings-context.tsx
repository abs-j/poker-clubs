import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { setClubFormat } from "@/lib/club-format";
import { POINTS_RULES, type PointsRules } from "@/lib/points";

export type PresetChoice = "standard" | "social" | "competitive" | "custom";

export type ClubSettings = {
  id: number;
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  hashtag: string | null;
  guidelines: string | null;
  isOriginal: boolean;
  points: { preset: PresetChoice; rules: PointsRules };
};
export type PresetInfo = { id: Exclude<PresetChoice, "custom">; label: string; description: string; rules: PointsRules };

const FALLBACK: ClubSettings = {
  id: 0,
  slug: "",
  name: "Poker Club",
  currency: "AUD",
  timezone: "Australia/Melbourne",
  hashtag: null,
  guidelines: null,
  isOriginal: false,
  points: { preset: "standard", rules: POINTS_RULES },
};

type Value = { settings: ClubSettings; presets: PresetInfo[]; loaded: boolean; save: (patch: Record<string, unknown>) => Promise<void> };
const Context = createContext<Value>({ settings: FALLBACK, presets: [], loaded: false, save: async () => undefined });

export const useClubSettings = () => useContext(Context);

/** Loads the club's settings once and applies its name, currency and timezone everywhere. */
export function ClubSettingsProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [state, setState] = useState<{ settings: ClubSettings; presets: PresetInfo[] } | null>(null);

  const apply = useCallback((settings: ClubSettings, presets: PresetInfo[]) => {
    setClubFormat({ name: settings.name, hashtag: settings.hashtag, currency: settings.currency, timeZone: settings.timezone });
    if (typeof document !== "undefined") document.title = settings.name;
    setState({ settings, presets });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/clubs/current/settings", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { settings: ClubSettings; presets: PresetInfo[] };
      })
      .then((body) => !cancelled && apply(body.settings, body.presets))
      // If the settings can't be read the site still works with sensible defaults.
      .catch(() => !cancelled && apply(FALLBACK, []));
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const save = useCallback(async (patch: Record<string, unknown>) => {
    const response = await fetch("/api/clubs/current/settings", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; settings?: ClubSettings; presets?: PresetInfo[] };
    if (!response.ok || !body.settings) throw new Error(body.error ?? "Couldn't save the settings.");
    apply(body.settings, body.presets ?? []);
  }, [apply]);

  if (!state) return <>{fallback}</>;
  return <Context.Provider value={{ ...state, loaded: true, save }}>{children}</Context.Provider>;
}
