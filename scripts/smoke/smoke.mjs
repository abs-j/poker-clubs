// End-to-end smoke test: the API over HTTP, then the main screens in a real browser.
//
// Checks the API over HTTP, then walks the main screens in a real browser on a phone-sized
// screen. It creates its own accounts and clubs, so it needs an empty or throwaway database.
// It is deliberately structural ("there are podiums", "the tab bar is on screen") rather than exact.
//
// Run from a folder that has `puppeteer-core` installed (CI installs it in a temp folder):
//   SMOKE_BASE_URL=http://localhost:5173 node scripts/smoke/smoke.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

// Admins land on "Paste notes" on the Record tab; the live table is one tap away. Members have no such tab.
async function openTable(page) {
  await page.waitForSelector('[data-testid="tab-record-table"]', { timeout: 4000 })
    .then(() => page.$eval('[data-testid="tab-record-table"]', (node) => node.click()))
    .catch(() => undefined);
}


const require = createRequire(`${process.cwd()}/`);
const puppeteer = require("puppeteer-core");

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const OUT = process.env.SMOKE_OUT ?? "smoke-output";
mkdirSync(OUT, { recursive: true });

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

await check("health endpoint answers", async () => {
  const response = await api("/api/healthz");
  expect(response.ok, `status ${response.status}`);
});

await check("results and admin tools need a sign-in, and the old sign-in routes are gone", async () => {
  expect((await api("/api/poker/dashboard")).status === 401, "dashboard should need a sign-in");
  expect((await api("/api/admin/visits")).status === 404, "the old usage route should be gone");
  expect((await api("/api/platform/usage")).status === 401, "platform usage should need a sign-in");
  expect((await api("/api/auth/member/login", { method: "POST", body: { code: "x" } })).status === 404, "access-code sign-in should be gone");
  expect((await api("/api/poker/public-summary")).status === 404, "the public snapshot should be gone");
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

  await check("a new club starts empty", async () => {
    const response = await api("/api/poker/dashboard", { jar: owner });
    expect(response.ok, `status ${response.status}`);
    const json = await response.json();
    expect(json.leaderboard.length === 0 && json.sessions.length === 0, "new club has someone else's data");
  });

  const rival = cookieJar();
  await check("a second club's ledger is separate from the first club's", async () => {
    expect((await api("/api/identity/sign-up/email", { jar: rival, method: "POST", headers: origin, body: { name: "Rival Owner", email: `rival-${stamp}@example.com`, password } })).ok, "rival sign-up failed");
    expect((await api("/api/clubs", { jar: rival, method: "POST", body: { name: `Rival Club ${stamp}`, playerName: "Rival Owner" } })).status === 201, "rival club not created");
    const started = await api("/api/poker/live-session/start", { jar: owner, method: "POST" });
    expect(started.ok, `start ${started.status}`);
    const entry = await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "buy_in", amount: 10 } });
    expect(entry.ok, `entry ${entry.status}`);
    const mine = await (await api("/api/poker/live-activity", { jar: owner })).json();
    const theirs = await (await api("/api/poker/live-activity", { jar: rival })).json();
    expect(mine.entries.length === 1, `expected 1 entry, got ${mine.entries.length}`);
    expect(!theirs.entries.some((e) => e.eventId === mine.entries[0].eventId), "entry leaked to another club");
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
    const memberList = await api("/api/clubs/current/invites", { jar: guest });
    expect(memberList.status === 401, `the admin invite list should stay admin-only, got ${memberList.status}`);
    const memberUsage = await api("/api/platform/usage", { jar: guest });
    expect(memberUsage.status === 403, `a member should not see usage, got ${memberUsage.status}`);
    const ownerUsage = await api("/api/platform/usage", { jar: owner });
    expect(ownerUsage.status === 403, `a club owner should not see usage, got ${ownerUsage.status}`);
    expect((await api("/api/admin/visits", { jar: owner })).status === 404, "the old usage route should be gone");
  });

  await check("any member can read the invite link, and only an admin can reset it", async () => {
    const readable = await api("/api/clubs/current/invite", { jar: guest });
    expect(readable.ok, `member read ${readable.status}`);
    const shared = await readable.json();
    expect(shared.invites.length > 0 && shared.invites.every((invite) => invite.role === "member" && invite.code), "member invite list was empty");
    const made = await api("/api/clubs/current/invites", { jar: owner, method: "POST", body: { role: "admin" } });
    expect(made.status === 201, `admin invite ${made.status}`);
    const adminInvite = (await made.json()).invite;
    const again = await (await api("/api/clubs/current/invite", { jar: guest })).json();
    expect(!again.invites.some((invite) => invite.code === adminInvite.code), "an admin invite was shown to a member");
    expect((await api(`/api/clubs/current/invites/${again.invites[0].id}`, { jar: guest, method: "DELETE" })).status === 401, "a member reset a member invite");
    expect((await api(`/api/clubs/current/invites/${adminInvite.id}`, { jar: guest, method: "DELETE" })).status === 401, "a member revoked an admin invite");
    expect((await api(`/api/clubs/current/invites/${adminInvite.id}`, { jar: owner, method: "DELETE" })).status === 204, "the owner could not revoke the admin invite");
    const roster = await api("/api/clubs/current/members", { jar: guest });
    expect(roster.ok, `member roster ${roster.status}`);
    const guestRow = (await roster.json()).members.find((member) => member.name === "Smoke Guest");
    expect(guestRow && guestRow.email === undefined, "a member should not see email addresses");
  });

  await check("resetting one club's ledger leaves the other club alone", async () => {
    const backup = await (await api("/api/admin/live-ledger/backup", { jar: owner })).json();
    expect(backup.counts.events === 1, `expected 1 event in the backup, got ${backup.counts.events}`);
    const reset = await api("/api/admin/live-ledger/reset", {
      jar: owner, method: "POST", body: { backupId: backup.backupId, confirmation: "RESET LIVE LEDGER" },
    });
    expect(reset.ok, `reset ${reset.status}`);
    const theirs = await api("/api/poker/live-activity", { jar: rival });
    expect(theirs.ok, "the other club's ledger went missing");
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
    expect(dashboard.months.some((m) => m.month === "2026-03" && m.label === "Mar 2026"), "March 2026 missing from the months");
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
    expect((await api(`/api/clubs/current/sessions/${liveNight.id}`, { jar: guest, method: "DELETE" })).status === 403, "a member deleted a night");
    expect((await api(`/api/clubs/current/sessions/${liveNight.id}`, { jar: rival, method: "DELETE" })).status === 404, "another club deleted the night");
    const beforeDelete = await (await api("/api/poker/dashboard", { jar: owner })).json();
    const removal = await api(`/api/clubs/current/sessions/${liveNight.id}`, { jar: owner, method: "DELETE" });
    expect(removal.status === 204, `admin delete of a live night ${removal.status} ${await removal.text()}`);
    const afterDelete = await (await api("/api/poker/dashboard", { jar: owner })).json();
    expect(afterDelete.sessions.length === beforeDelete.sessions.length - 1, "deleting the live night left it on the Games list");
    expect(!afterDelete.leaderboard.some((p) => p.name === "Smoke Guest"), "the deleted night's guest stayed on the leaderboard");
    const again = await (await api("/api/poker/dashboard", { jar: owner })).json();
    expect(again.sessions.length === afterDelete.sessions.length, "the deleted live night was recorded again");
    expect((await api(`/api/clubs/current/sessions/${liveNight.id}`, { jar: owner, method: "DELETE" })).status === 404, "deleting the night twice should be 404");
  });

  await check("a ledger that does not balance needs an admin's choice before it closes", async () => {
    const add = (action, amount, attributedPlayer) => api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action, amount, attributedPlayer } });
    const resolve = (jar, body) => api("/api/clubs/current/ledger/resolution", { jar, method: "PUT", body });
    // Over: more went in than came out.
    await api("/api/poker/live-session/start", { jar: owner, method: "POST" });
    await add("buy_in", 10, "Smoke Guest");
    await add("cash_out", 6, "Smoke Guest");
    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).status === 409, "an unbalanced ledger closed without a choice");
    expect((await resolve(guest, { mode: "jackpot" })).status === 403, "a member who is not the host could choose how to balance");
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

  await check("the host or an admin can pay the jackpot out, and the total goes down", async () => {
    const pay = (jar, body) => api("/api/clubs/current/jackpot/payouts", { jar, method: "POST", body });
    expect((await pay(guest, { name: "Smoke Guest", amount: 1 })).status === 403, "a member who is not the host paid the jackpot");
    expect((await pay(rival, { name: "Rival Owner", amount: 1 })).status === 400, "an empty jackpot paid out");
    expect((await pay(owner, { name: "Nobody", amount: 1 })).status === 400, "an unknown player was paid");
    expect((await pay(owner, { name: "Smoke Guest", amount: 5 })).status === 400, "a payout bigger than the pot was accepted");
    const paid = await pay(owner, { name: "smoke guest", amount: "1.50" });
    expect(paid.status === 201, `payout ${paid.status}`);
    const body = await paid.json();
    expect(body.total === 2.5 && body.nights === 1 && body.payouts.length === 1, `after payout ${JSON.stringify(body)}`);
    const row = body.payouts[0];
    expect(row.name === "Smoke Guest" && row.amount === 1.5 && row.by === "Pat Imported", `payout row ${JSON.stringify(row)}`);
    const untouched = await (await api("/api/clubs/current/jackpot", { jar: rival })).json();
    expect(untouched.total === 0 && untouched.payouts.length === 0, "a payout showed up in another club");

    expect((await api("/api/poker/live-session/start", { jar: guest, method: "POST" })).ok, "guest could not start a night");
    const hostPaid = await pay(guest, { name: "Pat Imported", amount: 1 });
    expect(hostPaid.status === 201, `the host's payout ${hostPaid.status}`);
    const afterHost = await hostPaid.json();
    expect(afterHost.total === 1.5 && afterHost.payouts.length === 2, `after the host paid ${JSON.stringify({ total: afterHost.total, payouts: afterHost.payouts.length })}`);
    expect((await api("/api/poker/live-session/end", { jar: guest, method: "POST" })).ok, "could not discard the empty night");
    const still = await (await api("/api/clubs/current/jackpot", { jar: owner })).json();
    expect(still.total === 1.5 && still.payouts.length === 2, "discarding the night changed the jackpot");
  });

  await check("the host manages the night, and reopening it does not record it twice", async () => {
    const nights = async () => (await (await api("/api/poker/dashboard", { jar: owner })).json()).sessions.length;
    const before = await nights();

    expect((await api("/api/poker/live-session/start", { jar: owner, method: "POST" })).ok, "could not start");
    const hosting = await (await api("/api/poker/live-session/role", { jar: owner })).json();
    expect(hosting.status === "open" && hosting.canManage === true && hosting.hostName === "Pat Imported", `role ${JSON.stringify(hosting)}`);
    expect((await api("/api/poker/live-session/end", { jar: guest, method: "POST" })).status === 403, "a member who is not the host closed the night");

    const add = (jar, action, amount, who) => api("/api/poker/live-activity", { jar, method: "POST", body: { action, amount, ...(who ? { attributedPlayer: who } : {}) } });
    // One person records for the table: a member who is not the host is refused, and the host logs for them.
    expect((await add(guest, "buy_in", 10)).status === 403, "a member who is not the host logged an entry");
    expect((await add(owner, "buy_in", 10, "Smoke Guest")).ok, "host buy-in for the guest failed");
    expect((await add(owner, "buy_in", 10)).ok, "owner buy-in failed");
    expect((await add(owner, "cash_out", 10, "Smoke Guest")).ok, "host cash-out for the guest failed");
    expect((await add(owner, "cash_out", 10)).ok, "owner cash-out failed");

    const ledger = await (await api("/api/poker/live-activity", { jar: guest })).json();
    const theirs = ledger.entries.find((entry) => entry.createdBy === "Pat Imported" && entry.action === "buy_in");
    expect(theirs, "the host's buy-ins were not on the ledger");
    const edit = (jar, eventId) => api(`/api/poker/live-activity/${eventId}`, {
      jar, method: "PATCH", body: { action: "buy_in", amount: 10, comment: "A correction" },
    });
    expect((await edit(guest, theirs.eventId)).status === 403, "a member edited an entry they did not log");

    const handed = await api("/api/poker/live-session/host", { jar: owner, method: "POST", body: { name: "smoke guest" } });
    expect(handed.ok, `hand over ${handed.status}`);
    const guestHost = await (await api("/api/poker/live-session/role", { jar: guest })).json();
    expect(guestHost.canManage === true && guestHost.hostName === "Smoke Guest", `after hand over ${JSON.stringify(guestHost)}`);
    // The night is balanced, so the choice is refused, but only after the host is allowed to make one.
    expect((await api("/api/clubs/current/ledger/resolution", { jar: guest, method: "PUT", body: { mode: "jackpot" } })).status === 409, "the host was blocked from the balance step");
    expect((await api("/api/poker/live-session/host", { jar: guest, method: "POST", body: { name: "Nobody Here" } })).status === 400, "a non-member was accepted as host");
    expect((await api("/api/poker/live-session/host", { jar: guest, method: "POST", body: { name: "Pat Imported" } })).ok, "could not hand the night back");

    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, "the host could not close");
    expect(await nights() === before + 1, "the closed night was not recorded");
    expect((await api("/api/poker/live-session/reopen", { jar: guest, method: "POST" })).status === 403, "a member who is not the host reopened the night");
    const reopened = await api("/api/poker/live-session/reopen", { jar: owner, method: "POST" });
    expect(reopened.ok, `reopen ${reopened.status}`);
    const openAgain = await (await api("/api/poker/live-activity", { jar: owner })).json();
    expect(openAgain.sessionStatus === "open", `expected the night to be open, got ${openAgain.sessionStatus}`);
    expect(await nights() === before, "reopening left the recorded night in place");
    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, "could not close the reopened night");
    expect(await nights() === before + 1, "closing again recorded a second copy of the night");
  });

  await check("a bank holds the cash, and settling up is ticked off by the host, the bank or an admin", async () => {
    const add = (jar, action, amount, who) => api("/api/poker/live-activity", { jar, method: "POST", body: { action, amount, ...(who ? { attributedPlayer: who } : {}) } });
    const settlement = (jar, id) => api(`/api/clubs/current/nights/${id}/settlement`, { jar });
    const tick = (jar, id, body) => api(`/api/clubs/current/nights/${id}/settlement`, { jar, method: "PUT", body });
    const mineFor = async (jar) => (await (await api("/api/clubs/current/settle-up", { jar })).json()).mine;
    // Every recorded night is tracked now, history included, so check one night at a time.
    const oweOn = async (jar, id) => (await mineFor(jar)).owe.find((entry) => entry.nightId === id)?.cents ?? 0;
    const owedOn = async (jar, id) => (await mineFor(jar)).owed.find((entry) => entry.nightId === id)?.cents ?? 0;

    expect((await api("/api/poker/live-session/start", { jar: owner, method: "POST" })).ok, "could not start");
    expect((await api("/api/poker/live-session/bank", { jar: guest, method: "PUT", body: { name: "Smoke Guest" } })).status === 403, "a member who is not the host set the bank");
    expect((await api("/api/poker/live-session/bank", { jar: owner, method: "PUT", body: { name: "Nobody Here" } })).status === 400, "a stranger was accepted as the bank");
    const banked = await api("/api/poker/live-session/bank", { jar: owner, method: "PUT", body: { name: "smoke guest" } });
    expect(banked.ok && (await banked.json()).bankName === "Smoke Guest", "the host could not choose the bank");

    expect((await add(owner, "buy_in", 20)).ok, "owner buy-in failed");
    expect((await add(owner, "buy_in", 10, "Smoke Guest")).ok, "guest buy-in failed");
    expect((await add(owner, "cash_out", 12)).ok, "owner cash-out failed");
    expect((await add(owner, "cash_out", 18, "Smoke Guest")).ok, "guest cash-out failed");
    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, "could not close");

    const role = await (await api("/api/poker/live-session/role", { jar: owner })).json();
    expect(role.status === "ended" && role.bankName === "Smoke Guest" && Number.isInteger(role.nightId), `role ${JSON.stringify(role)}`);
    const night = role.nightId;

    const before = await (await settlement(guest, night)).json();
    const pat = before.lines.find((line) => line.name === "Pat Imported");
    const gus = before.lines.find((line) => line.name === "Smoke Guest");
    expect(pat?.netCents === -800 && gus?.netCents === 800 && !pat.settled && !gus.settled, `lines ${JSON.stringify(before.lines)}`);
    expect(before.canSettle === true && before.state === "open", "the bank should be able to tick people off");
    let mine = await mineFor(owner);
    expect(mine.owe.some((entry) => entry.nightId === night && entry.cents === 800 && entry.bank === "Smoke Guest"), `owner owes ${JSON.stringify(mine)}`);
    expect((await owedOn(guest, night)) === 800, "the winner should be owed 8.00");

    expect((await settlement(rival, night)).status === 404, "another club read this night's settle-up");
    expect((await tick(rival, night, { name: "Pat Imported", settled: true })).status === 404, "another club ticked this night");
    expect((await tick(owner, night, { name: "Nobody Here", settled: true })).status === 400, "a stranger was ticked");
    expect((await tick(owner, night, { name: "Pat Imported" })).status === 400, "a tick without a state was accepted");

    const ticked = await tick(guest, night, { name: "pat imported", settled: true });
    expect(ticked.ok, `bank tick ${ticked.status}`);
    expect((await ticked.json()).state === "partial", "one tick of two should be partial");
    expect((await oweOn(owner, night)) === 0, "a settled player still owes");
    const summary = await (await api("/api/clubs/current/settle-up", { jar: owner })).json();
    expect(summary.nights.find((entry) => entry.nightId === night)?.state === "partial", "the Games list should show the night as partly settled");

    expect((await tick(owner, night, { all: true, settled: true })).ok, "the host could not mark everyone settled");
    expect((await (await settlement(owner, night)).json()).state === "settled", "the night should be settled");
    expect((await tick(owner, night, { name: "Pat Imported", settled: false })).ok, "the host could not untick");
    expect((await (await settlement(owner, night)).json()).state === "partial", "unticking should reopen the night");

    expect((await api("/api/poker/live-session/bank", { jar: guest, method: "PUT", body: { name: null } })).status === 403, "the bank cleared the bank without being host");
    const cleared = await api("/api/poker/live-session/bank", { jar: owner, method: "PUT", body: { name: null } });
    expect(cleared.ok && (await cleared.json()).bankName === null, "the host could not clear the bank");
    expect((await tick(guest, night, { name: "Pat Imported", settled: true })).status === 403, "someone who is neither host, bank nor admin ticked");

    expect((await api("/api/poker/live-session/reopen", { jar: owner, method: "POST" })).ok, "could not reopen");
    expect((await settlement(owner, night)).status === 404, "a reopened night kept its settle-up");
    expect((await oweOn(owner, night)) === 0, "a reopened night still shows as owed");
    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, "could not close again");
    const again = await (await api("/api/poker/live-session/role", { jar: owner })).json();
    expect((await oweOn(owner, again.nightId)) === 800, "closing again should ask for settling again");
  });

  await check("a night can be started for a past date and filled from notes by its host", async () => {
    const start = (jar, body) => api("/api/poker/live-session/start", { jar, method: "POST", body });
    const notes = (jar, players) => api("/api/poker/live-session/notes", { jar, method: "POST", body: { players } });
    expect((await start(owner, { date: "2999-01-01" })).status === 400, "a future night was accepted");
    expect((await start(owner, { date: "2026-02-30" })).status === 400, "an impossible date was accepted");
    expect((await start(owner, { date: "yesterday" })).status === 400, "a date that is not a date was accepted");

    const started = await start(owner, { date: "2026-02-14" });
    expect(started.status === 201, `start ${started.status}`);
    const snapshot = await started.json();
    expect(snapshot.sessionStatus === "open" && snapshot.sessionDate.slice(0, 10) === "2026-02-14", `snapshot ${snapshot.sessionStatus} ${snapshot.sessionDate}`);

    const players = [{ name: "Notes Ann", buyIn: "10", cashOut: "20" }, { name: "Notes Bo", buyIn: "20", cashOut: "10" }];
    expect((await notes(guest, players)).status === 403, "a member who is not the host filled the night from notes");
    expect((await notes(owner, [])).status === 400, "an empty notes list was accepted");
    expect((await notes(owner, [{ name: "Notes Ann", buyIn: "-5", cashOut: "0" }])).status === 400, "a negative amount was accepted");
    expect((await api("/api/clubs/current/sessions/notes-image", { jar: guest, method: "POST", body: { data: "x", mediaType: "image/jpeg" } })).status === 403, "a member who is not the host read a notes picture");
    const read = await api("/api/clubs/current/sessions/notes-image", { jar: owner, method: "POST", body: { data: "x", mediaType: "image/jpeg" } });
    expect([400, 503].includes(read.status), `the host was refused the picture reader (${read.status})`);

    const filled = await notes(owner, players);
    expect(filled.status === 201, `notes ${filled.status}`);
    const ledger = await filled.json();
    expect(ledger.entries.length === 4 && ledger.entries.every((entry) => entry.createdBy === "Pat Imported"), "notes entries should be logged by the host");
    expect(Math.abs(ledger.totals.buyIns - 30) < 0.001 && Math.abs(ledger.totals.cashOuts - 30) < 0.001, `totals ${JSON.stringify(ledger.totals)}`);

    expect((await api("/api/poker/live-session/end", { jar: guest, method: "POST" })).status === 403, "a member who is not the host closed the past night");
    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, "could not close the past night");
    const after = await (await api("/api/poker/live-activity", { jar: owner })).json();
    expect(after.sessionStatus === "ended" && after.sessionDate.slice(0, 10) === "2026-02-14", `after closing: ${after.sessionStatus} ${after.sessionDate}`);
    const dashboard = await (await api("/api/poker/dashboard", { jar: owner })).json();
    expect(dashboard.sessions.some((night) => night.date === "2026-02-14" && night.players.some((p) => p.player === "Notes Ann" && p.net === 10)), "the past night was not recorded under its own date");
    expect((await notes(owner, players)).status === 400, "notes were added with no open night");
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
    const a = cookieJar(), b = cookieJar(), outsider = cookieJar(), member = cookieJar();
    for (const [jar, name] of [[a, "Exp Orter"], [b, "Imp Orter"], [outsider, "Out Sider"], [member, "Mem Ber"]]) {
      await api("/api/identity/sign-up/email", { jar, method: "POST", headers: origin, body: { name, email: `${name.replace(/ /g, "").toLowerCase()}-${stamp}@example.com`, password } });
    }
    await api("/api/clubs", { jar: a, method: "POST", body: { name: `Export ${stamp}`, playerName: "Exp" } });
    await api("/api/clubs", { jar: b, method: "POST", body: { name: `Import ${stamp}`, playerName: "Imp" } });
    const invite = await api("/api/clubs/current/invites", { jar: a, method: "POST", body: {} });
    expect(invite.status === 201, `invite ${invite.status}`);
    const code = (await invite.json()).invite.code;
    expect((await api(`/api/invites/${code}/accept`, { jar: member, method: "POST", body: { name: "Mem Ber" } })).ok, "member could not join");

    const text = "Date,Player,Buy-in,Cash-out\n2026-03-03,Ann,20,35.5\n,\"Bo, Jr.\",20,4.5\n2026-03-10,Ann,10,0\n,\"Bo, Jr.\",10,20";
    expect((await api("/api/clubs/current/import", { jar: a, method: "POST", body: { text } })).ok, "seed import failed");
    const add = (action, amount, attributedPlayer) => api("/api/poker/live-activity", { jar: a, method: "POST", body: { action, amount, attributedPlayer } });
    expect((await api("/api/poker/live-session/start", { jar: a, method: "POST" })).ok, "could not start the jackpot night");
    expect((await add("buy_in", 10, "Exp")).ok, "jackpot buy-in failed");
    expect((await add("cash_out", 6, "Exp")).ok, "jackpot cash-out failed");
    expect((await api("/api/clubs/current/ledger/resolution", { jar: a, method: "PUT", body: { mode: "jackpot" } })).ok, "jackpot choice refused");
    expect((await api("/api/poker/live-session/end", { jar: a, method: "POST" })).ok, "jackpot night did not close");
    const paid = await api("/api/clubs/current/jackpot/payouts", { jar: a, method: "POST", body: { name: "Bo, Jr.", amount: 1.5 } });
    expect(paid.status === 201, `payout ${paid.status}`);
    const payoutAt = (await paid.json()).payouts[0].at;
    const payoutDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(payoutAt));

    const tournament = {
      date: "2026-10-04", title: "Export Freezeout", venue: "Hall, Room 2", buyIn: 10, bounty: 2.5, winnerKeepsBounty: true,
      shares: { first: 60, second: 40, third: 0 },
      players: [
        { name: "Ann", finishPlace: 1, entries: 1, knockouts: 1 },
        { name: "Bo, Jr.", finishPlace: 2, entries: 1, knockouts: 0 },
      ],
    };
    expect((await api("/api/clubs/current/tournaments", { jar: a, method: "POST", body: tournament })).status === 201, "could not record the tournament");
    const rivalOnly = { date: "2026-09-01", title: "Import Only", buyIn: 10, players: [{ name: "Imp", finishPlace: 1, entries: 1 }, { name: "Other", finishPlace: 2, entries: 1 }] };
    expect((await api("/api/clubs/current/tournaments", { jar: b, method: "POST", body: rivalOnly })).status === 201, "could not record the other club's tournament");

    const exported = await api("/api/clubs/current/export.csv", { jar: a });
    expect(exported.ok && /text\/csv/.test(exported.headers.get("content-type")), `export ${exported.status}`);
    const csv = await exported.text();
    expect(/attachment/.test(exported.headers.get("content-disposition") ?? "") && /-results\.csv/.test(exported.headers.get("content-disposition") ?? ""), "export should download as a file");
    const nights = await (await api("/api/clubs/current/sessions", { jar: a })).json();
    const jackpotNight = nights.sessions.find((night) => night.jackpot === 4);
    expect(jackpotNight, "the surplus night was not recorded");
    expect(csv.includes(`${jackpotNight.date},Bad Beat Jackpot,0.00,4.00,4.00`), "the surplus row is missing");
    expect(csv.includes(`${payoutDay},"Bad Beat Jackpot payout to Bo, Jr.",1.50,0.00,-1.50`), "the payout row is missing");
    expect(!csv.includes("Import Only") && !csv.includes(",Imp,"), "another club's data was in the cash export");
    const otherCash = await (await api("/api/clubs/current/export.csv", { jar: b })).text();
    expect(!otherCash.includes("Ann") && !otherCash.includes("Bad Beat Jackpot"), "this club's cash export included the other club");

    const copied = await api("/api/clubs/current/import", { jar: b, method: "POST", body: { text: csv } });
    expect(copied.status === 201 && (await copied.json()).imported === 3, "the export did not import cleanly");
    const original = await (await api("/api/poker/dashboard", { jar: a })).json();
    const copy = await (await api("/api/poker/dashboard", { jar: b })).json();
    const shape = (d) => JSON.stringify(d.leaderboard.map((p) => [p.name, p.profitTotal, p.gamesPlayed]));
    expect(shape(original) === shape(copy), `standings differ:\n${shape(original)}\n${shape(copy)}`);
    const copyPot = await (await api("/api/clubs/current/jackpot", { jar: b })).json();
    expect(copyPot.total === 0 && copyPot.payouts.length === 0, "importing the cash file recreated the jackpot");

    const log = await api("/api/clubs/current/tournaments/export/log.csv", { jar: a });
    const results = await api("/api/clubs/current/tournaments/export/results.csv", { jar: a });
    expect(log.ok && results.ok, `tournament export ${log.status}/${results.status}`);
    const logText = await log.text();
    const resultsText = await results.text();
    expect(logText.includes("Export Freezeout") && logText.includes("Hall, Room 2"), "the tournament log is missing the tournament");
    expect(resultsText.includes("Bo, Jr.") && !logText.includes("Import Only") && !resultsText.includes("Import Only"), "tournament export leaked the other club");
    const otherLog = await (await api("/api/clubs/current/tournaments/export/log.csv", { jar: b })).text();
    expect(otherLog.includes("Import Only") && !otherLog.includes("Export Freezeout"), "the other club's tournament export included this club");
    const brought = await api("/api/clubs/current/tournaments/import", { jar: b, method: "POST", body: { logText, resultsText } });
    expect(brought.status === 201 && (await brought.json()).imported === 1, "the tournament export did not import");
    const again = await (await api("/api/poker/dashboard", { jar: b })).json();
    const strip = (event) => { const { id, ...rest } = event; return rest; };
    const fromA = original.tournaments.find((event) => event.title === "Export Freezeout");
    const fromB = again.tournaments.find((event) => event.title === "Export Freezeout");
    expect(fromA && fromB && JSON.stringify(strip(fromA)) === JSON.stringify(strip(fromB)), "the imported tournament differs");

    for (const path of ["/api/clubs/current/export.csv", "/api/clubs/current/tournaments/export/log.csv", "/api/clubs/current/tournaments/export/results.csv"]) {
      expect((await api(path, { jar: member })).status === 401, `a member could download ${path}`);
      expect((await api(path, { jar: outsider })).status === 401, `a signed-in outsider could download ${path}`);
    }
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

  await check("the same month of two years is two separate months, and the old year and quarter filters are gone", async () => {
    const text = "Date,Player,Buy-in,Cash-out\n2024-10-05,Yr A,10,20\n,Yr B,10,0\n2026-10-03,Yr A,10,0\n,Yr B,10,20";
    const imported = await (await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text } })).json();
    expect(imported.imported === 2, `imported ${imported.imported}`);
    const dash = await (await api("/api/poker/dashboard", { jar: owner })).json();
    const keys = dash.months.map((m) => m.month);
    expect(keys.includes("2024-10") && keys.includes("2026-10"), `months ${keys.join(", ")}`);
    expect(dash.sessions.some((n) => n.date.startsWith("2024")) && dash.sessions.some((n) => n.date.startsWith("2026")), "both years should show");
    expect((await api("/api/clubs/current/years", { jar: owner })).status === 404, "the year route should be gone");
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
    expect((await api("/api/clubs/current/tournaments", { jar: guest, method: "POST", body })).status === 403, "a member who is not the host recorded a tournament");
    expect((await api("/api/poker/live-session/start", { jar: guest, method: "POST" })).ok, "guest could not start a night");
    const asHost = await api("/api/clubs/current/tournaments", { jar: guest, method: "POST", body: { ...body, title: "Host Freezeout" } });
    expect(asHost.status === 201, `host record ${asHost.status}`);
    const hostEvent = await asHost.json();
    expect((await api(`/api/clubs/current/tournaments/${hostEvent.id}`, { jar: owner, method: "DELETE" })).status === 204, "could not delete the host's tournament");
    expect((await api("/api/poker/live-session/end", { jar: guest, method: "POST" })).ok, "could not discard the empty night");
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
    const custom = await api("/api/clubs/current/settings", { jar: owner, method: "PUT", body: { points: { preset: "custom", rules: before.settings.points.rules } } });
    expect(custom.status === 400, `custom points should be refused, got ${custom.status}`);
    const saved = await api("/api/clubs/current/settings", {
      jar: owner, method: "PUT",
      body: { name: "Renamed Smoke Club", currency: "gbp", timezone: "America/Los_Angeles", guidelines: "# Rules\nBe kind.", points: { preset: "competitive" } },
    });
    expect(saved.ok, `save ${saved.status}`);
    const after = (await saved.json()).settings;
    expect(after.currency === "GBP" && after.timezone === "America/Los_Angeles", "settings were not stored");
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

console.log("\nSeeding a club for the browser walkthrough");

const viewerEmail = `viewer-${Date.now()}@example.com`;
const viewerPassword = "smoke-test-pass-9";
let dashboard;
{
  const viewer = cookieJar();
  const origin = { origin: BASE };
  await check("a club with a few nights and a tournament is ready to browse", async () => {
    expect((await api("/api/identity/sign-up/email", { jar: viewer, method: "POST", headers: origin, body: { name: "Vera Viewer", email: viewerEmail, password: viewerPassword } })).ok, "sign-up failed");
    expect((await api("/api/clubs", { jar: viewer, method: "POST", body: { name: "Browse Club", playerName: "Vera Viewer" } })).status === 201, "club not created");
    const night = (date, rows) => rows.map(([name, i, o], index) => `${index === 0 ? date : ""},${name},${i},${o}`).join("\n");
    const text = ["Date,Player,Buy-in,Cash-out",
      night("03/03/2026", [["Vera Viewer", 20, 60], ["Ann", 20, 0], ["Bo", 20, 20], ["Cy", 20, 0], ["Di", 20, 20]]),
      night("10/03/2026", [["Vera Viewer", 20, 10], ["Ann", 20, 50], ["Bo", 20, 0], ["Cy", 20, 40], ["Di", 20, 0]]),
      night("07/04/2026", [["Vera Viewer", 20, 0], ["Ann", 20, 30], ["Bo", 20, 40], ["Cy", 20, 10], ["Di", 20, 20]]),
    ].join("\n");
    const imported = await api("/api/clubs/current/import", { jar: viewer, method: "POST", body: { text } });
    expect(imported.ok, `import ${imported.status}`);
    const tournament = await api("/api/clubs/current/tournaments", { jar: viewer, method: "POST", body: {
      date: "2026-04-14", title: "Browse Freezeout", buyIn: 20,
      players: [["Vera Viewer", 1], ["Ann", 2], ["Bo", 3], ["Cy", 4]].map(([name, finishPlace]) => ({ name, finishPlace, entries: 1, knockouts: 0 })),
    } });
    expect(tournament.status === 201, `tournament ${tournament.status}`);
    dashboard = await (await api("/api/poker/dashboard", { jar: viewer })).json();
    expect(dashboard.leaderboard.length >= 4 && dashboard.sessions.length === 3, `seed produced ${dashboard.leaderboard.length} players, ${dashboard.sessions.length} nights`);
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

// The seeded nights are in past months, so Poker Wrapped opens by itself over the first page a member
// sees and swallows taps. Close it the way a person would, so every flow starts uncovered.
async function closeWrappedPopup(page) {
  await page.evaluateOnNewDocument(() => {
    setInterval(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog || !/Poker Wrapped/.test(dialog.textContent || "")) return;
      const close = [...dialog.querySelectorAll("button")].find((button) => /close/i.test(button.textContent || "") || /close/i.test(button.getAttribute("aria-label") || ""));
      close?.click();
    }, 200);
  });
}

async function newPage(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await closeWrappedPopup(page);
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
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await visible('[data-testid="input-email"]');
  await page.type('[data-testid="input-email"]', viewerEmail);
  await page.type('[data-testid="input-password"]', viewerPassword);
  await page.tap('[data-testid="button-account-submit"]');
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

await check("Home shows your summary, last game, monthly points and the profit podium", async () => {
  await sleep(1500);
  await visible('[data-testid="text-personal-net"]');
  await visible('[data-testid="card-my-night"]');
  await visible('[data-testid="card-home-monthly-points"]');
  await visible('[data-testid="card-home-standings"]');
  const homeOrder = await testIdsInOrder(/^(card-my-night|card-home-monthly-points|card-home-standings)$/);
  expect(homeOrder.join() === "card-my-night,card-home-monthly-points,card-home-standings", `Home order was ${homeOrder.join(", ")}`);
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="nav-bottom-tabs"] button')].map((button) => button.textContent.trim()),
  );
  expect(tabs.join(",") === "Home,Record,Leaderboard,Games,Me", `tabs were ${tabs.join(", ")}`);
  const gone = await page.evaluate(() => ({
    chart: !!document.querySelector('[data-testid="card-home-results"]'),
    tournament: !!document.querySelector('[data-testid="card-latest-tournament"]'),
    season: !!document.querySelector('[data-testid="card-season"]'),
    buzz: !!document.querySelector('[data-testid="card-club-buzz"]'),
    history: !!document.querySelector('[data-testid="button-show-history-chart"]'),
    banner: !!document.querySelector('[data-testid="banner-live-game"]'),
  }));
  expect(!gone.chart && !gone.tournament && !gone.season && !gone.buzz && !gone.history && !gone.banner, `Home still has extra cards ${JSON.stringify(gone)}`);
  const podiums = await page.evaluate(() => document.querySelectorAll('[data-testid="podium"]').length);
  expect(podiums === 2, `expected the monthly points and profit podiums, found ${podiums}`);
  await page.screenshot({ path: `${OUT}/home.png` });
});

await check("Home states your last tournament finish", async () => {
  const night = await page.$eval('[data-testid="card-my-night"]', (node) => node.innerText);
  expect(/your last tournament/i.test(night), `last game was not the tournament: ${night.replace(/\s+/g, " ").slice(0, 160)}`);
  expect(/1st of 4/.test(night), `finish line was ${night.match(/\d+(?:st|nd|rd|th) of \d+/)?.[0] ?? "missing"}`);
});

await check("a live night replaces the summary with the banner, and closing brings it back", async () => {
  const started = await page.evaluate(async () => {
    const response = await fetch("/api/poker/live-session/start", { method: "POST", credentials: "include" });
    return response.status;
  });
  expect(started === 200 || started === 201, `start returned ${started}`);
  await page.reload({ waitUntil: "networkidle2" });
  await visible('[data-testid="banner-live-game"]');
  await visible('[data-testid="card-home-standings"]');
  const hidden = await page.evaluate(() => ({
    summary: !!document.querySelector('[data-testid="text-personal-net"]'),
    night: !!document.querySelector('[data-testid="card-my-night"]'),
  }));
  expect(!hidden.summary && !hidden.night, `summary still showing ${JSON.stringify(hidden)}`);
  const ended = await page.evaluate(async () => {
    const response = await fetch("/api/poker/live-session/end", { method: "POST", credentials: "include" });
    return response.status;
  });
  expect(ended === 200, `close returned ${ended}`);
  await page.reload({ waitUntil: "networkidle2" });
  await visible('[data-testid="text-personal-net"]');
  await visible('[data-testid="card-my-night"]');
  const banner = await page.$('[data-testid="banner-live-game"]');
  expect(banner === null, "the live banner stayed after the empty night was discarded");
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
  await page.evaluate(() => document.querySelector('[data-testid^="card-tournament-club-"] button')?.click());
  await visible('[data-testid="section-tournament-detail"]');
  const rows = await page.evaluate(() => document.querySelectorAll('[data-testid="list-tournament-results"] li').length);
  expect(rows > 0, "no result rows");
  return `${rows} results`;
});

await check("leaderboard: both podiums, then the full tables, then the extras", async () => {
  await page.tap('[data-testid="tab-months"]');
  await visible('[data-testid="section-period-leaderboards"]');
  await visible('[data-testid="card-points-podium"]');
  const label = await page.$eval('[data-testid="text-leaderboard-label"]', (node) => node.textContent.trim());
  expect(label === "Leaderboard", `the table label was "${label}"`);
  const ids = await testIdsInOrder(/^(card-podium|card-points-podium|section-points-leaderboard|details-leaderboard-bars)$/);
  expect(
    ids.join() === "card-podium,card-points-podium,section-points-leaderboard,details-leaderboard-bars",
    `order was ${ids.join(", ")}`,
  );
  await visible('[data-testid="card-season"]');
  await visible('[data-testid="button-show-history-chart"]');
  const buzz = await page.$('[data-testid="card-club-buzz"]');
  expect(buzz === null, "club buzz should live on the Club tab");
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
  const title = await page.$eval('[data-testid="text-page-title-profile"]', (node) => node.textContent.trim());
  expect(title === "Profile", `profile title was "${title}"`);
  const order = await testIdsInOrder(/^(metric-player-profit|card-points-breakdown)$/);
  expect(order[0] === "metric-player-profit", `profit should come first: ${order.join(", ")}`);
});

await check("Live ledger and Club pages load", async () => {
  await page.tap('[data-testid="tab-live"]');
  await openTable(page);
  await visible('[data-testid="section-live-ledger"]');
  await page.tap('[data-testid="tab-account"]');
  await visible('[data-testid="button-me-rules"]');
  await page.tap('[data-testid="button-me-rules"]');
  await visible('[data-testid="section-guidelines"]');
  await visible('[data-testid="section-members"]');
  await visible('[data-testid="section-invites"]');
  await visible('[data-testid="button-copy-invite"]');
  await visible('[data-testid="button-share-invite"]');
  await visible('[data-testid="button-invite-qr"]');
  await visible('[data-testid="section-club-jackpot"]');
  await visible('[data-testid="card-club-buzz"]');
  const leakedAdmin = await page.$('[data-testid="section-admin"]');
  expect(leakedAdmin === null, "admin tools should not be on the Club tab");
  const clubOrder = await testIdsInOrder(/^(card-club-buzz|section-invites|section-guidelines|section-club-jackpot|section-members)$/);
  expect(
    clubOrder.join() === "card-club-buzz,section-invites,section-guidelines,section-club-jackpot,section-members",
    `Club order was ${clubOrder.join(", ")}`,
  );
  await page.tap('[data-testid="button-open-club-admin"]');
  await visible('[data-testid="section-admin"]');
  await visible('[data-testid="section-admin-people"]');
  await visible('[data-testid="section-admin-setup"]');
  await visible('[data-testid="section-admin-settings"]');
  await visible('[data-testid="section-admin-danger"]');
  await visible('[data-testid="section-import"]');
  await visible('[data-testid="section-import-tournaments"]');
  await visible('[data-testid="link-export-csv"]');
  await visible('[data-testid="link-export-tournament-log"]');
  await visible('[data-testid="link-export-tournament-results"]');
  await visible('[data-testid="section-delete-club"]');
  const dangerOpen = await page.$eval('[data-testid="section-admin-danger"]', (node) => node.open);
  expect(dangerOpen === false, "club danger should start collapsed");
  await page.tap('[data-testid="button-admin-back"]');
  await visible('[data-testid="button-reset-invite"]');
});

await check("Me loads from the avatar menu and has no admin tools", async () => {
  await page.tap('[data-testid="button-mobile-dashboard-menu"]');
  await visible('[data-testid="menu-open-account"]');
  const menuLabel = await page.$eval('[data-testid="menu-open-account"]', (node) => node.textContent);
  expect(/Me/.test(menuLabel) && !/admin/i.test(menuLabel), `menu label was ${menuLabel}`);
  await page.tap('[data-testid="menu-open-account"]');
  await visible('[data-testid="section-account"]');
  await visible('[data-testid="form-change-password"]');
  await visible('[data-testid="section-delete-account"]');
  await visible('[data-testid="section-switch-club"]');
  const leaked = await page.evaluate(() => ({
    admin: !!document.querySelector('[data-testid="section-admin"]'),
    reset: !!document.querySelector('[data-testid="button-reset-invite"]'),
    settings: !!document.querySelector('[data-testid="panel-club-settings"]'),
    setup: !!document.querySelector('[data-testid="panel-club-data"]'),
    deleteClub: !!document.querySelector('[data-testid="section-delete-club"]'),
    invites: !!document.querySelector('[data-testid="section-invites"]'),
  }));
  expect(!leaked.admin && !leaked.reset && !leaked.settings && !leaked.setup && !leaked.deleteClub && !leaked.invites, `Me still shows admin tools ${JSON.stringify(leaked)}`);
});

await check("a member sees Members and the invite, and cannot reset it or see Admin", async () => {
  const stamp = Date.now();
  const owner = cookieJar();
  const member = cookieJar();
  const origin = { origin: BASE };
  const password = "smoke-test-pass-9";
  const email = `ned-${stamp}@example.com`;
  expect((await api("/api/identity/sign-up/email", { jar: owner, method: "POST", headers: origin, body: { name: "Ada Admin", email: `ada-${stamp}@example.com`, password } })).ok, "owner sign-up failed");
  expect((await api("/api/clubs", { jar: owner, method: "POST", body: { name: `Member View ${stamp}`, playerName: "Ada Admin" } })).status === 201, "club not created");
  const shared = await (await api("/api/clubs/current/invite", { jar: owner })).json();
  const code = shared.invites.find((invite) => invite.usable)?.code;
  expect(code, "the new club has no invite link");
  expect((await api("/api/identity/sign-up/email", { jar: member, method: "POST", headers: origin, body: { name: "Ned Member", email, password } })).ok, "member sign-up failed");
  expect((await api(`/api/invites/${code}/accept`, { jar: member, method: "POST", body: { name: "Ned Member" } })).ok, "member could not join");

  const context = await browser.createBrowserContext();
  const phone = await context.newPage();
  await closeWrappedPopup(phone);
  await phone.setViewport(PHONE);
  phone.on("pageerror", (error) => pageErrors.push(error.message));
  const wait = (selector) => phone.waitForSelector(selector, { timeout: 15000 });
  await phone.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await wait('[data-testid="input-email"]');
  await phone.type('[data-testid="input-email"]', email);
  await phone.type('[data-testid="input-password"]', password);
  await phone.tap('[data-testid="button-account-submit"]');
  await wait('[data-testid="tab-account"]');
  // Home is still filling in right after sign-in and can swallow the first tap, so retry it.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await phone.tap('[data-testid="tab-account"]');
    try {
      await phone.waitForSelector('[data-testid="button-me-rules"]', { timeout: 5000 });
      break;
    } catch {
      /* tap again */
    }
  }
  await wait('[data-testid="button-me-rules"]');
  await phone.tap('[data-testid="button-me-rules"]');
  await wait('[data-testid="section-members"]');
  await wait('[data-testid="button-copy-invite"]');
  await wait('[data-testid="button-invite-qr"]');
  const club = await phone.evaluate(() => ({
    reset: !!document.querySelector('[data-testid="button-reset-invite"]'),
    admin: !!document.querySelector('[data-testid="section-admin"]') || !!document.querySelector('[data-testid="button-open-club-admin"]'),
    copy: !!document.querySelector('[data-testid="button-copy-invite"]'),
    share: !!document.querySelector('[data-testid="button-share-invite"]'),
    members: !!document.querySelector('[data-testid="section-members"]'),
    settings: !!document.querySelector('[data-testid="panel-club-settings"]'),
    setup: !!document.querySelector('[data-testid="panel-club-data"]'),
  }));
  expect(club.copy && club.share && club.members, "a member cannot see Members or the invite");
  expect(!club.reset && !club.admin && !club.settings && !club.setup, `a member sees admin tools ${JSON.stringify(club)}`);
  await phone.tap('[data-testid="button-mobile-dashboard-menu"]');
  await wait('[data-testid="menu-open-account"]');
  await phone.tap('[data-testid="menu-open-account"]');
  await wait('[data-testid="section-account"]');
  await wait('[data-testid="section-delete-account"]');
  const mine = await phone.evaluate(() => ({
    admin: !!document.querySelector('[data-testid="section-admin"]'),
    reset: !!document.querySelector('[data-testid="button-reset-invite"]'),
    settings: !!document.querySelector('[data-testid="panel-club-settings"]'),
  }));
  expect(!mine.admin && !mine.reset && !mine.settings, `Me shows admin items ${JSON.stringify(mine)}`);
  await context.close();
});

await check("a club owner does not see site usage, and the old admin page is gone", async () => {
  const context = await browser.createBrowserContext();
  const adminPage = await context.newPage();
  await adminPage.setViewport({ width: 1280, height: 900 });
  adminPage.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await adminPage.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await adminPage.waitForSelector('[data-testid="input-email"]');
    await adminPage.type('[data-testid="input-email"]', viewerEmail);
    await adminPage.type('[data-testid="input-password"]', viewerPassword);
    await adminPage.click('[data-testid="button-account-submit"]');
    await adminPage.waitForSelector('[data-testid="button-open-account"]', { timeout: 15000 });
    const link = await adminPage.$('[data-testid="link-platform-usage"]');
    expect(!link, "a club owner should not see the usage link");
    await adminPage.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
    await adminPage.waitForSelector("h1", { timeout: 15000 });
    const state = await adminPage.evaluate(() => ({
      text: document.body.innerText,
      usage: !!document.querySelector('[data-testid="section-platform-usage"]'),
      health: !!document.querySelector('[data-testid="section-admin-health"]'),
      danger: !!document.querySelector('[data-testid="section-admin-danger"]'),
    }));
    expect(/404/.test(state.text), "a club owner should get a not-found page");
    expect(!state.usage && !state.health && !state.danger, "the old admin page is still there");
    await adminPage.screenshot({ path: `${OUT}/admin-denied.png` });
  } finally {
    await context.close();
  }
});

await check("the platform owner sees usage across clubs and cannot change them from the page", async () => {
  const platformEmail = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",")[0].trim().toLowerCase();
  expect(platformEmail.includes("@"), "start the API with PLATFORM_ADMIN_EMAILS set, and pass the same value to smoke");
  const origin = { origin: BASE };
  const password = "smoke-test-pass-9";
  const viewer = cookieJar();
  expect((await api("/api/identity/sign-in/email", { jar: viewer, method: "POST", headers: origin, body: { email: viewerEmail, password: viewerPassword } })).ok, "viewer sign-in failed");
  expect((await api("/api/poker/usage", { jar: viewer, method: "POST", body: { section: "live", pageView: true, activeSeconds: 15 } })).status === 202, "could not record usage");

  const owner = cookieJar();
  const signedUp = await api("/api/identity/sign-up/email", {
    jar: owner, method: "POST", headers: origin,
    body: { name: "Platform Owner", email: platformEmail, password },
  });
  if (!signedUp.ok) {
    expect((await api("/api/identity/sign-in/email", { jar: owner, method: "POST", headers: origin, body: { email: platformEmail, password } })).ok, `platform sign-in ${signedUp.status}`);
  }
  const mine = await api("/api/clubs/me", { jar: owner });
  const hasClub = mine.ok && ((await mine.clone().json()).clubs ?? []).length > 0;
  if (!hasClub) {
    expect((await api("/api/clubs", { jar: owner, method: "POST", body: { name: "Platform Club", playerName: "Platform Owner" } })).status === 201, "platform club not created");
  }
  const usage = await api("/api/platform/usage", { jar: owner });
  expect(usage.status === 200, `platform usage ${usage.status}`);
  const payload = await usage.json();
  expect(payload.clubs.some((club) => club.name === "Browse Club"), "usage did not include the other club");
  expect(!JSON.stringify(payload).includes("@"), "usage included an email address");
  const browse = payload.clubs.find((club) => club.name === "Browse Club");
  const vera = browse.members.find((member) => member.name === "Vera Viewer");
  expect(vera && vera.sections.some((section) => section.section === "live" && section.activeSeconds >= 15), "the other club's Live time is missing");

  const context = await browser.createBrowserContext();
  const phone = await context.newPage();
  await closeWrappedPopup(phone);
  await phone.setViewport(PHONE);
  phone.on("pageerror", (error) => pageErrors.push(error.message));
  try {
  await phone.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await phone.waitForSelector('[data-testid="input-email"]');
  await phone.type('[data-testid="input-email"]', platformEmail);
  await phone.type('[data-testid="input-password"]', password);
  await phone.tap('[data-testid="button-account-submit"]');
  await phone.waitForSelector('[data-testid="link-platform-usage"], [data-testid="button-mobile-dashboard-menu"]', { timeout: 15000 });
  if (await phone.$('[data-testid="button-mobile-dashboard-menu"]')) {
    await phone.tap('[data-testid="button-mobile-dashboard-menu"]');
    await phone.waitForSelector('[data-testid="menu-platform-usage"]');
  } else {
    expect(await phone.$('[data-testid="link-platform-usage"]'), "an empty club should still show the usage link");
  }
  await phone.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await phone.waitForSelector('[data-testid="section-platform-usage"]', { timeout: 15000 });
  const pageState = await phone.evaluate(() => ({
    clubs: [...document.querySelectorAll("[data-testid^=text-platform-club-]")].map((node) => node.textContent),
    note: document.querySelector('[data-testid="text-platform-readonly"]')?.textContent ?? "",
    forms: document.querySelectorAll("form").length,
    buttons: [...document.querySelectorAll("button")].map((node) => node.textContent ?? ""),
    danger: !!document.querySelector('[data-testid="section-admin-danger"]'),
    text: document.body.innerText,
  }));
  expect(pageState.clubs.includes("Browse Club"), `clubs on the page: ${pageState.clubs.join(", ")}`);
  expect(/View only/.test(pageState.note), "the page should say it is view only");
  expect(pageState.text.includes("Vera Viewer") && /Live/.test(pageState.text), "the other club's member and section are missing");
  expect(!pageState.text.includes(viewerEmail), "the page shows an email address");
  expect(pageState.forms === 0 && !pageState.danger, "the usage page still has the old admin tools");
  expect(!pageState.buttons.some((label) => /delete|reset|save|merge|import/i.test(label)), `unexpected controls: ${pageState.buttons.join(" | ")}`);
  await phone.screenshot({ path: `${OUT}/platform-usage.png`, fullPage: true });
  } finally {
    await context.close();
  }
});

await check("settle-up shows on Home, in Live and on the Games card, and ticking updates all three", async () => {
  const sam = cookieJar();
  const origin = { origin: BASE };
  const email = `settle-${Date.now()}@example.com`;
  const secret = "smoke-test-pass-9";
  expect((await api("/api/identity/sign-up/email", { jar: sam, method: "POST", headers: origin, body: { name: "Sam Settle", email, password: secret } })).ok, "sign-up failed");
  expect((await api("/api/clubs", { jar: sam, method: "POST", body: { name: "Settle Club", playerName: "Sam Settle" } })).status === 201, "club not created");
  expect((await api("/api/poker/live-session/start", { jar: sam, method: "POST" })).ok, "could not start");
  expect((await api("/api/poker/live-activity", { jar: sam, method: "POST", body: { action: "buy_in", amount: 10 } })).ok, "buy-in failed");
  expect((await api("/api/poker/live-activity", { jar: sam, method: "POST", body: { action: "buy_in", amount: 10, attributedPlayer: "Ivy" } })).ok, "second buy-in failed");
  expect((await api("/api/poker/live-activity", { jar: sam, method: "POST", body: { action: "cash_out", amount: 5 } })).ok, "cash-out failed");
  expect((await api("/api/poker/live-activity", { jar: sam, method: "POST", body: { action: "cash_out", amount: 15, attributedPlayer: "Ivy" } })).ok, "second cash-out failed");
  expect((await api("/api/poker/live-session/bank", { jar: sam, method: "PUT", body: { name: "Ivy" } })).ok, "bank not set");
  expect((await api("/api/poker/live-session/end", { jar: sam, method: "POST" })).ok, "could not close");

  const context = await browser.createBrowserContext();
  const phone = await context.newPage();
  await closeWrappedPopup(phone);
  await phone.setViewport(PHONE);
  phone.on("pageerror", (error) => pageErrors.push(error.message));
  phone.on("response", (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
  const wait = (selector) => phone.waitForSelector(selector, { timeout: 15000 });
  const text = (selector) => phone.$eval(selector, (node) => node.innerText);
  await phone.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await wait('[data-testid="input-email"]');
  await phone.type('[data-testid="input-email"]', email);
  await phone.type('[data-testid="input-password"]', secret);
  await phone.tap('[data-testid="button-account-submit"]');

  await wait('[data-testid="card-settle-up"]');
  expect(/You owe\s*\$5\.00/.test(await text('[data-testid="text-settle-owe"]')), "Home should say you owe $5.00");
  await phone.screenshot({ path: `${OUT}/settle-home.png` });

  await phone.tap('[data-testid="tab-live"]');
  await openTable(phone);
  await wait('[data-testid="section-settle-list"]');
  expect(/Bank: Ivy/.test(await text('[data-testid="text-settle-bank"]')), "the settle list should name the bank");
  await phone.screenshot({ path: `${OUT}/settle-live.png`, fullPage: true });
  const ticks = await phone.$$eval('[data-testid^="checkbox-settled-"]', (nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  expect(ticks.length === 2, `expected two ticks, found ${ticks.length}`);
  const mine = await phone.evaluateHandle(() => [...document.querySelectorAll('[data-testid^="row-settle-"]')].find((row) => /Sam Settle/.test(row.innerText)));
  await (await mine.asElement().$('button[role="checkbox"]')).tap();
  await phone.waitForFunction(() => /Settled/.test([...document.querySelectorAll('[data-testid^="row-settle-"]')].find((row) => /Sam Settle/.test(row.innerText))?.innerText ?? ""), { timeout: 15000 });
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sideways <= 1, `the Live page scrolls sideways on a phone (${sideways}px)`);

  await phone.tap('[data-testid="tab-sessions"]');
  await wait('[data-testid="badge-settle-1"]');
  await phone.waitForFunction(() => /1 to settle/.test(document.querySelector('[data-testid="badge-settle-1"]')?.innerText ?? ""), { timeout: 15000 });

  await phone.tap('[data-testid="tab-live"]');
  await openTable(phone);
  await wait('[data-testid="button-settle-all"]');
  await phone.tap('[data-testid="button-settle-all"]');
  await phone.waitForFunction(() => /Everyone has settled/.test(document.body.innerText), { timeout: 15000 });
  await phone.tap('[data-testid="tab-sessions"]');
  await phone.waitForFunction(() => /Settled/.test(document.querySelector('[data-testid="badge-settle-1"]')?.innerText ?? ""), { timeout: 15000 });
  // Catching up a night: pick a past date on Live, then fill the night from pasted notes.
  // Scrolled to the middle first so the fixed tab bar is never on top of what is tapped.
  const tapCentered = async (selector) => {
    await phone.$eval(selector, (node) => node.scrollIntoView({ block: "center" }));
    await phone.tap(selector);
  };
  await phone.tap('[data-testid="tab-live"]');
  await openTable(phone);
  await wait('[data-testid="input-live-night-date"]');
  await phone.$eval('[data-testid="input-live-night-date"]', (node) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(node, "2026-01-10");
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait('[data-testid="button-start-live-session"]');
  await tapCentered('[data-testid="button-start-live-session"]');
  await wait('[data-testid="text-live-night-date"]');
  expect(/10 Jan 2026/.test(await text('[data-testid="text-live-night-date"]')), "the past night's date should show on Live");
  await wait('[data-testid="box-night-notes"]');
  await tapCentered('[data-testid="box-night-notes"] summary');
  await phone.type('[data-testid="input-night-notes"]', "Sam Settle - $10 -> $25\nIvy - $25 -> $10");
  await tapCentered('[data-testid="button-night-notes-fill"]');
  await phone.waitForSelector('[data-testid="table-night-notes"]', { timeout: 8000 }).catch(async () => {
    await phone.screenshot({ path: `${OUT}/live-notes-failed.png`, fullPage: true });
    throw new Error(`notes were not read: ${await phone.$eval('[data-testid="status-night-notes"]', (n) => n.innerText).catch(() => "no status shown")}`);
  });
  await tapCentered('[data-testid="button-notes-add"]');
  await phone.waitForFunction(() => /Added 2 players to the ledger/.test(document.body.innerText), { timeout: 15000 });
  await phone.waitForFunction(() => /4 entries/.test(document.querySelector('[data-testid="section-live-activity"]')?.innerText ?? ""), { timeout: 15000 });
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide <= 1, `the Live page scrolls sideways on a phone (${wide}px)`);
  await phone.screenshot({ path: `${OUT}/live-notes.png`, fullPage: true });
  await context.close();
});

await check("a jackpot payout and a tournament can be recorded from the Live tab", async () => {
  const jar = cookieJar();
  const origin = { origin: BASE };
  const email = `payout-${Date.now()}@example.com`;
  const secret = "smoke-test-pass-9";
  expect((await api("/api/identity/sign-up/email", { jar, method: "POST", headers: origin, body: { name: "Ada Payout", email, password: secret } })).ok, "sign-up failed");
  expect((await api("/api/clubs", { jar, method: "POST", body: { name: "Payout Club", playerName: "Ada Payout" } })).status === 201, "club not created");
  expect((await api("/api/poker/live-session/start", { jar, method: "POST" })).ok, "could not start");
  expect((await api("/api/poker/live-activity", { jar, method: "POST", body: { action: "buy_in", amount: 10 } })).ok, "buy-in failed");
  expect((await api("/api/poker/live-activity", { jar, method: "POST", body: { action: "cash_out", amount: 6 } })).ok, "cash-out failed");
  expect((await api("/api/clubs/current/ledger/resolution", { jar, method: "PUT", body: { mode: "jackpot" } })).ok, "jackpot choice refused");
  expect((await api("/api/poker/live-session/end", { jar, method: "POST" })).ok, "could not close");

  const context = await browser.createBrowserContext();
  const phone = await context.newPage();
  await closeWrappedPopup(phone);
  try {
    await phone.setViewport(PHONE);
    phone.on("pageerror", (error) => pageErrors.push(error.message));
    phone.on("response", (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    const wait = (selector) => phone.waitForSelector(selector, { timeout: 15000 });
    // A control at the bottom of a long page can sit under the fixed tab bar, so scroll it clear and fall back to a DOM click.
    const press = async (selector) => {
      await wait(selector);
      await phone.evaluate((sel) => {
        const node = document.querySelector(sel);
        node.scrollIntoView({ block: "center" });
        const bar = document.querySelector('[data-testid="nav-bottom-tabs"]');
        const rect = node.getBoundingClientRect();
        const limit = bar ? bar.getBoundingClientRect().top - 16 : window.innerHeight - 16;
        if (rect.bottom > limit) window.scrollBy(0, rect.bottom - limit);
      }, selector);
      try {
        await phone.tap(selector);
      } catch {
        await phone.$eval(selector, (node) => node.click());
      }
    };
    await phone.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await wait('[data-testid="input-email"]');
    await phone.type('[data-testid="input-email"]', email);
    await phone.type('[data-testid="input-password"]', secret);
    await press('[data-testid="button-account-submit"]');
    await wait('[data-testid="section-home-overview"]');
    await press('[data-testid="tab-live"]');
    await wait('[data-testid="text-jackpot-total"]');
    await phone.waitForFunction(() => /4\.00/.test(document.querySelector('[data-testid="text-jackpot-total"]')?.textContent ?? ""), { timeout: 15000 });
    await press('[data-testid="button-jackpot-open"]');
    await wait('[data-testid="form-jackpot-payout"]');
    await phone.select('[data-testid="input-jackpot-player"]', "Ada Payout");
    // Scrolled to the middle first so the fixed tab bar is never on top of what is tapped.
    await phone.$eval('[data-testid="input-jackpot-amount"]', (node) => node.scrollIntoView({ block: "center" }));
    await phone.click('[data-testid="input-jackpot-amount"]');
    await phone.type('[data-testid="input-jackpot-amount"]', "1");
    await press('[data-testid="button-jackpot-payout"]');
    await phone.waitForFunction(() => /3\.00/.test(document.querySelector('[data-testid="text-jackpot-total"]')?.textContent ?? ""), { timeout: 15000 });
    await press('[data-testid="button-jackpot-history"]');
    await phone.waitForFunction(() => /Ada Payout/.test(document.querySelector('[data-testid="list-jackpot-history"]')?.innerText ?? ""), { timeout: 15000 });
    const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sideways <= 1, `the jackpot card scrolls sideways on a phone (${sideways}px)`);

    await openTable(phone);
    await press('[data-testid="button-new-tournament"]');
    await wait('[data-testid="section-record-tournament"]');
    // Keystrokes into a field below the fold can miss the React input in headless Chrome.
    // Set the value the same way the date field is set, then click Save directly.
    const fill = (selector, value) => phone.$eval(selector, (node, next) => {
      node.scrollIntoView({ block: "center" });
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(node, next);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await fill('[data-testid="input-tournament-title"]', "Friday Freezeout");
    await fill('[data-testid="input-tournament-buyin"]', "10");
    await fill('[data-testid="input-tournament-name-0"]', "Ada Payout");
    await fill('[data-testid="input-tournament-name-1"]', "Bo Payout");
    const saveState = await phone.$eval('[data-testid="button-tournament-save"]', (node) => {
      node.scrollIntoView({ block: "center" });
      if (node.disabled) {
        const read = (sel) => document.querySelector(sel)?.value ?? "";
        return `save stayed disabled (title "${read('[data-testid="input-tournament-title"]')}", buy-in "${read('[data-testid="input-tournament-buyin"]')}", names "${read('[data-testid="input-tournament-name-0"]')}" / "${read('[data-testid="input-tournament-name-1"]')}")`;
      }
      node.click();
      return "";
    });
    expect(saveState === "", saveState);
    await phone.waitForFunction(() => {
      const saved = document.querySelector('[data-testid="status-tournament-saved"]')?.innerText ?? "";
      const failed = document.querySelector('[data-testid="status-tournament-error"]')?.innerText ?? "";
      return /Tournament recorded/.test(saved) || failed.length > 0;
    }, { timeout: 15000 });
    const tournamentError = await phone.$eval('[data-testid="status-tournament-error"]', (node) => node.innerText).catch(() => "");
    expect(tournamentError === "", `tournament save failed: ${tournamentError}`);
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide <= 1, `the tournament form scrolls sideways on a phone (${wide}px)`);
    await phone.screenshot({ path: `${OUT}/live-jackpot-tournament.png`, fullPage: true });

    await phone.evaluate(() => window.scrollTo(0, 0));
    await press('[data-testid="tab-account"]');
    await press('[data-testid="button-me-rules"]');
    await press('[data-testid="button-open-club-admin"]');
    await wait('[data-testid="section-admin-setup"]');
    await wait('[data-testid="section-import"]');
    await wait('[data-testid="section-import-tournaments"]');
    await wait('[data-testid="link-export-csv"]');
    await wait('[data-testid="link-export-tournament-log"]');
    await wait('[data-testid="link-export-tournament-results"]');
    const moved = await phone.$('[data-testid="section-record-tournament"]');
    expect(moved === null, "the tournament form should stay off the admin Setup page");
    await press('[data-testid="button-mobile-dashboard-menu"]');
    await wait('[data-testid="menu-open-account"]');
    await press('[data-testid="menu-open-account"]');
    await wait('[data-testid="section-account"]');
    const onMe = await phone.$('[data-testid="section-import-tournaments"]');
    expect(onMe === null, "tournament CSV import should live in Club admin Setup, not on Me");
  } catch (error) {
    await phone.screenshot({ path: `${OUT}/live-jackpot-tournament-failed.png`, fullPage: true }).catch(() => undefined);
    const where = await phone.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => "");
    throw new Error(`${error.message}\n${where}`);
  } finally {
    await context.close();
  }
});

await check("an admin can preview and merge two names; a member cannot, and another club cannot", async () => {
  const origin = { origin: BASE };
  const secret = "smoke-test-pass-9";
  const stamp = Date.now();
  const owner = cookieJar();
  const member = cookieJar();
  const rival = cookieJar();
  const ownerEmail = `merge-${stamp}@example.com`;
  expect((await api("/api/identity/sign-up/email", { jar: owner, method: "POST", headers: origin, body: { name: "Nia Merge", email: ownerEmail, password: secret } })).ok, "owner sign-up failed");
  expect((await api("/api/clubs", { jar: owner, method: "POST", body: { name: `Merge Club ${stamp}`, playerName: "Nia Merge" } })).status === 201, "club not created");
  expect((await api("/api/clubs/current/players/merge", { method: "POST", body: { keep: "Ann", merge: "Ann Typo" } })).status === 401, "signed-out merge should be 401");

  expect((await api("/api/identity/sign-up/email", { jar: member, method: "POST", headers: origin, body: { name: "Guest Merge", email: `merge-guest-${stamp}@example.com`, password: secret } })).ok, "member sign-up failed");
  const invite = await api("/api/clubs/current/invites", { jar: owner, method: "POST", body: {} });
  expect(invite.status === 201, `invite ${invite.status}`);
  const code = (await invite.json()).invite.code;
  expect((await api(`/api/invites/${code}/accept`, { jar: member, method: "POST", body: { name: "Guest Merge" } })).ok, "member could not join");
  expect((await api("/api/clubs/current/players/merge", { jar: member, method: "POST", body: { keep: "Ann", merge: "Ann Typo" } })).status === 403, "a member should get 403");

  const history = ["Date,Player,Buy-in,Cash-out", "2026-02-02,Ann,20,30", ",Ann Typo,10,0", ",Nia Merge,10,10"].join("\n");
  const imported = await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text: history } });
  expect(imported.status === 201, `import ${imported.status} ${await imported.text()}`);
  const before = await (await api("/api/poker/dashboard", { jar: owner })).json();
  const profit = (data, name) => data.leaderboard.find((player) => player.name === name)?.profitTotal ?? null;
  expect(profit(before, "Ann") === 10 && profit(before, "Ann Typo") === -10, "imported profits were not what the merge check expects");

  expect((await api("/api/identity/sign-up/email", { jar: rival, method: "POST", headers: origin, body: { name: "Rival Merge", email: `merge-rival-${stamp}@example.com`, password: secret } })).ok, "rival sign-up failed");
  expect((await api("/api/clubs", { jar: rival, method: "POST", body: { name: `Rival Merge ${stamp}`, playerName: "Rival Merge" } })).status === 201, "rival club not created");
  expect((await api("/api/clubs/current/players/merge/preview", { jar: rival, method: "POST", body: { keep: "Ann", merge: "Ann Typo" } })).status === 404, "a name from another club should be 404");

  const preview = await api("/api/clubs/current/players/merge/preview", { jar: owner, method: "POST", body: { keep: "Ann", merge: "Ann Typo" } });
  const shown = await preview.json();
  expect(preview.status === 200, `preview ${preview.status} ${JSON.stringify(shown)}`);
  expect(shown.irreversible === true && shown.nights === 1 && shown.nightsCombined === 1, `preview counts ${JSON.stringify(shown)}`);
  const still = await (await api("/api/poker/dashboard", { jar: owner })).json();
  expect(profit(still, "Ann Typo") === -10, "preview should not move any history");

  const context = await browser.createBrowserContext();
  const phone = await context.newPage();
  await closeWrappedPopup(phone);
  try {
    await phone.setViewport(PHONE);
    phone.on("pageerror", (error) => pageErrors.push(error.message));
    phone.on("response", (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    const wait = (selector) => phone.waitForSelector(selector, { timeout: 15000 });
    const press = async (selector) => {
      await wait(selector);
      await phone.evaluate((sel) => {
        const node = document.querySelector(sel);
        node.scrollIntoView({ block: "center" });
        const bar = document.querySelector('[data-testid="nav-bottom-tabs"]');
        const rect = node.getBoundingClientRect();
        const limit = bar ? bar.getBoundingClientRect().top - 16 : window.innerHeight - 16;
        if (rect.bottom > limit) window.scrollBy(0, rect.bottom - limit);
      }, selector);
      try {
        await phone.tap(selector);
      } catch {
        await phone.$eval(selector, (node) => node.click());
      }
    };
    await phone.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await wait('[data-testid="input-email"]');
    await phone.type('[data-testid="input-email"]', ownerEmail);
    await phone.type('[data-testid="input-password"]', secret);
    await press('[data-testid="button-account-submit"]');
    await wait('[data-testid="section-home-overview"]');
    await press('[data-testid="tab-account"]');
    await press('[data-testid="button-me-rules"]');
    await press('[data-testid="button-open-club-admin"]');
    await wait('[data-testid="section-admin-people"]');
    const peopleOpen = await phone.$eval('[data-testid="section-admin-people"]', (node) => node.open);
    if (!peopleOpen) await press('[data-testid="section-admin-people"] summary');
    await wait('[data-testid="select-merge-keep"]');
    await phone.select('[data-testid="select-merge-keep"]', "Ann");
    await phone.select('[data-testid="select-merge-into"]', "Ann Typo");
    await press('[data-testid="button-merge-preview"]');
    await wait('[data-testid="text-merge-irreversible"]');
    const warning = await phone.$eval('[data-testid="text-merge-irreversible"]', (node) => node.innerText);
    expect(/cannot be undone/i.test(warning), `preview should say the merge is irreversible, saw "${warning}"`);
    const previewText = await phone.$eval('[data-testid="list-merge-preview"]', (node) => node.innerText);
    expect(/1 recorded night/.test(previewText) && /added together/.test(previewText), `preview list was "${previewText}"`);
    await phone.screenshot({ path: `${OUT}/merge-preview.png`, fullPage: true });
    await press('[data-testid="button-merge-confirm"]');
    await wait('[data-testid="status-merge-done"]');
    const done = await phone.$eval('[data-testid="status-merge-done"]', (node) => node.innerText);
    expect(/Ann Typo is now part of Ann/.test(done), `done message was "${done}"`);
    await phone.waitForFunction(() => ![...document.querySelectorAll('[data-testid="select-merge-into"] option')].some((node) => node.value === "Ann Typo"), { timeout: 15000 });
    const options = await phone.$$eval('[data-testid="select-merge-into"] option', (nodes) => nodes.map((node) => node.value));
    expect(!options.includes("Ann Typo"), "the merged name should leave the list");
    const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sideways <= 1, `the Club page scrolls sideways on a phone (${sideways}px)`);
    await phone.screenshot({ path: `${OUT}/merge-done.png`, fullPage: true });
  } catch (error) {
    await phone.screenshot({ path: `${OUT}/merge-failed.png`, fullPage: true }).catch(() => undefined);
    const where = await phone.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "");
    throw new Error(`${error.message}\n${where}`);
  } finally {
    await context.close();
  }

  const after = await (await api("/api/poker/dashboard", { jar: owner })).json();
  const sum = (data) => data.leaderboard.reduce((total, player) => total + player.profitTotal, 0);
  expect(after.totals.totalBuyIn === before.totals.totalBuyIn && after.totals.totalCashOut === before.totals.totalCashOut, "club buy-in or cash-out changed");
  expect(sum(after) === sum(before), "leaderboard profit no longer adds up");
  expect(profit(after, "Ann") === 0 && profit(after, "Ann Typo") === null && profit(after, "Nia Merge") === 0, `profits after merge ${JSON.stringify(after.leaderboard.map((player) => [player.name, player.profitTotal]))}`);
  const rivalBoard = await (await api("/api/poker/dashboard", { jar: rival })).json();
  expect(rivalBoard.leaderboard.length === 0, "the other club should still be empty");
});

await check("an admin edits and deletes games from the Games tab; a member cannot", async () => {
  const origin = { origin: BASE };
  const secret = "smoke-test-pass-9";
  const stamp = Date.now();
  const owner = cookieJar();
  const member = cookieJar();
  const rival = cookieJar();
  const ownerEmail = `games-${stamp}@example.com`;
  const memberEmail = `games-member-${stamp}@example.com`;
  expect((await api("/api/identity/sign-up/email", { jar: owner, method: "POST", headers: origin, body: { name: "Ada Games", email: ownerEmail, password: secret } })).ok, "owner sign-up failed");
  expect((await api("/api/clubs", { jar: owner, method: "POST", body: { name: `Games Club ${stamp}`, playerName: "Ada Games" } })).status === 201, "club not created");
  expect((await api("/api/identity/sign-up/email", { jar: member, method: "POST", headers: origin, body: { name: "Bo Games", email: memberEmail, password: secret } })).ok, "member sign-up failed");
  const invite = await api("/api/clubs/current/invites", { jar: owner, method: "POST", body: {} });
  expect(invite.status === 201, `invite ${invite.status}`);
  expect((await api(`/api/invites/${(await invite.json()).invite.code}/accept`, { jar: member, method: "POST", body: { name: "Bo Games" } })).ok, "member could not join");
  expect((await api("/api/identity/sign-up/email", { jar: rival, method: "POST", headers: origin, body: { name: "Rival Games", email: `games-rival-${stamp}@example.com`, password: secret } })).ok, "rival sign-up failed");
  expect((await api("/api/clubs", { jar: rival, method: "POST", body: { name: `Rival Games ${stamp}`, playerName: "Rival Games" } })).status === 201, "rival club not created");

  const history = ["Date,Player,Buy-in,Cash-out", "2026-04-04,Ada Games,20,30", ",Bo Games,10,0"].join("\n");
  const imported = await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text: history } });
  expect(imported.status === 201, `import ${imported.status} ${await imported.text()}`);
  const tournament = await api("/api/clubs/current/tournaments", { jar: owner, method: "POST", body: {
    date: "2026-04-14", title: "Friday Freezeout", buyIn: 10,
    players: [{ name: "Ada Games", finishPlace: 1, entries: 1, knockouts: 0 }, { name: "Bo Games", finishPlace: 2, entries: 1, knockouts: 0 }],
  } });
  const tournamentText = await tournament.text();
  expect(tournament.status === 201, `tournament ${tournament.status} ${tournamentText}`);
  const tournamentId = JSON.parse(tournamentText).id;
  const listed = await (await api("/api/clubs/current/sessions", { jar: owner })).json();
  const night = listed.sessions.find((row) => row.date === "2026-04-04");
  expect(night, "imported night missing");
  const editedBody = { date: "2026-04-04", players: [{ name: "Ada Games", buyIn: "25", cashOut: "30" }, { name: "Bo Games", buyIn: "10", cashOut: "0" }] };
  expect((await api(`/api/clubs/current/sessions/${night.id}`, { method: "PATCH", body: editedBody })).status === 401, "signed-out edit should be 401");
  expect((await api(`/api/clubs/current/sessions/${night.id}`, { jar: member, method: "PATCH", body: editedBody })).status === 403, "a member edited a night");
  expect((await api(`/api/clubs/current/sessions/${night.id}`, { jar: member, method: "DELETE" })).status === 403, "a member deleted a night");
  expect((await api(`/api/clubs/current/sessions/${night.id}`, { jar: rival, method: "PATCH", body: editedBody })).status === 404, "another club edited the night");
  expect((await api(`/api/clubs/current/sessions/${night.id}`, { jar: rival, method: "DELETE" })).status === 404, "another club deleted the night");
  expect((await api(`/api/clubs/current/tournaments/${tournamentId}`, { jar: member, method: "DELETE" })).status === 403, "a member deleted a tournament");
  expect((await api(`/api/clubs/current/tournaments/${tournamentId}`, { jar: rival, method: "DELETE" })).status === 404, "another club deleted the tournament");

  const context = await browser.createBrowserContext();
  const phone = await context.newPage();
  await closeWrappedPopup(phone);
  const memberContext = await browser.createBrowserContext();
  const memberPhone = await memberContext.newPage();
  await closeWrappedPopup(memberPhone);
  try {
    const wire = (page) => {
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    };
    wire(phone);
    wire(memberPhone);
    await phone.setViewport(PHONE);
    await memberPhone.setViewport(PHONE);
    const pressOn = (page) => async (selector) => {
      await page.waitForSelector(selector, { timeout: 15000 });
      await page.evaluate((sel) => {
        const node = document.querySelector(sel);
        node.scrollIntoView({ block: "center" });
        const bar = document.querySelector('[data-testid="nav-bottom-tabs"]');
        const rect = node.getBoundingClientRect();
        const limit = bar ? bar.getBoundingClientRect().top - 16 : window.innerHeight - 16;
        if (rect.bottom > limit) window.scrollBy(0, rect.bottom - limit);
      }, selector);
      try {
        await page.tap(selector);
      } catch {
        await page.$eval(selector, (node) => node.click());
      }
    };
    const signIn = async (page, email) => {
      const press = pressOn(page);
      await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
      await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
      await page.type('[data-testid="input-email"]', email);
      await page.type('[data-testid="input-password"]', secret);
      await press('[data-testid="button-account-submit"]');
      await page.waitForSelector('[data-testid="section-home-overview"]', { timeout: 15000 });
      // Home keeps loading cards (settle-up, activity) for a moment and can swallow the first tap, so retry it.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await press('[data-testid="tab-sessions"]');
        try {
          await page.waitForSelector('[data-testid="card-session-1"]', { timeout: 5000 });
          return;
        } catch {
          /* tap again */
        }
      }
      await page.waitForSelector('[data-testid="card-session-1"]', { timeout: 15000 });
    };

    await signIn(memberPhone, memberEmail);
    await sleep(600);
    const memberButtons = await memberPhone.$$('[data-testid="button-edit-night-1"], [data-testid="button-delete-night-1"], [data-testid^="button-delete-tournament-"]');
    expect(memberButtons.length === 0, "a member saw edit or delete on Games");
    await memberPhone.screenshot({ path: `${OUT}/games-member.png`, fullPage: true });

    const press = pressOn(phone);
    await signIn(phone, ownerEmail);
    await phone.waitForSelector('[data-testid="button-edit-night-1"]', { timeout: 15000 });
    await press('[data-testid="button-edit-night-1"]');
    await phone.waitForSelector('[data-testid="form-edit-night-1"]', { timeout: 15000 });
    const buyInSelector = await phone.evaluate(() => {
      const names = [...document.querySelectorAll('[data-testid^="input-edit-night-name-1-"]')];
      const match = names.find((node) => node.value === "Ada Games");
      return match ? match.getAttribute("data-testid").replace("input-edit-night-name-", "input-edit-night-buyin-") : "";
    });
    expect(buyInSelector.startsWith("input-edit-night-buyin-1-"), `Ada's buy-in field was "${buyInSelector}"`);
    await phone.$eval(`[data-testid="${buyInSelector}"]`, (node, next) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(node, next);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }, "25");
    await press('[data-testid="button-save-night-1"]');
    // The open form shows its own totals ($35.00 cash in), so wait for it to close after saving.
    await phone.waitForFunction(() => !document.querySelector('[data-testid="form-edit-night-1"]') && /35\.00/.test(document.querySelector('[data-testid="card-session-1"]')?.innerText ?? ""), { timeout: 15000 });
    const saved = await (await api("/api/poker/dashboard", { jar: owner })).json();
    const savedNight = saved.sessions.find((row) => row.date === "2026-04-04");
    expect(savedNight && savedNight.totalBuyIn === 35, `edited pot ${savedNight?.totalBuyIn}`);
    await phone.screenshot({ path: `${OUT}/games-edited.png`, fullPage: true });

    await press('[data-testid="button-delete-night-1"]');
    await phone.waitForSelector('[data-testid="text-delete-night-irreversible-1"]', { timeout: 15000 });
    const nightWarning = await phone.$eval('[data-testid="text-delete-night-irreversible-1"]', (node) => node.innerText);
    expect(/cannot be undone/i.test(nightWarning), `night delete should say it cannot be undone, saw "${nightWarning}"`);
    await phone.screenshot({ path: `${OUT}/games-delete-night.png`, fullPage: true });
    await press('[data-testid="button-confirm-delete-night-1"]');
    await phone.waitForFunction(() => !document.querySelector('[data-testid="card-session-1"]'), { timeout: 15000 });

    await press(`[data-testid="button-delete-tournament-${tournamentId}"]`);
    await phone.waitForSelector(`[data-testid="text-delete-tournament-irreversible-${tournamentId}"]`, { timeout: 15000 });
    const tournamentWarning = await phone.$eval(`[data-testid="text-delete-tournament-irreversible-${tournamentId}"]`, (node) => node.innerText);
    expect(/cannot be undone/i.test(tournamentWarning), `tournament delete should say it cannot be undone, saw "${tournamentWarning}"`);
    await phone.screenshot({ path: `${OUT}/games-delete-tournament.png`, fullPage: true });
    await press(`[data-testid="button-confirm-delete-tournament-${tournamentId}"]`);
    await phone.waitForFunction((id) => !document.querySelector(`[data-testid="card-tournament-club-${id}"]`), { timeout: 15000 }, tournamentId);

    await press('[data-testid="tab-account"]');
    await press('[data-testid="button-me-rules"]');
    await press('[data-testid="button-open-club-admin"]');
    await phone.waitForSelector('[data-testid="section-admin-setup"]', { timeout: 15000 });
    const nightList = await phone.$('[data-testid="section-night-list"]');
    expect(nightList === null, "the night list should be gone from Club admin Setup");
    await phone.waitForSelector('[data-testid="section-import"]', { timeout: 15000 });

    expect((await api("/api/poker/live-session/start", { jar: owner, method: "POST" })).ok, "could not start a night to reopen");
    expect((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "buy_in", amount: 10 } })).ok, "buy-in failed");
    expect((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "cash_out", amount: 10 } })).ok, "cash-out failed");
    expect((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, "could not close the night to reopen");
    await phone.reload({ waitUntil: "networkidle2" });
    await press('[data-testid="tab-sessions"]');
    await press('[data-testid="button-reopen-night-1"]');
    // Reopening the club's only night leaves it with no finished games, so Home-style onboarding replaces the
    // Games view and its notice. Accept either; what matters is that the Live tab has the night open again.
    await phone.waitForSelector('[data-testid="status-games-notice"], [data-testid="text-new-club-title"], [data-testid="tab-live"]', { timeout: 15000 });
    const notice = await phone.$eval('[data-testid="status-games-notice"]', (node) => node.innerText).catch(() => null);
    if (notice !== null) expect(/Night reopened/.test(notice), `reopen notice was "${notice}"`);
    await press('[data-testid="tab-live"]');
    await openTable(phone);
    await phone.waitForSelector('[data-testid="button-end-live-session"]', { timeout: 15000 });
    const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sideways <= 1, `Games scrolls sideways on a phone (${sideways}px)`);
    await phone.screenshot({ path: `${OUT}/games-reopened.png`, fullPage: true });
  } catch (error) {
    await phone.screenshot({ path: `${OUT}/games-edit-failed.png`, fullPage: true }).catch(() => undefined);
    const where = await phone.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "");
    throw new Error(`${error.message}\n${where}`);
  } finally {
    await context.close();
    await memberContext.close();
  }
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
    if (path === "/privacy") {
      expect(/usage is visible only to the platform owner/i.test(text), "privacy should say usage is for the platform owner only");
    }
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
