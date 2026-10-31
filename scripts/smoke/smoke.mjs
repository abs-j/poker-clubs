// End-to-end smoke test for the Monash Poker dashboard.
//
// Checks the API over HTTP, then walks the main screens in a real browser on a phone-sized
// screen. It is deliberately structural ("there are podiums", "the tab bar is on screen")
// rather than exact, because the numbers come from the live club sheet and change.
//
// Run from a folder that has `puppeteer-core` installed (CI installs it in a temp folder):
//   SMOKE_BASE_URL=http://localhost:5173 SMOKE_MEMBER_CODE=... SMOKE_ADMIN_PASSWORD=... \
//   node scripts/smoke/smoke.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(`${process.cwd()}/`);
const puppeteer = require("puppeteer-core");

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const MEMBER_CODE = process.env.SMOKE_MEMBER_CODE;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const OUT = process.env.SMOKE_OUT ?? "smoke-output";
mkdirSync(OUT, { recursive: true });

if (!MEMBER_CODE || !ADMIN_PASSWORD) {
  console.error("Set SMOKE_MEMBER_CODE and SMOKE_ADMIN_PASSWORD.");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}${detail ? `  (${detail})` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ------------------------------------------------------------------ HTTP

function cookieJar() {
  const jar = new Map();
  return {
    absorb(response) {
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

async function api(path, { jar, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(jar ? { cookie: jar.header() } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  jar?.absorb(response);
  return response;
}

console.log(`Smoke test against ${BASE}`);
console.log("\nAPI");

const member = cookieJar();
const admin = cookieJar();
let dashboard;

await check("health endpoint answers", async () => {
  const response = await api("/api/healthz");
  expect(response.ok, `status ${response.status}`);
});

await check("public summary is readable without signing in", async () => {
  const response = await api("/api/poker/public-summary");
  expect(response.ok, `status ${response.status}`);
  const json = await response.json();
  expect(typeof json.totalSessions === "number", "no totalSessions");
});

await check("a wrong access code is refused", async () => {
  const response = await api("/api/auth/member/login", { method: "POST", body: { code: "definitely-wrong" } });
  expect(response.status === 401, `expected 401, got ${response.status}`);
});

await check("dashboard needs a sign-in", async () => {
  const response = await api("/api/poker/dashboard");
  expect(response.status === 401, `expected 401, got ${response.status}`);
});

await check("member can sign in", async () => {
  const response = await api("/api/auth/member/login", { jar: member, method: "POST", body: { code: MEMBER_CODE } });
  expect(response.ok, `status ${response.status}`);
  const json = await response.json();
  expect(json.authenticated === true, "not authenticated");
  return json.memberName;
});

await check("dashboard has players, nights and tournaments", async () => {
  const response = await api("/api/poker/dashboard", { jar: member });
  expect(response.ok, `status ${response.status}`);
  dashboard = await response.json();
  expect(dashboard.leaderboard.length > 0, "leaderboard is empty");
  expect(dashboard.sessions.length > 0, "no cash sessions");
  expect(Array.isArray(dashboard.tournaments), "tournaments missing from the payload");
  expect(
    !dashboard.sessions.some((s) => s.players.length > 0 && s.players.every((p) => /bad beat jackpot/i.test(p.player))),
    "a jackpot-only entry is counted as a game",
  );
  return `${dashboard.leaderboard.length} players, ${dashboard.sessions.length} nights, ${dashboard.tournaments.length} tournaments`;
});

await check("tournament results balance", async () => {
  for (const event of dashboard.tournaments) {
    const net = event.results.reduce((sum, r) => sum + r.netProfit, 0);
    expect(Math.abs(net) < 0.5, `${event.date} nets ${net.toFixed(2)}, expected about 0`);
  }
});

await check("live ledger and avatars answer", async () => {
  const live = await api("/api/poker/live-activity", { jar: member });
  expect(live.ok, `live-activity ${live.status}`);
  const avatars = await api("/api/poker/avatars", { jar: member });
  expect(avatars.ok, `avatars ${avatars.status}`);
});

await check("live ledger round trip: start, buy in, cash out, close", async () => {
  if (process.env.SMOKE_WRITE !== "1") return "skipped (set SMOKE_WRITE=1 on a throwaway database)";
  const start = await api("/api/poker/live-session/start", { jar: member, method: "POST" });
  expect(start.ok, `start ${start.status}`);
  const buy = await api("/api/poker/live-activity", { jar: member, method: "POST", body: { action: "buy_in", amount: 20, attributedPlayer: "Smoke Player" } });
  expect(buy.ok, `buy-in ${buy.status}`);
  const out = await api("/api/poker/live-activity", { jar: member, method: "POST", body: { action: "cash_out", amount: 35, attributedPlayer: "Smoke Player" } });
  expect(out.ok, `cash-out ${out.status}`);
  const snapshot = await (await api("/api/poker/live-activity", { jar: member })).json();
  expect(snapshot.sessionStatus === "open", `status ${snapshot.sessionStatus}`);
  expect(snapshot.totals.buyIns === 20 && snapshot.totals.cashOuts === 35, `totals ${JSON.stringify(snapshot.totals)}`);
  const row = snapshot.playerSummaries.find((p) => p.playerName === "Smoke Player");
  expect(row && row.buyIns === 20 && row.cashOuts === 35, "player summary missing");
  const end = await api("/api/poker/live-session/end", { jar: member, method: "POST" });
  expect(end.ok, `end ${end.status}`);
  const closed = await (await api("/api/poker/live-activity", { jar: member })).json();
  expect(closed.sessionStatus === "ended", `after end: ${closed.sessionStatus}`);
});

await check("admin can sign in and read status", async () => {
  const login = await api("/api/auth/admin/login", { jar: admin, method: "POST", body: { password: ADMIN_PASSWORD } });
  expect(login.ok, `login ${login.status}`);
  for (const path of ["/api/admin/health", "/api/admin/members", "/api/admin/audit"]) {
    const response = await api(path, { jar: admin });
    expect(response.ok, `${path} ${response.status}`);
  }
});

await check("admin endpoints refuse members", async () => {
  const response = await api("/api/admin/members", { jar: member });
  expect(response.status === 401, `expected 401, got ${response.status}`);
});

// --------------------------------------------------------------- browser

console.log("\nAccounts and clubs");

{
  const stamp = Date.now();
  const owner = cookieJar();
  const guest = cookieJar();
  const origin = { origin: BASE };
  const password = "smoke-test-pass-9";
  let inviteCode;

  await check("anyone can create an account and start a club", async () => {
    const signUp = await api("/api/identity/sign-up/email", {
      jar: owner, method: "POST", headers: origin,
      body: { name: "Smoke Owner", email: `owner-${stamp}@example.com`, password },
    });
    expect(signUp.ok, `sign-up ${signUp.status}`);
    const created = await api("/api/clubs", { jar: owner, method: "POST", body: { name: `Smoke Club ${stamp}`, playerName: "Smoke Owner" } });
    expect(created.status === 201, `create club ${created.status}`);
    const session = await (await api("/api/auth/member/session", { jar: owner })).json();
    expect(session.authenticated && session.club?.role === "owner", "owner session missing");
  });

  await check("a new club starts empty and never sees another club's history", async () => {
    const response = await api("/api/poker/dashboard", { jar: owner });
    expect(response.ok, `status ${response.status}`);
    const json = await response.json();
    expect(json.leaderboard.length === 0 && json.sessions.length === 0, "new club has someone else's data");
    expect(json.spreadsheetUrl === "", "new club exposes a spreadsheet link");
  });

  await check("a new club's ledger is separate from the original club's", async () => {
    const started = await api("/api/poker/live-session/start", { jar: owner, method: "POST" });
    expect(started.ok, `start ${started.status}`);
    const entry = await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "buy_in", amount: 10 } });
    expect(entry.ok, `entry ${entry.status}`);
    const mine = await (await api("/api/poker/live-activity", { jar: owner })).json();
    const original = await (await api("/api/poker/live-activity", { jar: member })).json();
    expect(mine.entries.length === 1, `expected 1 entry, got ${mine.entries.length}`);
    expect(!original.entries.some((e) => e.eventId === mine.entries[0].eventId), "entry leaked to the original club");
  });

  await check("an invite lets a second person join under their own name", async () => {
    const invite = await api("/api/clubs/current/invites", { jar: owner, method: "POST", body: { maxUses: 1 } });
    expect(invite.status === 201, `invite ${invite.status}`);
    inviteCode = (await invite.json()).invite.code;
    const preview = await api(`/api/invites/${inviteCode}`);
    expect(preview.ok, `preview ${preview.status}`);

    const signUp = await api("/api/identity/sign-up/email", {
      jar: guest, method: "POST", headers: origin,
      body: { name: "Smoke Guest", email: `guest-${stamp}@example.com`, password },
    });
    expect(signUp.ok, `guest sign-up ${signUp.status}`);
    const joined = await api(`/api/invites/${inviteCode}/accept`, { jar: guest, method: "POST", body: { name: "Smoke Guest" } });
    expect(joined.ok, `accept ${joined.status}`);
    const members = await (await api("/api/clubs/current/members", { jar: owner })).json();
    expect(members.members.length === 2, `expected 2 members, got ${members.members.length}`);
  });

  await check("a used-up invite stops working", async () => {
    const response = await api(`/api/invites/${inviteCode}`);
    expect(response.status === 404, `expected 404, got ${response.status}`);
  });

  await check("members cannot use admin tools; the owner can", async () => {
    const memberInvite = await api("/api/clubs/current/invites", { jar: guest, method: "POST", body: {} });
    expect(memberInvite.status === 401, `expected 401, got ${memberInvite.status}`);
    const memberVisits = await api("/api/admin/visits", { jar: guest });
    expect(memberVisits.status === 401, `expected 401, got ${memberVisits.status}`);
    const ownerVisits = await api("/api/admin/visits", { jar: owner });
    expect(ownerVisits.ok, `owner admin visits ${ownerVisits.status}`);
  });

  await check("resetting one club's ledger leaves the other club alone", async () => {
    const backup = await (await api("/api/admin/live-ledger/backup", { jar: owner })).json();
    expect(backup.counts.events === 1, `expected 1 event in the backup, got ${backup.counts.events}`);
    const reset = await api("/api/admin/live-ledger/reset", {
      jar: owner, method: "POST", body: { backupId: backup.backupId, confirmation: "RESET LIVE LEDGER" },
    });
    expect(reset.ok, `reset ${reset.status}`);
    const original = await api("/api/poker/live-activity", { jar: member });
    expect(original.ok, "original club's ledger went missing");
  });

  const history = [
    "Date,Player,Buy-in,Cash-out",
    "03/03/2026,Pat Imported,20,45",
    ",Eli,20,0",
    ",Fay,20,15",
    ",Gus,20,20",
    "10/03/2026,Pat Imported,20,10",
    ",Eli,20,40",
    ",Fay,20,0",
    ",Gus,20,10",
  ].join("\n");
  let batchId;

  await check("an admin can preview and import past results from a spreadsheet", async () => {
    const preview = await api("/api/clubs/current/import/preview", { jar: owner, method: "POST", body: { text: history } });
    expect(preview.ok, `preview ${preview.status}`);
    const shown = await preview.json();
    expect(shown.preview.nights === 2 && shown.preview.players === 4, `unexpected preview ${JSON.stringify(shown.preview)}`);
    const done = await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text: history } });
    expect(done.status === 201, `import ${done.status}`);
    const result = await done.json();
    batchId = result.batchId;
    expect(result.imported === 2, `imported ${result.imported}`);
  });

  await check("imported history drives the leaderboard, and re-importing adds nothing", async () => {
    const dashboard = await (await api("/api/poker/dashboard", { jar: owner })).json();
    // Pat: +25 on the 3rd, -10 on the 10th.
    const pat = dashboard.leaderboard.find((p) => p.name === "Pat Imported");
    expect(pat && pat.profitTotal === 15 && pat.gamesPlayed === 2, `standing ${JSON.stringify(pat)}`);
    expect(dashboard.months.some((m) => m.month === "03"), "March missing from the months");
    const again = await (await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text: history } })).json();
    expect(again.imported === 0 && again.duplicates === 2, `second import ${JSON.stringify(again)}`);
  });

  await check("a member can claim their name in the imported history", async () => {
    const roster = await (await api("/api/clubs/current/members", { jar: owner })).json();
    const target = roster.members.find((m) => m.name === "Pat Imported");
    expect(target && !target.claimed, "imported name should be unclaimed");
    const claim = await api("/api/clubs/current/claim", { jar: owner, method: "POST", body: { playerId: target.playerId } });
    expect(claim.ok, `claim ${claim.status}`);
    const session = await (await api("/api/auth/member/session", { jar: owner })).json();
    expect(session.memberName === "Pat Imported", `session name ${session.memberName}`);
    const again = await api("/api/clubs/current/claim", { jar: guest, method: "POST", body: { playerId: target.playerId } });
    expect(again.status === 409, `second claim should be refused, got ${again.status}`);
  });

  await check("closing a live night adds it to the leaderboard", async () => {
    await api("/api/poker/live-session/start", { jar: owner, method: "POST" });
    const entries = [
      ["buy_in", 10, undefined], ["cash_out", 14, undefined],
      ["buy_in", 10, "Smoke Guest"], ["cash_out", 6, "Smoke Guest"],
    ];
    for (const [action, amount, attributedPlayer] of entries) {
      const response = await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action, amount, attributedPlayer } });
      expect(response.ok, `entry ${response.status}`);
    }
    const end = await api("/api/poker/live-session/end", { jar: owner, method: "POST" });
    expect(end.ok, `end ${end.status}`);
    const dashboard = await (await api("/api/poker/dashboard", { jar: owner })).json();
    const guestRow = dashboard.leaderboard.find((p) => p.name === "Smoke Guest");
    expect(guestRow && guestRow.profitTotal === -4, `guest standing ${JSON.stringify(guestRow)}`);
    const nights = await (await api("/api/clubs/current/sessions", { jar: owner })).json();
    const liveNight = nights.sessions.find((n) => n.source === "live");
    expect(liveNight, "no live night recorded");
    const removal = await api(`/api/clubs/current/sessions/${liveNight.id}`, { jar: owner, method: "DELETE" });
    expect(removal.status === 409, `live nights are removed from the ledger, got ${removal.status}`);
  });

  await check("a ledger that does not balance needs an admin's choice before it closes", async () => {
    const add = (action, amount, attributedPlayer) => api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action, amount, attributedPlayer } });
    const resolve = (jar, body) => api("/api/clubs/current/ledger/resolution", { jar, method: "PUT", body });
    // Over: more went in than came out.
    await api("/api/poker/live-session/start", { jar: owner, method: "POST" });
    await add("buy_in", 10, "Smoke Guest");
    await add("cash_out", 6, "Smoke Guest");
    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).status === 409, "an unbalanced ledger closed without a choice");
    expect((await resolve(guest, { mode: "jackpot" })).status === 401, "a member could choose how to balance");
    expect((await resolve(owner, { mode: "split" })).status === 409, "a shortfall option was accepted for a surplus");
    expect((await resolve(owner, { mode: "jackpot" })).ok, "jackpot choice refused");
    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, "ledger did not close after the choice");
    const jackpot = await (await api("/api/clubs/current/jackpot", { jar: owner })).json();
    expect(jackpot.total === 4 && jackpot.nights === 1, `jackpot ${JSON.stringify(jackpot)}`);
    // Under: more came out than went in; it comes off one player.
    await api("/api/poker/live-session/start", { jar: owner, method: "POST" });
    await add("buy_in", 10, "Smoke Guest");
    await add("cash_out", 12, "Smoke Guest");
    expect((await resolve(owner, { mode: "jackpot" })).status === 409, "a surplus option was accepted for a shortfall");
    expect((await resolve(owner, { mode: "player", name: "Nobody" })).status === 409, "an unknown player was accepted");
    expect((await resolve(owner, { mode: "player", name: "Smoke Guest" })).ok, "player choice refused");
    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, "ledger did not close");
    const after = await (await api("/api/clubs/current/jackpot", { jar: owner })).json();
    expect(after.total === 4, "a shortfall changed the jackpot");
  });

  await check("an imported batch can be undone; members cannot import", async () => {
    const refused = await api("/api/clubs/current/import", { jar: guest, method: "POST", body: { text: history } });
    expect(refused.status === 401, `expected 401, got ${refused.status}`);
    const undo = await api(`/api/clubs/current/import/${batchId}`, { jar: owner, method: "DELETE" });
    expect(undo.ok, `undo ${undo.status}`);
    expect((await undo.json()).removed === 2, "undo removed the wrong number of nights");
    const dashboard = await (await api("/api/poker/dashboard", { jar: owner })).json();
    expect(!dashboard.leaderboard.some((p) => p.name === "Eli"), "imported player still on the leaderboard");
  });

  await check("a Google Sheets import only accepts Google Sheets links", async () => {
    const response = await api("/api/clubs/current/import/preview", { jar: owner, method: "POST", body: { sheetUrl: "https://example.com/x" } });
    expect(response.status === 400, `expected 400, got ${response.status}`);
  });

  const me = async (jar) => ((await (await api("/api/clubs/me", { jar })).json()).user ?? null);

  // Email goes to an in-memory "dev inbox" when no mail provider is configured (see /api/dev/emails).
  const inbox = async () => (await (await api("/api/dev/emails")).json()).emails;
  const firstLink = (text, pattern) => text.match(pattern)?.[0];

  await check("signing up sends a confirmation email, and its link confirms the address", async () => {
    const address = `confirm-${stamp}@example.com`;
    const jar = cookieJar();
    const signUp = await api("/api/identity/sign-up/email", { jar, method: "POST", headers: origin, body: { name: "Con Firm", email: address, password } });
    expect(signUp.ok, `sign-up ${signUp.status}`);
    await sleep(400);
    const mail = (await inbox()).filter((m) => m.to === address).at(-1);
    expect(mail && /Confirm your email/.test(mail.subject), "no confirmation email was sent");
    const link = firstLink(mail.text, /https?:\/\/\S+verify-email\S+/);
    expect(link, "no confirmation link in the email");
    const clicked = await fetch(link, { redirect: "manual" });
    expect(clicked.status === 302, `confirm link answered ${clicked.status}`);
    const me = await (await api("/api/clubs/me", { jar })).json();
    expect(me.user?.emailVerified === true, "address was not marked confirmed");
    expect(me.options.email === true, "server should report that email works");
  });

  await check("a forgotten password can be reset once from an emailed link", async () => {
    const address = `reset-${stamp}@example.com`;
    const old = cookieJar();
    await api("/api/identity/sign-up/email", { jar: old, method: "POST", headers: origin, body: { name: "Rea Set", email: address, password } });
    const asked = await api("/api/identity/request-password-reset", { method: "POST", headers: origin, body: { email: address, redirectTo: `${BASE}/reset-password` } });
    expect(asked.ok, `request ${asked.status}`);
    await sleep(400);
    const mail = (await inbox()).filter((m) => m.to === address && /Reset your/.test(m.subject)).at(-1);
    expect(mail, "no reset email was sent");
    const landing = await fetch(firstLink(mail.text, /https?:\/\/\S+reset-password\/\S+/), { redirect: "manual" });
    const token = new URL(landing.headers.get("location"), BASE).searchParams.get("token");
    expect(token, "reset link did not carry a token");
    const weak = await api("/api/identity/reset-password", { method: "POST", headers: origin, body: { token, newPassword: "short" } });
    expect(weak.status === 400, `a weak password should be refused, got ${weak.status}`);
    const changed = await api("/api/identity/reset-password", { method: "POST", headers: origin, body: { token, newPassword: "a-new-password-7" } });
    expect(changed.ok, `reset ${changed.status}`);
    const oldLogin = await api("/api/identity/sign-in/email", { method: "POST", headers: origin, body: { email: address, password } });
    expect(oldLogin.status === 401, `old password should stop working, got ${oldLogin.status}`);
    const newLogin = await api("/api/identity/sign-in/email", { method: "POST", headers: origin, body: { email: address, password: "a-new-password-7" } });
    expect(newLogin.ok, `new password should work, got ${newLogin.status}`);
    const again = await api("/api/identity/reset-password", { method: "POST", headers: origin, body: { token, newPassword: "another-password-8" } });
    expect(again.status === 400, `a reset link should work once, got ${again.status}`);
    expect((await me(old)) === null, "the old session should have been signed out");
  });

  await check("asking to reset an unknown address looks the same and sends nothing", async () => {
    const before = (await inbox()).length;
    const response = await api("/api/identity/request-password-reset", { method: "POST", headers: origin, body: { email: `nobody-${stamp}@example.com`, redirectTo: `${BASE}/reset-password` } });
    expect(response.ok, `status ${response.status}`);
    await sleep(400);
    expect((await inbox()).length === before, "an email was sent for an address with no account");
  });

  await check("an admin can email an invite; members and bad addresses are refused", async () => {
    const friend = `friend-${stamp}@example.com`;
    const bad = await api("/api/clubs/current/invites/email", { jar: owner, method: "POST", body: { email: "not-an-email" } });
    expect(bad.status === 400, `bad address should be refused, got ${bad.status}`);
    const refused = await api("/api/clubs/current/invites/email", { jar: guest, method: "POST", body: { email: friend } });
    expect(refused.status === 401, `members should be refused, got ${refused.status}`);
    const sent = await api("/api/clubs/current/invites/email", { jar: owner, method: "POST", body: { email: friend } });
    expect(sent.status === 201, `send ${sent.status}`);
    const mail = (await inbox()).filter((m) => m.to === friend).at(-1);
    const link = mail && firstLink(mail.text, /https?:\/\/\S+\/join\/[A-Z0-9]+/);
    expect(link, "no invite link in the email");
    const code = link.split("/join/")[1];
    const preview = await api(`/api/invites/${code}`);
    expect(preview.ok, `the emailed link's code should be a valid invite, got ${preview.status}`);
  });

  await check("a signed-in person can change their password", async () => {
    const address = `pw-${stamp}@example.com`;
    const jar = cookieJar();
    await api("/api/identity/sign-up/email", { jar, method: "POST", headers: origin, body: { name: "Pat Word", email: address, password } });
    const wrong = await api("/api/identity/change-password", { jar, method: "POST", headers: origin, body: { currentPassword: "not-the-password-1", newPassword: "changed-pass-3", revokeOtherSessions: true } });
    expect(wrong.status === 400, `wrong current password should be refused, got ${wrong.status}`);
    const right = await api("/api/identity/change-password", { jar, method: "POST", headers: origin, body: { currentPassword: password, newPassword: "changed-pass-3", revokeOtherSessions: true } });
    expect(right.ok, `change ${right.status}`);
    const old = await api("/api/identity/sign-in/email", { method: "POST", headers: origin, body: { email: address, password } });
    expect(old.status === 401, `old password should stop working, got ${old.status}`);
    const fresh = await api("/api/identity/sign-in/email", { method: "POST", headers: origin, body: { email: address, password: "changed-pass-3" } });
    expect(fresh.ok, `new password should work, got ${fresh.status}`);
  });

  await check("handing a club over, then deleting the old owner's account, keeps the club and its history", async () => {
    const boss = cookieJar(), mate = cookieJar();
    const bossMail = `boss-${stamp}@example.com`;
    await api("/api/identity/sign-up/email", { jar: boss, method: "POST", headers: origin, body: { name: "Big Boss", email: bossMail, password } });
    await api("/api/identity/sign-up/email", { jar: mate, method: "POST", headers: origin, body: { name: "Team Mate", email: `mate-${stamp}@example.com`, password } });
    await api("/api/clubs", { jar: boss, method: "POST", body: { name: `Handover ${stamp}`, playerName: "Boss" } });
    const invite = await (await api("/api/clubs/current/invites", { jar: boss, method: "POST", body: {} })).json();
    expect((await api(`/api/invites/${invite.invite.code}/accept`, { jar: mate, method: "POST", body: { name: "Mate" } })).ok, "mate could not join");
    await api("/api/clubs/current/import", { jar: boss, method: "POST", body: { text: "Date,Player,Buy-in,Cash-out\n2026-03-03,Boss,10,25\n,Mate,10,0" } });

    const blocked = await api("/api/account/delete", { jar: boss, method: "POST", body: { password } });
    expect(blocked.status === 409, `an owner with members should be blocked, got ${blocked.status}`);
    const wrong = await api("/api/account/delete", { jar: boss, method: "POST", body: { password: "wrong-wrong-1" } });
    expect(wrong.status === 400, `a wrong password should be refused, got ${wrong.status}`);

    const roster = await (await api("/api/clubs/current/members", { jar: boss })).json();
    const mateId = roster.members.find((m) => m.name === "Mate").playerId;
    const handed = await api(`/api/clubs/current/members/${mateId}`, { jar: boss, method: "PATCH", body: { role: "owner" } });
    expect(handed.ok, `handover ${handed.status}`);
    const asAdmin = await api("/api/clubs/current", { jar: boss, method: "DELETE", body: { confirmName: `Handover ${stamp}` } });
    expect(asAdmin.status === 403, `a former owner can't delete the club, got ${asAdmin.status}`);

    const gone = await api("/api/account/delete", { jar: boss, method: "POST", body: { password } });
    expect(gone.status === 204, `delete account ${gone.status}`);
    const signIn = await api("/api/identity/sign-in/email", { method: "POST", headers: origin, body: { email: bossMail, password } });
    expect(signIn.status === 401, `a deleted account must not sign in, got ${signIn.status}`);
    const dashboard = await (await api("/api/poker/dashboard", { jar: mate })).json();
    expect(dashboard.leaderboard.some((p) => p.name === "Boss"), "the deleted member's results should stay in the club");
    const members = await (await api("/api/clubs/current/members", { jar: mate })).json();
    expect(members.members.find((m) => m.name === "Boss")?.claimed === false, "the name should be unlinked, not deleted");

    const refused = await api("/api/clubs/current", { jar: mate, method: "DELETE", body: { confirmName: "wrong name" } });
    expect(refused.status === 400, `the exact name must be typed, got ${refused.status}`);
    const deleted = await api("/api/clubs/current", { jar: mate, method: "DELETE", body: { confirmName: `Handover ${stamp}` } });
    expect(deleted.status === 204, `delete club ${deleted.status}`);
    const after = await (await api("/api/clubs/me", { jar: mate })).json();
    expect(after.clubs.length === 0, "the club should be gone for its members");
  });

  await check("a club's results can be exported and imported into another club unchanged", async () => {
    const a = cookieJar(), b = cookieJar(), outsider = cookieJar();
    for (const [jar, name] of [[a, "Exp Orter"], [b, "Imp Orter"], [outsider, "Out Sider"]]) {
      await api("/api/identity/sign-up/email", { jar, method: "POST", headers: origin, body: { name, email: `${name.replace(" ", "").toLowerCase()}-${stamp}@example.com`, password } });
    }
    await api("/api/clubs", { jar: a, method: "POST", body: { name: `Export ${stamp}`, playerName: "Exp" } });
    await api("/api/clubs", { jar: b, method: "POST", body: { name: `Import ${stamp}`, playerName: "Imp" } });
    const text = "Date,Player,Buy-in,Cash-out\n2026-03-03,Ann,20,35.5\n,\"Bo, Jr.\",20,4.5\n2026-03-10,Ann,10,0\n,\"Bo, Jr.\",10,20";
    expect((await api("/api/clubs/current/import", { jar: a, method: "POST", body: { text } })).ok, "seed import failed");
    const exported = await api("/api/clubs/current/export.csv", { jar: a });
    expect(exported.ok && /text\/csv/.test(exported.headers.get("content-type")), `export ${exported.status}`);
    const csv = await exported.text();
    expect(/attachment/.test(exported.headers.get("content-disposition") ?? ""), "export should download as a file");
    const copied = await api("/api/clubs/current/import", { jar: b, method: "POST", body: { text: csv } });
    expect(copied.status === 201 && (await copied.json()).imported === 2, "the export did not import cleanly");
    const original = await (await api("/api/poker/dashboard", { jar: a })).json();
    const copy = await (await api("/api/poker/dashboard", { jar: b })).json();
    const shape = (d) => JSON.stringify(d.leaderboard.map((p) => [p.name, p.profitTotal, p.gamesPlayed]));
    expect(shape(original) === shape(copy), `standings differ:\n${shape(original)}\n${shape(copy)}`);
    const refused = await api("/api/clubs/current/export.csv", { jar: outsider });
    expect(refused.status === 401, `non-admins should be refused, got ${refused.status}`);
  });

  await check("a lone owner's account deletion takes their club with it", async () => {
    const jar = cookieJar();
    await api("/api/identity/sign-up/email", { jar, method: "POST", headers: origin, body: { name: "Solo Sam", email: `solo-${stamp}@example.com`, password } });
    await api("/api/clubs", { jar, method: "POST", body: { name: `Solo ${stamp}`, playerName: "Solo" } });
    const gone = await api("/api/account/delete", { jar, method: "POST", body: { password } });
    expect(gone.status === 204, `delete ${gone.status}`);
    const signIn = await api("/api/identity/sign-in/email", { method: "POST", headers: origin, body: { email: `solo-${stamp}@example.com`, password } });
    expect(signIn.status === 401, `signed in after deletion: ${signIn.status}`);
  });

  await check("a club with several years of history shows one year at a time", async () => {
    const text = "Date,Player,Buy-in,Cash-out\n2024-10-05,Yr A,10,20\n,Yr B,10,0\n2026-10-03,Yr A,10,0\n,Yr B,10,20";
    const imported = await (await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text } })).json();
    expect(imported.imported === 2, `imported ${imported.imported}`);
    const years = await (await api("/api/clubs/current/years", { jar: owner })).json();
    expect(years.years.includes(2024) && years.years.includes(2026), `years ${JSON.stringify(years)}`);
    expect(years.selected === String(years.years[years.years.length - 1]), "should default to the latest year");
    const latest = await (await api("/api/poker/dashboard", { jar: owner })).json();
    expect(latest.sessions.every((n) => n.date.startsWith(years.selected)), "latest year shows another year's nights");
    const all = await api("/api/clubs/current/year", { jar: owner, method: "POST", body: { year: "all" } });
    expect(all.ok, `year all ${all.status}`);
    const refused = await api("/api/clubs/current/year", { jar: owner, method: "POST", body: { year: "1999" } });
    expect(refused.status === 400, `expected 400, got ${refused.status}`);
    await api(`/api/clubs/current/import/${imported.batchId}`, { jar: owner, method: "DELETE" });
  });

  await check("a tournament can be recorded and appears with its prizes worked out", async () => {
    const body = {
      date: "2026-10-04", title: "Smoke Bounty", buyIn: 20, bounty: 5,
      players: [
        { name: "Tony", finishPlace: 1, entries: 1, knockouts: 3 },
        { name: "Una", finishPlace: 2, entries: 2, knockouts: 1 },
        { name: "Vic", finishPlace: 3, entries: 1, knockouts: 0 },
        { name: "Wes", finishPlace: 4, entries: 1, knockouts: 0 },
      ],
    };
    const bad = await api("/api/clubs/current/tournaments", { jar: owner, method: "POST", body: { ...body, players: [body.players[0], { ...body.players[1], finishPlace: 1 }] } });
    expect(bad.status === 400, `duplicate places should be refused, got ${bad.status}`);
    const saved = await api("/api/clubs/current/tournaments", { jar: owner, method: "POST", body });
    expect(saved.status === 201, `record ${saved.status}`);
    const result = await saved.json();
    expect(result.totalCollected === 100 && result.mainPrizePool === 80 && result.dataCheck === "OK", `unexpected result ${JSON.stringify(result)}`);
    const dashboard = await (await api("/api/poker/dashboard", { jar: owner })).json();
    const event = dashboard.tournaments.find((t) => t.title === "Smoke Bounty");
    expect(event && event.winner === "Tony" && event.winnerPrize === 40, `event ${JSON.stringify(event && { w: event.winner, p: event.winnerPrize })}`);
    const net = event.results.reduce((sum, r) => sum + r.netProfit, 0);
    expect(Math.abs(net) < 0.01, `tournament nets ${net}`);
    expect(dashboard.tournamentSnapshot.available, "tournament snapshot missing");
    const removed = await api(`/api/clubs/current/tournaments/${result.id}`, { jar: owner, method: "DELETE" });
    expect(removed.status === 204, `delete ${removed.status}`);
  });

  await check("club settings: name, currency, timezone, rules and points preset", async () => {
    const read = await api("/api/clubs/current/settings", { jar: owner });
    expect(read.ok, `read ${read.status}`);
    const before = await read.json();
    expect(before.presets.length === 3 && before.settings.points.preset === "standard", "unexpected defaults");
    const bad = await api("/api/clubs/current/settings", { jar: owner, method: "PUT", body: { currency: "XX" } });
    expect(bad.status === 400, `bad currency should be refused, got ${bad.status}`);
    const rules = JSON.parse(JSON.stringify(before.settings.points.rules));
    rules.podium.third = rules.podium.second + 5;
    const badRules = await api("/api/clubs/current/settings", { jar: owner, method: "PUT", body: { points: { preset: "custom", rules } } });
    expect(badRules.status === 400, `bad rules should be refused, got ${badRules.status}`);
    const saved = await api("/api/clubs/current/settings", {
      jar: owner, method: "PUT",
      body: { name: "Renamed Smoke Club", currency: "gbp", timezone: "America/Los_Angeles", hashtag: "#smokeclub", guidelines: "# Rules\nBe kind.", points: { preset: "competitive" } },
    });
    expect(saved.ok, `save ${saved.status}`);
    const after = (await saved.json()).settings;
    expect(after.currency === "GBP" && after.timezone === "America/Los_Angeles" && after.hashtag === "smokeclub", "settings were not stored");
    expect(after.points.preset === "competitive" && after.points.rules.win.flat === 25, "preset was not applied");
    const dashboard = await (await api("/api/poker/dashboard", { jar: owner })).json();
    expect(dashboard.title === "Renamed Smoke Club", `dashboard title is ${dashboard.title}`);
  });

  await check("members can read club settings but not change them", async () => {
    const read = await api("/api/clubs/current/settings", { jar: guest });
    expect(read.ok, `read ${read.status}`);
    const write = await api("/api/clubs/current/settings", { jar: guest, method: "PUT", body: { name: "Hijacked" } });
    expect(write.status === 401, `expected 401, got ${write.status}`);
  });
}

console.log("\nBrowser (phone-sized screen)");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

const pageErrors = [];
const serverErrors = [];

async function newPage(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });
  return page;
}

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const page = await newPage(PHONE);

async function visible(selector, timeout = 15000) {
  await page.waitForSelector(selector, { timeout });
}

const testIdsInOrder = (pattern) =>
  page.evaluate(
    (source) =>
      [...document.querySelectorAll("[data-testid]")]
        .map((el) => el.getAttribute("data-testid"))
        .filter((id) => new RegExp(source).test(id)),
    pattern.source,
  );

await check("dark mode is the default for a new visitor", async () => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2" });
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  expect(dark, "the page is not in dark mode");
});

await check("signing in lands on Home with the tab bar on screen", async () => {
  await page.evaluate(
    async (code) => {
      await fetch("/api/auth/member/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
    },
    MEMBER_CODE,
  );
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2" });
  await visible('[data-testid="section-home-overview"]');
  const bar = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="nav-bottom-tabs"]');
    const rect = nav.getBoundingClientRect();
    return { bottom: rect.bottom, height: rect.height, viewport: window.innerHeight, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
  });
  expect(bar.height > 40 && bar.bottom <= bar.viewport + 1, `tab bar is off screen (${JSON.stringify(bar)})`);
  expect(bar.scrollW <= bar.innerW + 1, `page scrolls sideways (${bar.scrollW} > ${bar.innerW})`);
  await page.screenshot({ path: `${OUT}/home.png` });
});

await check("Home shows two podiums, net profit first then club points", async () => {
  await sleep(1500);
  const ids = await testIdsInOrder(/^(card-home-standings|card-home-points-podium)$/);
  expect(ids.join() === "card-home-standings,card-home-points-podium", `order was ${ids.join(", ")}`);
  const podiums = await page.evaluate(() => document.querySelectorAll('[data-testid="podium"]').length);
  expect(podiums === 2, `expected 2 podiums, found ${podiums}`);
});

await check("Home states your tournament finish the same way everywhere", async () => {
  const text = await page.evaluate(() => ({
    night: document.querySelector('[data-testid="card-my-night"]')?.innerText ?? "",
    latest: document.querySelector('[data-testid="text-latest-tournament-mine"]')?.innerText ?? "",
  }));
  const place = (t) => (t.match(/(\d+(?:st|nd|rd|th)) of (\d+)/) ?? []).slice(1, 3).join(" of ");
  if (/Your last tournament/.test(text.night) && /of \d+/.test(text.latest)) {
    expect(place(text.night) === place(text.latest), `last-game card says "${place(text.night)}", tournament card says "${place(text.latest)}"`);
  }
});

await check("Games opens on All and lists games", async () => {
  await page.tap('[data-testid="tab-sessions"]');
  await visible('[data-testid="section-games"]');
  const pressed = await page.evaluate(
    () => [...document.querySelectorAll('[aria-label="Game type"] button[aria-pressed="true"]')].map((b) => b.textContent),
  );
  expect(pressed.length === 1 && /^All/.test(pressed[0].trim()), `selected: ${pressed.join("|")}`);
  await visible('[data-testid^="card-session-"]');
  await page.screenshot({ path: `${OUT}/games.png` });
});

await check("Games has one heading and a player search that narrows the list", async () => {
  const h1 = await page.evaluate(() => document.querySelectorAll("h1").length);
  expect(h1 === 1, `expected one h1, found ${h1}`);
  const before = await page.evaluate(() => document.querySelectorAll('[data-testid="grid-all-games"] > div').length);
  await page.type('[data-testid="input-games-search"]', "zzzz-nobody");
  await sleep(300);
  const none = await page.evaluate(() => document.querySelectorAll('[data-testid="grid-all-games"] > div').length);
  expect(none === 0, `search for a missing player still shows ${none} games`);
  // Clear it the way a person would: select all the text, then delete it.
  await page.$eval('[data-testid="input-games-search"]', (input) => {
    input.focus();
    input.select();
  });
  await page.keyboard.press("Backspace");
  await sleep(300);
  const after = await page.evaluate(() => document.querySelectorAll('[data-testid="grid-all-games"] > div').length);
  expect(after === before, `clearing the search should restore ${before} games, found ${after}`);
});

await check("a tournament opens its detail with results", async () => {
  if (dashboard.tournaments.length === 0) return "no tournaments to open";
  await page.evaluate(() => document.querySelector('[data-testid^="card-tournament-2"]')?.click());
  await visible('[data-testid="section-tournament-detail"]');
  const rows = await page.evaluate(() => document.querySelectorAll('[data-testid="list-tournament-results"] li').length);
  expect(rows > 0, "no result rows");
  return `${rows} results`;
});

await check("leaderboard: profit podium, points podium, then the tables", async () => {
  await page.tap('[data-testid="tab-months"]');
  await visible('[data-testid="section-period-leaderboards"]');
  await visible('[data-testid="card-points-podium"]');
  const ids = await testIdsInOrder(/^(card-podium|card-points-podium|card-leaderboard-bars|section-points-leaderboard)$/);
  expect(
    ids.join() === "card-podium,card-points-podium,card-leaderboard-bars,section-points-leaderboard",
    `order was ${ids.join(", ")}`,
  );
  await page.screenshot({ path: `${OUT}/leaderboard.png` });
});

await check("one filter drives both tables, and avatars are varied", async () => {
  const kinds = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('[data-testid="button-global-earnings-scope-tournaments"]').click();
    await wait(600);
    const rows = [...document.querySelectorAll('[data-testid="list-points"] li')].map((li) => li.innerText);
    const presets = new Set(
      [...document.querySelectorAll('[data-testid="list-points"] svg linearGradient')].map((g) => (g.id.match(/^av-([a-z]+)-/) ?? [])[1]).filter(Boolean),
    );
    document.querySelector('[data-testid="button-global-earnings-scope-all"]').click();
    return { rows, presets: presets.size };
  });
  if (kinds.rows.length) {
    expect(kinds.rows.every((row) => /tournament/i.test(row)), "tournament-only filter still shows cash nights in club points");
  }
  expect(kinds.presets >= 2 || kinds.rows.length < 4, `only ${kinds.presets} different default pictures in the points list`);
});

await check("no text is smaller than 11px on the main pages", async () => {
  const tiny = await page.evaluate(() =>
    [...document.querySelectorAll("p, span, li, dt, dd, label, button, h1, h2, h3")]
      .filter((e) => e.childElementCount === 0 && e.textContent.trim() && !e.closest(".sr-only") && e.getBoundingClientRect().width > 0)
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 10.9)
      .map((e) => e.textContent.trim().slice(0, 30)),
  );
  expect(tiny.length === 0, `${tiny.length} tiny text items, e.g. ${tiny.slice(0, 3).join(" | ")}`);
});

await check("tapping a podium name opens that player's profile", async () => {
  await page.tap('[data-testid="card-podium"] [data-testid="podium-name-1"]');
  await visible('[data-testid="metric-player-profit"]');
  const order = await testIdsInOrder(/^(metric-player-profit|card-points-breakdown)$/);
  expect(order[0] === "metric-player-profit", `profit should come first: ${order.join(", ")}`);
});

await check("Live ledger and Club pages load", async () => {
  await page.tap('[data-testid="tab-live"]');
  await visible('[data-testid="section-live-ledger"]');
  await page.tap('[data-testid="tab-guidelines"]');
  await visible('[data-testid="section-guidelines"]');
});

await check("My account page loads from the menu", async () => {
  await page.tap('[data-testid="button-mobile-dashboard-menu"]');
  await visible('[data-testid="menu-open-account"]');
  await page.tap('[data-testid="menu-open-account"]');
  await visible('[data-testid="section-account"]');
});

await check("admin page shows status and keeps the danger zone closed", async () => {
  const adminPage = await newPage({ width: 1280, height: 900 });
  await adminPage.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await adminPage.evaluate(
    async (password) => {
      await fetch("/api/auth/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
    },
    ADMIN_PASSWORD,
  );
  await adminPage.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await adminPage.waitForSelector('[data-testid="section-admin-health"]', { timeout: 15000 });
  const state = await adminPage.evaluate(() => ({
    members: !!document.querySelector('[data-testid="section-admin-members"]'),
    audit: !!document.querySelector('[data-testid="section-admin-audit"]'),
    dangerOpen: document.querySelector('[data-testid="section-admin-danger"]')?.hasAttribute("open"),
    h1: document.querySelectorAll("h1").length,
  }));
  expect(state.members && state.audit, "members or activity log missing");
  expect(state.dangerOpen === false, "the danger zone should start collapsed");
  expect(state.h1 === 1, `expected one h1, found ${state.h1}`);
  await adminPage.screenshot({ path: `${OUT}/admin.png` });
});

await check("terms and privacy are readable without signing in, and sign-up asks for agreement", async () => {
  // A clean browser context, so this is a first-time visitor and not the member signed in above.
  const visitorContext = await browser.createBrowserContext();
  const visitor = await visitorContext.newPage();
  await visitor.setViewport({ width: 390, height: 844 });
  for (const path of ["/terms", "/privacy"]) {
    await visitor.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
    const h1 = await visitor.$eval("h1", (n) => n.textContent);
    expect(h1 && h1.length > 3, `${path} has no heading`);
    const text = await visitor.evaluate(() => document.body.innerText);
    expect(/18/.test(text) || path === "/privacy", `${path} should mention the age requirement`);
  }
  await visitor.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await visitor.waitForSelector('[data-testid="tab-signup"]', { timeout: 15000 });
  await visitor.click('[data-testid="tab-signup"]');
  await visitor.waitForSelector('[data-testid="checkbox-terms"]');
  const disabledBefore = await visitor.$eval('[data-testid="button-account-submit"]', (b) => b.disabled);
  expect(disabledBefore === true, "the Create account button should wait for the agreement box");
  await visitor.click('[data-testid="checkbox-terms"]');
  const disabledAfter = await visitor.$eval('[data-testid="button-account-submit"]', (b) => b.disabled);
  expect(disabledAfter === false, "ticking the box should enable the button");
  await visitorContext.close();
});

await check("no script errors or server errors during the run", async () => {
  expect(pageErrors.length === 0, `script errors: ${[...new Set(pageErrors)].slice(0, 3).join(" | ")}`);
  expect(serverErrors.length === 0, `server errors: ${[...new Set(serverErrors)].slice(0, 3).join(" | ")}`);
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  process.exit(1);
}
