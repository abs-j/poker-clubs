import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CalendarDays, ChevronRight, CircleDollarSign, History, LoaderCircle, Spade, Trophy, UserRound, type LucideIcon } from "lucide-react";
import type { MemberAuthSession } from "@/lib/member-session";
import { APP_NAME, AccountError, accountApi, extractInviteCode, type InvitePreview, type MeResponse } from "@/lib/account-api";
import { afterJoinPath, joinCarrySearch, movedFromParam, rememberMovedFrom } from "@/lib/moved-notice";

const inputClass =
  "h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:border-primary";
const primaryButton =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60";
const secondaryButton =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold hover:bg-secondary disabled:opacity-60";

function Shell({ children, eyebrow, title, intro }: { children: ReactNode; eyebrow: string; title: string; intro?: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <div className="flex flex-1 items-center justify-center px-5 py-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3">
            <div className="brand-mark flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_3px_0_hsl(262_80%_40%)]">
              <Spade className="h-5 w-5" />
            </div>
            <p className="text-lg font-semibold tracking-tight">{APP_NAME}</p>
          </div>
          <div className="soft-shadow rounded-2xl border border-border bg-card p-6 sm:p-8">
            <p className="section-label text-primary">{eyebrow}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
            {intro && <div className="mt-2 text-sm leading-6 text-muted-foreground">{intro}</div>}
            <div className="mt-6">{children}</div>
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            <a href="/terms" className="inline-block px-2 py-3 hover:text-primary hover:underline">Terms</a> · <a href="/privacy" className="inline-block px-2 py-3 hover:text-primary hover:underline">Privacy</a>
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorLine({ message, testId }: { message: string; testId?: string }) {
  if (!message) return null;
  return (
    <p role="alert" data-testid={testId} className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </p>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-4 block first:mt-0">
      <span className="mb-2 block text-xs font-semibold">{label}</span>
      {children}
    </label>
  );
}

function Busy({ busy, children }: { busy: boolean; children: ReactNode }) {
  return busy ? (
    <>
      <LoaderCircle className="h-4 w-4 animate-spin" />
      Working…
    </>
  ) : (
    <>
      {children}
      <ChevronRight className="h-4 w-4" />
    </>
  );
}

/** Sign in or create an account. Calls onDone once the browser holds a session. */
export function AccountForm({
  googleSignIn,
  emailEnabled = false,
  callbackURL,
  onDone,
  defaultMode = "signin",
  headline,
}: {
  googleSignIn: boolean;
  /** Whether the server can send email, which is what makes "forgot your password" possible. */
  emailEnabled?: boolean;
  callbackURL: string;
  onDone: () => void;
  defaultMode?: "signin" | "signup";
  headline?: string;
}) {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">(defaultMode);
  const [resetSent, setResetSent] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "forgot") {
        await accountApi.requestPasswordReset(email.trim());
        setResetSent(true);
        return;
      }
      if (mode === "signup") await accountApi.signUp({ name: name.trim(), email: email.trim(), password });
      else await accountApi.signIn({ email: email.trim(), password });
      onDone();
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "forgot") {
    return (
      <form onSubmit={(event) => void submit(event)} data-testid="form-forgot">
        <p className="text-sm font-semibold">Reset your password</p>
        {resetSent ? (
          <p data-testid="status-reset-sent" className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-3 text-sm leading-6">
            If there&apos;s an account for <strong>{email}</strong>, a link to choose a new password is on its way. It works for an hour.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">Enter your email and we&apos;ll send you a link.</p>
            <div className="mt-3">
              <Field label="Email">
                <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required data-testid="input-forgot-email" />
              </Field>
            </div>
            <ErrorLine message={error} testId="status-forgot-error" />
            <button type="submit" disabled={busy || !email.trim()} className={`${primaryButton} mt-4`} data-testid="button-forgot-submit">
              <Busy busy={busy}>Send reset link</Busy>
            </button>
          </>
        )}
        <button type="button" onClick={() => { setMode("signin"); setResetSent(false); setError(""); }} className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-primary hover:underline" data-testid="button-back-to-signin">
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} data-testid="form-account">
      {headline && <p className="mb-4 text-sm font-semibold">{headline}</p>}
      <div role="tablist" className="mb-5 grid grid-cols-2 rounded-xl bg-secondary/60 p-1 text-sm font-semibold">
        {(["signin", "signup"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            data-testid={`tab-${value}`}
            onClick={() => {
              setMode(value);
              setError("");
            }}
            className={`h-9 rounded-lg ${mode === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            {value === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {mode === "signup" && (
        <Field label="Your name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required data-testid="input-name" />
        </Field>
      )}
      <Field label="Email">
        <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required data-testid="input-email" />
      </Field>
      <Field label="Password">
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={8}
          required
          data-testid="input-password"
        />
      </Field>
      {mode === "signup" && <p className="mt-2 text-xs text-muted-foreground">At least 8 characters.</p>}
      {mode === "signup" && (
        <label className="mt-4 flex items-start gap-2 text-xs leading-5" data-testid="label-terms">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" data-testid="checkbox-terms" />
          <span>
            I&apos;m 18 or over and agree to the <a href="/terms" target="_blank" rel="noreferrer" className="text-primary underline">Terms</a> and{" "}
            <a href="/privacy" target="_blank" rel="noreferrer" className="text-primary underline">Privacy Policy</a>.
          </span>
        </label>
      )}
      {mode === "signin" && emailEnabled && (
        <button type="button" onClick={() => { setMode("forgot"); setError(""); }} className="mt-1 inline-flex min-h-[44px] items-center text-xs text-muted-foreground hover:text-primary hover:underline" data-testid="button-forgot">
          Forgot your password?
        </button>
      )}
      <ErrorLine message={error} testId="status-account-error" />

      <button type="submit" disabled={busy || (mode === "signup" && !agreed)} className={`${primaryButton} mt-5`} data-testid="button-account-submit">
        <Busy busy={busy}>{mode === "signup" ? "Create account" : "Sign in"}</Busy>
      </button>
      {googleSignIn && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void accountApi.google(callbackURL).catch((e: AccountError) => setError(e.message))}
          className={`${secondaryButton} mt-3`}
          data-testid="button-google"
        >
          Continue with Google
        </button>
      )}
      {googleSignIn && (
        <p className="mt-3 text-center text-[11px] leading-4 text-muted-foreground">
          By continuing with Google you confirm you&apos;re 18 or over and agree to the <a href="/terms" className="underline">Terms</a> and <a href="/privacy" className="underline">Privacy Policy</a>.
        </p>
      )}
    </form>
  );
}

/** Signed in, no club yet: start one or join one. */
function Onboarding({ user, onDone }: { user: { name: string }; onDone: () => void }) {
  const [view, setView] = useState<"choose" | "create" | "join">("choose");
  const [clubName, setClubName] = useState("");
  const [playerName, setPlayerName] = useState(user.name);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await accountApi.createClub({ name: clubName, playerName });
      onDone();
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Couldn't create the club.");
    } finally {
      setBusy(false);
    }
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    const clean = extractInviteCode(code);
    if (clean.length < 6) {
      setError("Paste the invite link or enter the code you were sent.");
      return;
    }
    window.location.assign(`/join/${clean}`);
  };

  if (view === "create") {
    return (
      <Shell eyebrow="New club" title="Start your club" intro="You'll be the owner. Invite people with a link when you're ready.">
        <form onSubmit={(event) => void create(event)} data-testid="form-create-club">
          <Field label="Club name">
            <input className={inputClass} value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder="Friday Night Poker" required data-testid="input-club-name" />
          </Field>
          <Field label="The name you play under">
            <input className={inputClass} value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={40} required data-testid="input-player-name" />
          </Field>
          <ErrorLine message={error} testId="status-create-error" />
          <button type="submit" disabled={busy || clubName.trim().length < 2} className={`${primaryButton} mt-5`} data-testid="button-create-club">
            <Busy busy={busy}>Create club</Busy>
          </button>
          <button type="button" onClick={() => setView("choose")} className={`${secondaryButton} mt-3`}>
            Back
          </button>
        </form>
      </Shell>
    );
  }

  if (view === "join") {
    return (
      <Shell eyebrow="Join a club" title="Enter your invite" intro="Paste the link a club sent you, or type its code.">
        <form onSubmit={join} data-testid="form-join-code">
          <Field label="Invite link or code">
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} data-testid="input-invite-code" />
          </Field>
          <ErrorLine message={error} />
          <button type="submit" className={`${primaryButton} mt-5`} data-testid="button-join-code">
            Continue
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setView("choose")} className={`${secondaryButton} mt-3`}>
            Back
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Welcome" title={`Hi ${user.name.split(" ")[0] || "there"}`} intro="You're in. Now pick a club.">
      <div className="space-y-3">
        <button type="button" onClick={() => setView("create")} className={primaryButton} data-testid="button-start-club">
          Start a club
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setView("join")} className={secondaryButton} data-testid="button-have-invite">
          I have an invite
        </button>
      </div>
      <button
        type="button"
        onClick={() => void accountApi.signOut().then(onDone)}
        className="mt-3 min-h-[44px] w-full text-center text-xs text-muted-foreground hover:text-primary hover:underline"
      >
        Sign out
      </button>
    </Shell>
  );
}

/** The member sign-in screen: account first, then a club. Hands back the session once both exist. */
const FEATURES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: CircleDollarSign, title: "Record game night", body: "Paste your notes or log buy-ins and cash-outs at the table, check the night balances, then settle up at the end." },
  { icon: Trophy, title: "Leaderboards that mean something", body: "All-time profit and monthly club points, with podiums, badges and a season to chase every month." },
  { icon: UserRound, title: "Your own numbers", body: "Your net, form and best game, and how you have done against each player in the games you both played." },
  { icon: CalendarDays, title: "Tournaments too", body: "Record buy-ins, finishing places and prizes, and let them count towards club points." },
  { icon: History, title: "Bring your history", body: "Import past results from a spreadsheet, and download your club's results whenever you like." },
];

const STEPS = [
  ["Start a club", "Create an account and name your club. You are the owner."],
  ["Invite your group", "Share a link or QR code. Everyone picks their name and joins."],
  ["Run a night", "Record it live, close it, and the standings update for everyone."],
];

/** The signed-out front page: what the site is, then the sign-in form. The form stays near the top on a phone. */
function Landing({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground" data-testid="page-landing">
      <div className="mx-auto grid max-w-5xl gap-x-12 gap-y-8 px-5 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:py-14">
        <div className="lg:col-start-1 lg:row-start-1">
          <div className="flex items-center gap-3">
            <div className="brand-mark flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_3px_0_hsl(262_80%_40%)]">
              <Spade className="h-5 w-5" />
            </div>
            <p className="text-lg font-semibold tracking-tight">{APP_NAME}</p>
          </div>
          <p className="section-label mt-8 text-primary lg:mt-14">For uni clubs and friend groups</p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Your poker night, recorded and ranked.</h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">
            Track buy-ins, cash-outs, leaderboards and monthly club points for your group. Free, and invite-only.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href="/demo/" data-testid="link-try-demo" className="inline-flex h-11 items-center rounded-xl border border-primary/40 bg-primary/10 px-4 text-sm font-semibold text-primary hover:bg-primary/15">
              Try the demo
            </a>
            <a href="/demo/?tour=built" data-testid="link-how-built" className="text-sm font-semibold text-muted-foreground hover:text-primary hover:underline">
              How it&apos;s built
            </a>
          </div>
        </div>

        <div className="soft-shadow rounded-2xl border border-border bg-card p-6 sm:p-8 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <p className="section-label text-primary">Get started</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">Sign in or create an account</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Then start a club, or join one with an invite link.</p>
          <div className="mt-6">{children}</div>
        </div>

        <div className="lg:col-start-1 lg:row-start-2">
          <ul data-testid="list-landing-features" className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl border border-border bg-card p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="mt-3 text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
          <ol data-testid="list-landing-steps" className="mt-8 space-y-3">
            {STEPS.map(([title, body], index) => (
              <li key={title} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{index + 1}</span>
                <span className="text-sm leading-6"><strong className="font-semibold">{title}.</strong> <span className="text-muted-foreground">{body}</span></span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="pb-8 text-center text-[11px] text-muted-foreground">
        <a href="/terms" className="inline-block px-2 py-3 hover:text-primary hover:underline">Terms</a> · <a href="/privacy" className="inline-block px-2 py-3 hover:text-primary hover:underline">Privacy</a>
      </p>
    </div>
  );
}

export function WelcomeFlow({ onAuthenticated }: { onAuthenticated: (session: MemberAuthSession) => void }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setMe(await accountApi.me());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // An account with a club is signed in as far as the dashboard is concerned.
  useEffect(() => {
    if (!me?.user || me.clubs.length === 0) return;
    void fetch("/api/auth/member/session", { credentials: "include", cache: "no-store" })
      .then((response) => response.json() as Promise<MemberAuthSession>)
      .then((session) => {
        if (session.authenticated) onAuthenticated(session);
      })
      .catch(() => setFailed(true));
  }, [me, onAuthenticated]);

  if (failed) {
    return (
      <Shell eyebrow="Offline" title="Can't reach the server" intro="Check your connection and try again.">
        <button type="button" onClick={() => void load()} className={primaryButton}>
          Try again
        </button>
      </Shell>
    );
  }
  if (!me) return <Shell eyebrow={APP_NAME} title="Loading…">{null}</Shell>;
  if (me.user && me.clubs.length === 0) return <Onboarding user={me.user} onDone={() => void load()} />;
  if (me.user) return <Shell eyebrow={APP_NAME} title="Opening your club…">{null}</Shell>;

  return (
    <Landing>
      <AccountForm googleSignIn={me.options.googleSignIn} emailEnabled={me.options.email} callbackURL="/dashboard" onDone={() => void load()} />
    </Landing>
  );
}

/** /join/:code. Shows the club, signs the person in if needed, and lets them pick or claim their name. */
export function JoinPage({ code: rawCode }: { code: string }) {
  const code = extractInviteCode(rawCode);
  const carry = joinCarrySearch(window.location.search);
  const destination = afterJoinPath(carry);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [choice, setChoice] = useState<number | "new" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const next = await accountApi.me();
      setMe(next);
      setName((current) => current || next.user?.name || "");
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void accountApi
      .previewInvite(code)
      .then(setPreview)
      .catch((caught: AccountError) => setPreviewError(caught.message));
    void loadMe();
  }, [code, loadMe]);

  // Arrived from a club's old website: remember it so Home can say where the club lives now.
  useEffect(() => {
    const from = movedFromParam(window.location.search);
    if (from) rememberMovedFrom(from);
  }, []);

  // With no names to claim, the only choice is a new one.
  useEffect(() => {
    if (preview && preview.claimable.length === 0) setChoice((current) => current ?? "new");
  }, [preview]);

  // Already in this club: just take them there.
  useEffect(() => {
    if (!preview || !me?.user) return;
    const mine = me.clubs.find((club) => club.slug === preview.club.slug);
    if (mine) void accountApi.switchClub(mine.slug).then(() => window.location.replace(destination));
  }, [preview, me, destination]);

  if (previewError) {
    return (
      <Shell eyebrow="Invite" title="This invite isn't working" intro={previewError}>
        <a href="/" className={secondaryButton}>
          Go to {APP_NAME}
        </a>
      </Shell>
    );
  }
  if (!preview || !me) return <Shell eyebrow="Invite" title="Checking your invite…">{null}</Shell>;

  const title = `Join ${preview.club.name}`;
  if (!me.user) {
    return (
      <Shell eyebrow="You're invited" title={title} intro="Create an account or sign in, then pick your name.">
        <AccountForm
          googleSignIn={me.options.googleSignIn}
          emailEnabled={me.options.email}
          callbackURL={`/join/${code}${carry}`}
          defaultMode="signup"
          onDone={() => void loadMe()}
        />
      </Shell>
    );
  }

  const claiming = typeof choice === "number";
  const ready = claiming || (choice === "new" && name.trim().length > 0);
  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await accountApi.acceptInvite(code, claiming ? { claimPlayerId: choice as number } : { name: name.trim() });
      window.location.replace(destination);
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Couldn't join the club.");
      setBusy(false);
    }
  };

  return (
    <Shell eyebrow="You're invited" title={title} intro={`Signed in as ${me.user.email}. Which player are you?`}>
      <div className="space-y-2" data-testid="list-claimable">
        {preview.claimable.map((player) => (
          <label key={player.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${choice === player.id ? "border-primary bg-primary/5" : "border-border"}`}>
            <input type="radio" name="player" checked={choice === player.id} onChange={() => setChoice(player.id)} />
            <span className="font-semibold">{player.displayName}</span>
            <span className="text-xs text-muted-foreground">that&apos;s me</span>
          </label>
        ))}
        <label className={`block cursor-pointer rounded-xl border p-3 text-sm ${choice === "new" ? "border-primary bg-primary/5" : "border-border"}`}>
          <span className="flex items-center gap-3">
            <input type="radio" name="player" checked={choice === "new"} onChange={() => setChoice("new")} data-testid="radio-new-player" />
            <span className="font-semibold">{preview.claimable.length > 0 ? "I'm new here" : "Choose your player name"}</span>
          </span>
          {choice === "new" && (
            <input className={`${inputClass} mt-3`} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name on the leaderboard" data-testid="input-new-name" />
          )}
        </label>
      </div>
      <ErrorLine message={error} testId="status-join-error" />
      <button type="button" disabled={!ready || busy} onClick={() => void accept()} className={`${primaryButton} mt-5`} data-testid="button-accept-invite">
        <Busy busy={busy}>Join {preview.club.name}</Busy>
      </button>
    </Shell>
  );
}

/** /reset-password?token=…  The page the emailed link lands on. */
export function ResetPasswordPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";
  const linkError = params.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token || linkError) {
    return (
      <Shell eyebrow="Password" title="This link isn't working" intro="Reset links work once, for an hour. Ask for a new one.">
        <a href="/" className={secondaryButton} data-testid="link-reset-expired">
          Back to sign in
        </a>
      </Shell>
    );
  }
  if (done) {
    return (
      <Shell eyebrow="Password" title="Password changed" intro="You've been signed out everywhere else. Sign in with your new password.">
        <a href="/" className={primaryButton} data-testid="link-reset-done">
          Sign in
          <ChevronRight className="h-4 w-4" />
        </a>
      </Shell>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await accountApi.resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Couldn't change the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell eyebrow="Password" title="Choose a new password" intro="At least 8 characters.">
      <form onSubmit={(event) => void submit(event)} data-testid="form-reset">
        <Field label="New password">
          <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required data-testid="input-reset-password" />
        </Field>
        <Field label="Type it again">
          <input className={inputClass} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required data-testid="input-reset-confirm" />
        </Field>
        <ErrorLine message={error} testId="status-reset-error" />
        <button type="submit" disabled={busy} className={`${primaryButton} mt-5`} data-testid="button-reset-submit">
          <Busy busy={busy}>Change password</Busy>
        </button>
      </form>
    </Shell>
  );
}
