import { useEffect, useState } from "react";
import { AccountError, accountApi, type AiStatus } from "@/lib/account-api";

const input = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

/** Admin: the club's own OpenRouter key and model for reading pasted notes and photos. The key is never shown again. */
export function AiReaderSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    accountApi.aiStatus().then((next) => { setStatus(next); setModel(next.model); }).catch(() => undefined);
  }, []);

  const save = async (input: { model?: string; apiKey?: string; clearKey?: boolean }, done: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await accountApi.saveAi(input);
      setStatus(next);
      setModel(next.model);
      setApiKey("");
      setMessage(done);
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  return (
    <section id="ai-reader" className="mt-6 rounded-xl border border-border p-4" data-testid="section-ai-reader">
      <h3 className="text-sm font-semibold">AI notes reader (OpenRouter)</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Reads pasted notes and photos on the Record tab. Your club uses its own OpenRouter key, so any cost is billed to that account. Without a key, the plain reader still works.
      </p>
      <p className="mt-2 text-xs font-semibold" data-testid="text-ai-status">{status.keySet ? "Key saved. The AI reader is on." : "No key saved. The AI reader is off."}</p>
      <label className="mt-3 block text-[11px] font-semibold text-muted-foreground">
        Model
        <input className={`${input} mt-1 font-normal text-foreground`} value={model} onChange={(event) => setModel(event.target.value)} placeholder="vendor/model-name" data-testid="input-ai-model" />
      </label>
      <label className="mt-3 block text-[11px] font-semibold text-muted-foreground">
        {status.keySet ? "Replace the key" : "OpenRouter API key"}
        <input className={`${input} mt-1 font-normal text-foreground`} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.keySet ? "Saved, enter a new one to replace it" : "sk-or-..."} data-testid="input-ai-key" />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || (!apiKey.trim() && model === status.model)} onClick={() => void save({ model, ...(apiKey.trim() ? { apiKey } : {}) }, "Saved.")} className="h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-ai-save">Save</button>
        {status.keySet && <button type="button" disabled={busy} onClick={() => void save({ clearKey: true }, "Key removed.")} className="h-10 rounded-lg border border-border px-4 text-xs font-semibold hover:bg-secondary disabled:opacity-60" data-testid="button-ai-remove">Remove key</button>}
      </div>
      {message && <p className="mt-2 text-xs text-muted-foreground" data-testid="status-ai-message">{message}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-destructive" data-testid="status-ai-error">{error}</p>}
    </section>
  );
}
