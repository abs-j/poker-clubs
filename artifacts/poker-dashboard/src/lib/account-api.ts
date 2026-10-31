// Calls for accounts, clubs and invites. Sign-in itself is handled by the identity service
// under /api/identity; everything about clubs is under /api/clubs and /api/invites.

import type { LiveActivitySnapshot } from "@workspace/api-client-react";

export const APP_NAME = (import.meta.env.VITE_APP_NAME as string | undefined) || "Poker Clubs";

export type ClubRole = "owner" | "admin" | "member";
export type AccountUser = { id: string; name: string; email: string; emailVerified: boolean; hasPassword: boolean };
export type ClubSummary = { id: number; slug: string; name: string; role: ClubRole; playerName: string };
export type MeResponse = {
  user: AccountUser | null;
  clubs: ClubSummary[];
  active: string | null;
  options: { googleSignIn: boolean; email: boolean };
};
export type InvitePreview = {
  club: { name: string; slug: string };
  role: "member" | "admin";
  claimable: Array<{ id: number; displayName: string }>;
};
export type MemberRow = {
  playerId: number;
  name: string;
  role: ClubRole | null;
  claimed: boolean;
  email?: string | null;
  joinedAt: string | null;
};
export type MergePreview = {
  keep: string;
  merge: string;
  irreversible: true;
  nights: number;
  nightsCombined: number;
  ledgerEntries: number;
  tournaments: number;
  tournamentsCombined: number;
  settlements: number;
  settlementsMoved: number;
  settlementsCombined: number;
  settlementsCleared: number;
  jackpotPayouts: number;
  hostNights: number;
  bankNights: number;
  claim: "none" | "stays" | "moves";
  picture: "none" | "moves" | "kept";
};

export type InviteRow = {
  id: number;
  code: string;
  role: "member" | "admin";
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  usable: boolean;
  createdAt: string;
};

export type ImportPreview = {
  nights: number;
  duplicates: number;
  players: number;
  newPlayers: string[];
  firstDate: string | null;
  lastDate: string | null;
};
export type ImportSource = { text?: string; sheetUrl?: string; dateOrder: "dmy" | "mdy" };
export type NightRow = {
  id: number;
  date: string;
  source: "live" | "import" | "manual";
  players: number;
  totalBuyIn: number;
  /** Surplus from this night that went into the bad beat jackpot, in dollars. */
  jackpot: number;
};

export type TournamentRow = { id: number; date: string; title: string; players: number; entries: number };
export type TournamentDraft = {
  id: string;
  date: string;
  title: string;
  venue: string | null;
  notes: string | null;
  buyIn: number;
  topUp: number;
  bounty: number;
  startingStack: number;
  winnerKeepsBounty: boolean;
  shares: { first: number; second: number; third: number };
  players: Array<{
    name: string;
    finishPlace: number | null;
    entries: number;
    topUp: boolean;
    freeEntry: boolean;
    knockouts: number;
    payout: number | null;
  }>;
};
export type GameNightRef = { id: number; sessionNumber: number; date: string; source: "live" | "import" | "manual" };
export type GameTools = {
  admin: boolean;
  canReopen: boolean;
  reopenSessionNumber: number | null;
  nights: GameNightRef[];
};
export type TournamentFormInput = {
  date: string;
  title: string;
  buyIn: string;
  bounty: string;
  shares: { first: number; second: number; third: number };
  players: Array<{ name: string; finishPlace: number; entries: number; knockouts: number; payout?: string }>;
};

export type TournamentTabs = { logText: string; resultsText: string };
export type TournamentImportPreview = {
  preview: Array<{
    date: string;
    title: string;
    players: number;
    entries: number;
    totalCollected: number;
    winner: string | null;
    winnerPrize: number;
    alreadyRecorded: boolean;
  }>;
  warnings: string[];
};

export class AccountError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "include", ...init });
  } catch {
    throw new AccountError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!response.ok) {
    throw new AccountError(body.error ?? body.message ?? "Something went wrong. Try again.", response.status);
  }
  return body as T;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

/** The browser's timezone and a currency to match, so a new club needs no setup for either. */
export function detectedDefaults(): { timezone?: string; currency?: string } {
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    timezone = undefined;
  }
  if (!timezone) return {};
  const area = timezone.split("/")[0];
  const currency =
    timezone.startsWith("Australia/") ? "AUD"
    : timezone === "Pacific/Auckland" ? "NZD"
    : timezone === "Europe/London" ? "GBP"
    : timezone === "Asia/Singapore" ? "SGD"
    : timezone === "Asia/Kolkata" || timezone === "Asia/Calcutta" ? "INR"
    : /^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns)$/.test(timezone) ? "CAD"
    : area === "America" ? "USD"
    : area === "Europe" ? "EUR"
    : undefined;
  return currency ? { timezone, currency } : { timezone };
}

export type BalanceChoice = { mode: "jackpot" } | { mode: "player"; name: string } | { mode: "split" } | { mode: "none" };

export type JackpotPayout = {
  id: number;
  name: string;
  /** Dollars paid to this player. */
  amount: number;
  at: string;
  by: string;
};
export type JackpotSummary = {
  /** Dollars still in the pot. */
  total: number;
  nights: number;
  payouts: JackpotPayout[];
};

export type LiveSessionRole = {
  hostName: string | null;
  bankName: string | null;
  canManage: boolean;
  status: "open" | "ended" | "none";
  /** The recorded night of the latest closed session, once it exists. */
  nightId: number | null;
};

export type SettleLine = {
  playerId: number;
  name: string;
  /** Cash-out minus buy-in, in cents. Negative means the player pays in. */
  netCents: number;
  settled: boolean;
  settledAt: string | null;
  settledBy: string | null;
};
export type SettleState = "none" | "open" | "partial" | "settled";
export type NightSettlement = {
  nightId: number;
  date: string;
  hostName: string;
  bankName: string | null;
  canSettle: boolean;
  state: SettleState;
  lines: SettleLine[];
};
export type MineSettleEntry = { nightId: number; sessionNumber: number | null; date: string; cents: number; bank: string | null };
export type SettleUpSummary = {
  mine: { owe: MineSettleEntry[]; owed: MineSettleEntry[]; oweCents: number; owedCents: number };
  nights: Array<{ nightId: number; sessionNumber: number | null; date: string; state: SettleState; unsettled: number }>;
};

export const accountApi = {
  /** Host or admin: what to do with a gap in tonight's ledger when it closes. */
  setLedgerResolution: (choice: BalanceChoice) => request<{ mode: string; direction: string; cents: number }>("/api/clubs/current/ledger/resolution", send("PUT", choice)),
  /** Who is hosting the open night, or the latest closed one, and whether the viewer can run it. */
  liveSessionRole: () => request<LiveSessionRole>("/api/poker/live-session/role", { cache: "no-store" }),
  setLiveHost: (name: string) => request<LiveSessionRole>("/api/poker/live-session/host", send("POST", { name })),
  /** Host or admin: who holds the cash for the open (or just closed) night; null clears it. */
  setLiveBank: (name: string | null) => request<LiveSessionRole>("/api/poker/live-session/bank", send("PUT", { name })),
  /** What you still owe or are owed, and how settled each night is. */
  settleUp: () => request<SettleUpSummary>("/api/clubs/current/settle-up", { cache: "no-store" }),
  nightSettlement: (nightId: number) => request<NightSettlement>(`/api/clubs/current/nights/${nightId}/settlement`, { cache: "no-store" }),
  /** Host, bank or admin: tick or untick one player, or everyone. */
  setSettled: (nightId: number, change: { name: string; settled: boolean } | { all: true; settled: boolean }) =>
    request<NightSettlement>(`/api/clubs/current/nights/${nightId}/settlement`, send("PUT", change)),
  reopenLiveSession: () => request<unknown>("/api/poker/live-session/reopen", send("POST")),
  /** What the club still holds in its bad beat jackpot, in dollars, and the payouts already made. */
  jackpot: () => request<JackpotSummary>("/api/clubs/current/jackpot", { cache: "no-store" }),
  /** Host or admin: pay some of the jackpot to a player. Amount is dollars, as typed. */
  payJackpot: (input: { name: string; amount: string }) =>
    request<JackpotSummary>("/api/clubs/current/jackpot/payouts", send("POST", input)),
  me: () => request<MeResponse>("/api/clubs/me", { cache: "no-store" }),
  signUp: (input: { name: string; email: string; password: string }) =>
    // The confirmation email's link brings the person back to the app, on this address.
    request<unknown>(
      "/api/identity/sign-up/email",
      send("POST", { ...input, callbackURL: `${window.location.origin}/dashboard`, termsAcceptedAt: new Date().toISOString() }),
    ),
  requestPasswordReset: (email: string) =>
    request<unknown>("/api/identity/request-password-reset", send("POST", { email, redirectTo: `${window.location.origin}/reset-password` })),
  resetPassword: (token: string, newPassword: string) =>
    request<unknown>("/api/identity/reset-password", send("POST", { token, newPassword })),
  resendVerification: (email: string) =>
    request<unknown>("/api/identity/send-verification-email", send("POST", { email, callbackURL: `${window.location.origin}/dashboard` })),
  signIn: (input: { email: string; password: string }) =>
    request<unknown>("/api/identity/sign-in/email", send("POST", input)),
  google: async (callbackURL: string) => {
    const result = await request<{ url?: string }>("/api/identity/sign-in/social", send("POST", { provider: "google", callbackURL }));
    if (result.url) window.location.assign(result.url);
  },
  signOut: () => request<unknown>("/api/identity/sign-out", send("POST")).catch(() => undefined),
  createClub: (input: { name: string; playerName?: string }) =>
    request<{ club: { slug: string; name: string } }>("/api/clubs", send("POST", { ...detectedDefaults(), ...input })),
  switchClub: (slug: string) => request<{ active: string }>("/api/clubs/active", send("POST", { slug })),
  previewInvite: (code: string) => request<InvitePreview>(`/api/invites/${encodeURIComponent(code)}`),
  acceptInvite: (code: string, input: { claimPlayerId?: number; name?: string }) =>
    request<{ club: { slug: string; name: string } }>(`/api/invites/${encodeURIComponent(code)}/accept`, send("POST", input)),
  members: () => request<{ members: MemberRow[] }>("/api/clubs/current/members", { cache: "no-store" }),
  /** Member invite links any member may copy. Admin-role invites are not included. */
  shareableInvites: () => request<{ invites: InviteRow[] }>("/api/clubs/current/invite", { cache: "no-store" }),
  /** Admin only: every invite, including admin-role links. */
  invites: () => request<{ invites: InviteRow[] }>("/api/clubs/current/invites", { cache: "no-store" }),
  createInvite: (input: { maxUses?: number; expiresInDays?: number } = {}) =>
    request<{ invite: { id: number; code: string } }>("/api/clubs/current/invites", send("POST", input)),
  revokeInvite: (id: number) => request<void>(`/api/clubs/current/invites/${id}`, { method: "DELETE" }),
  addPlayer: (name: string) => request<unknown>("/api/clubs/current/players", send("POST", { name })),
  previewMerge: (input: { keep: string; merge: string }) =>
    request<MergePreview>("/api/clubs/current/players/merge/preview", send("POST", input)),
  mergePlayers: (input: { keep: string; merge: string }) =>
    request<MergePreview & { merged: true }>("/api/clubs/current/players/merge", send("POST", input)),
  setRole: (playerId: number, role: "owner" | "admin" | "member") =>
    request<unknown>(`/api/clubs/current/members/${playerId}`, send("PATCH", { role })),
  removeMember: (playerId: number) => request<void>(`/api/clubs/current/members/${playerId}`, { method: "DELETE" }),
  previewImport: (source: ImportSource) =>
    request<{ preview: ImportPreview; warnings: string[]; rowsRead: number; rowsSkipped: number }>(
      "/api/clubs/current/import/preview",
      send("POST", source),
    ),
  importHistory: (source: ImportSource) =>
    request<{ batchId: string; imported: number; duplicates: number; playersAdded: number }>(
      "/api/clubs/current/import",
      send("POST", source),
    ),
  undoImport: (batchId: string) => request<{ removed: number }>(`/api/clubs/current/import/${batchId}`, { method: "DELETE" }),
  nights: () => request<{ sessions: NightRow[] }>("/api/clubs/current/sessions", { cache: "no-store" }),
  /** Edit and delete targets for Games cards, and whether this person can reopen the latest night. */
  gameTools: () => request<GameTools>("/api/clubs/current/game-tools", { cache: "no-store" }),
  updateNight: (id: number, input: { date: string; players: Array<{ name: string; buyIn: string; cashOut: string }> }) =>
    request<{ id: number; date: string; players: number }>(`/api/clubs/current/sessions/${id}`, send("PATCH", input)),
  deleteNight: (id: number) => request<void>(`/api/clubs/current/sessions/${id}`, { method: "DELETE" }),
  tournaments: () => request<{ tournaments: TournamentRow[] }>("/api/clubs/current/tournaments", { cache: "no-store" }),
  recordTournament: (input: TournamentFormInput) =>
    request<{ id: number; players: number; totalCollected: number; mainPrizePool: number; dataCheck: string }>(
      "/api/clubs/current/tournaments",
      send("POST", input),
    ),
  previewTournamentImport: (tabs: TournamentTabs) =>
    request<TournamentImportPreview>("/api/clubs/current/tournaments/import/preview", send("POST", tabs)),
  importTournaments: (tabs: TournamentTabs) =>
    request<{ imported: number; duplicates: number }>("/api/clubs/current/tournaments/import", send("POST", tabs)),
  /** Host or admin: adds a night's entries read from notes (amounts in dollars) to the open night. */
  addNotesToLedger: (players: Array<{ name: string; buyIn: string; cashOut: string }>) =>
    request<LiveActivitySnapshot>("/api/poker/live-session/notes", send("POST", { players })),
  readNotesImage: (image: { data: string; mediaType: string }) =>
    request<{ text: string }>("/api/clubs/current/sessions/notes-image", send("POST", image)),
  getTournament: (id: number) => request<TournamentDraft>(`/api/clubs/current/tournaments/${id}`, { cache: "no-store" }),
  updateTournament: (id: number, input: object) =>
    request<{ id: number; players: number; totalCollected: number; mainPrizePool: number; dataCheck: string }>(
      `/api/clubs/current/tournaments/${id}`,
      send("PATCH", input),
    ),
  deleteTournament: (id: number) => request<void>(`/api/clubs/current/tournaments/${id}`, { method: "DELETE" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<unknown>("/api/identity/change-password", send("POST", { currentPassword, newPassword, revokeOtherSessions: true })),
  deleteAccount: (input: { password?: string; confirmEmail?: string }) => request<void>("/api/account/delete", send("POST", input)),
  deleteClub: (confirmName: string) => request<void>("/api/clubs/current", send("DELETE", { confirmName })),
  claimPlayer: (playerId: number) => request<{ playerName: string | null }>("/api/clubs/current/claim", send("POST", { playerId })),
  leaveClub: () => request<void>("/api/clubs/current/membership", { method: "DELETE" }),
};

export function inviteLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

/** Accepts a pasted link or a bare code, in any case, with or without spaces and dashes. */
export function extractInviteCode(input: string): string {
  const fromLink = input.match(/\/join\/([A-Za-z0-9]+)/);
  return (fromLink?.[1] ?? input).toUpperCase().replace(/[^A-Z0-9]/g, "");
}
