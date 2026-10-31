import { useState, type FormEvent } from "react";
import { AccountError, accountApi, type AccountUser } from "@/lib/account-api";

const input = "h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const button =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-4 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const danger =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-destructive px-4 text-xs font-semibold text-destructive-foreground disabled:opacity-60";

const describe = (error: unknown) => (error instanceof AccountError ? error.message : "Something went wrong. Try again.");

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "ok" | "error"; text: string }>({ kind: "idle", text: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setState({ kind: "idle", text: "" });
    try {
      await accountApi.changePassword(current, next);
      setCurrent("");
      setNext("");
      setState({ kind: "ok", text: "Password changed. Other devices have been signed out." });
    } catch (caught) {
      setState({ kind: "error", text: describe(caught) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} data-testid="form-change-password">
      <p className="text-sm font-semibold">Change password</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input className={input} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" required data-testid="input-current-password" />
        <input className={input} type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+ characters)" autoComplete="new-password" minLength={8} required data-testid="input-new-password" />
      </div>
      <button type="submit" disabled={busy} className={`${button} mt-2`} data-testid="button-change-password">Change password</button>
      {state.text && (
        <p role={state.kind === "error" ? "alert" : "status"} data-testid="status-change-password" className={`mt-2 text-xs ${state.kind === "error" ? "text-destructive" : "font-semibold"}`}>{state.text}</p>
      )}
    </form>
  );
}

function DeleteAccount({ user }: { user: AccountUser }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!window.confirm("Delete your account? This can't be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await accountApi.deleteAccount(user.hasPassword ? { password: secret } : { confirmEmail: secret });
      window.location.assign("/");
    } catch (caught) {
      setError(describe(caught));
      setBusy(false);
    }
  };
  return (
    <div data-testid="section-delete-account">
      <p className="text-sm font-semibold">Delete my account</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Removes your login and email. Results you recorded stay in your clubs under your player name, no longer linked to you.
      </p>
      {!open ? (
        <button type="button" className={`${button} mt-2`} onClick={() => setOpen(true)} data-testid="button-delete-account-open">Delete my account…</button>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="mt-2 flex flex-wrap gap-2">
          <input
            className={`${input} flex-1`}
            type={user.hasPassword ? "password" : "email"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={user.hasPassword ? "Your password" : "Type your email to confirm"}
            autoComplete={user.hasPassword ? "current-password" : "off"}
            required
            data-testid="input-delete-account-secret"
          />
          <button type="submit" disabled={busy || !secret} className={danger} data-testid="button-delete-account">Delete for good</button>
          {error && <p role="alert" data-testid="status-delete-account" className="w-full text-xs text-destructive">{error}</p>}
        </form>
      )}
    </div>
  );
}

/** Password change, or account deletion behind a confirmation. */
export function AccountSecurity({ user, part }: { user: AccountUser; part: "password" | "danger" }) {
  if (part === "password") {
    if (!user.hasPassword) return null;
    return (
      <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="panel-account-security">
        <p className="section-label text-primary">Account</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">{user.email}</h2>
        <div className="mt-4">
          <ChangePassword />
        </div>
      </div>
    );
  }
  return (
    <div className="soft-shadow rounded-2xl border border-destructive/30 bg-card p-5 sm:p-6" data-testid="section-account-danger">
      <p className="section-label text-destructive">Danger</p>
      <div className="mt-3">
        <DeleteAccount user={user} />
      </div>
    </div>
  );
}

/** Owner-only: delete the club and everything in it. */
export function DeleteClub({ clubName }: { clubName: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await accountApi.deleteClub(typed);
      window.location.assign("/");
    } catch (caught) {
      setError(describe(caught));
      setBusy(false);
    }
  };
  return (
    <div className="mt-6 rounded-xl border border-destructive/40 p-4" data-testid="section-delete-club">
      <p className="text-sm font-semibold">Delete this club</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Permanently deletes {clubName}: every night, tournament, member and invite. There is no undo. Download your results from Club history first if you want to keep them.
      </p>
      {!open ? (
        <button type="button" className={`${button} mt-2`} onClick={() => setOpen(true)} data-testid="button-delete-club-open">Delete club…</button>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="mt-2 flex flex-wrap gap-2">
          <input className={`${input} flex-1`} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type “${clubName}” to confirm`} required data-testid="input-delete-club-name" />
          <button type="submit" disabled={busy || typed.trim() !== clubName} className={danger} data-testid="button-delete-club">Delete the club</button>
          {error && <p role="alert" data-testid="status-delete-club" className="w-full text-xs text-destructive">{error}</p>}
        </form>
      )}
    </div>
  );
}
