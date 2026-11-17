// Edit and delete on the Games tab, against a throwaway database.
// Skipped unless DATABASE_URL is set; CI must set it.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { and, eq } from "drizzle-orm";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for game edit tests in CI");
}

process.env.SESSION_SECRET ??= "game-edit-test-session-secret-not-used-elsewhere";
process.env.LOG_LEVEL ??= "silent";

const PASS = "game-edit-pass-9";
let base = "";
let server;
let bundleDir = "";
let db;
let sessionResults;
let nightSettlements;
let liveSessions;
let liveActivityEvents;
let tournamentResults;
let clubTournaments;

function cookieJar() {
  const jar = new Map();
  return {
    absorb(response) {
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const eqAt = pair.indexOf("=");
        if (eqAt > 0) jar.set(pair.slice(0, eqAt).trim(), pair.slice(eqAt + 1).trim());
      }
    },
    header: () => [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; "),
  };
}

async function api(path, { jar, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      origin: base,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(jar ? { cookie: jar.header() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  jar?.absorb(response);
  return response;
}

async function bodyOf(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

const stamp = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

async function signUp(jar, name) {
  const response = await api("/api/identity/sign-up/email", {
    jar,
    method: "POST",
    body: { name, email: `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${stamp()}@example.com`, password: PASS },
  });
  assert.equal(response.ok, true, `sign-up ${response.status} ${await response.clone().text()}`);
}

async function newClub(playerName) {
  const jar = cookieJar();
  await signUp(jar, playerName);
  const created = await api("/api/clubs", { jar, method: "POST", body: { name: `Games ${playerName} ${stamp()}`, playerName } });
  assert.equal(created.status, 201, `create club ${created.status}`);
  return jar;
}

async function join(owner, guestName) {
  const guest = cookieJar();
  await signUp(guest, guestName);
  const invite = await api("/api/clubs/current/invites", { jar: owner, method: "POST", body: {} });
  assert.equal(invite.status, 201, `invite ${invite.status}`);
  const code = (await bodyOf(invite)).invite.code;
  const joined = await api(`/api/invites/${code}/accept`, { jar: guest, method: "POST", body: { name: guestName } });
  assert.equal(joined.ok, true, `join ${joined.status} ${JSON.stringify(await bodyOf(joined.clone()))}`);
  return guest;
}

async function dashboard(jar) {
  const response = await api("/api/poker/dashboard", { jar });
  assert.equal(response.ok, true, `dashboard ${response.status}`);
  return bodyOf(response);
}

function profit(data, name) {
  return data.leaderboard.find((player) => player.name === name)?.profitTotal ?? null;
}

function sumProfit(data) {
  return Math.round(data.leaderboard.reduce((sum, player) => sum + player.profitTotal, 0) * 100) / 100;
}

async function clubIdOf(jar) {
  const me = await bodyOf(await api("/api/clubs/me", { jar }));
  return me.clubs.find((club) => club.slug === me.active).id;
}

describe("edit and delete recorded games", { skip: process.env.DATABASE_URL ? false : "DATABASE_URL is required", concurrency: 1 }, () => {
  before(async () => {
    globalThis.require = createRequire(import.meta.url);
    bundleDir = await mkdtemp(path.join(tmpdir(), "game-edit-api-"));
    const sourceDir = path.resolve(import.meta.dirname, "..");
    await build({
      stdin: {
        contents: `import app from "./app.ts";
import { pool, db, sessionResults, nightSettlements, liveSessions, liveActivityEvents, tournamentResults, clubTournaments } from "@workspace/db";
export default app;
export { pool, db, sessionResults, nightSettlements, liveSessions, liveActivityEvents, tournamentResults, clubTournaments };
`,
        resolveDir: sourceDir,
        sourcefile: "game-edit-test-app.ts",
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      outdir: bundleDir,
      outExtension: { ".js": ".mjs" },
      logLevel: "silent",
      plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
      banner: {
        js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
      },
    });
    const appModule = await import(pathToFileURL(path.join(bundleDir, "stdin.mjs")).href);
    db = appModule.db;
    sessionResults = appModule.sessionResults;
    nightSettlements = appModule.nightSettlements;
    liveSessions = appModule.liveSessions;
    liveActivityEvents = appModule.liveActivityEvents;
    tournamentResults = appModule.tournamentResults;
    clubTournaments = appModule.clubTournaments;
    server = createServer(appModule.default);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (db) {
      const { pool } = await import(pathToFileURL(path.join(bundleDir, "stdin.mjs")).href);
      await pool.end();
    }
    if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
  });

  test("permissions, club scoping, and cash totals stay consistent", async () => {
    assert.equal((await api("/api/clubs/current/sessions/1", { method: "PATCH", body: { date: "2026-01-05", players: [] } })).status, 401);
    assert.equal((await api("/api/clubs/current/sessions/1", { method: "DELETE" })).status, 401);

    const owner = await newClub("Ada");
    const guest = await join(owner, "Bea Guest");
    const rival = await newClub("Rival");
    const history = [
      "Date,Player,Buy-in,Cash-out",
      "2026-01-05,Ada,20,30",
      ",Bea,10,0",
      "2026-02-05,Ada,10,10",
      ",Bea,10,10",
    ].join("\n");
    assert.equal((await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text: history } })).status, 201);
    const rivalHistory = "Date,Player,Buy-in,Cash-out\n2026-01-05,Rival,10,20\n,Other,10,0";
    assert.equal((await api("/api/clubs/current/import", { jar: rival, method: "POST", body: { text: rivalHistory } })).status, 201);

    const listed = await bodyOf(await api("/api/clubs/current/sessions", { jar: owner }));
    const january = listed.sessions.find((night) => night.date === "2026-01-05");
    const february = listed.sessions.find((night) => night.date === "2026-02-05");
    assert.ok(january && february, JSON.stringify(listed.sessions));
    const rivalList = await bodyOf(await api("/api/clubs/current/sessions", { jar: rival }));
    const rivalNight = rivalList.sessions[0];
    assert.ok(rivalNight, "rival night missing");

    const guestTools = await bodyOf(await api("/api/clubs/current/game-tools", { jar: guest }));
    assert.equal(guestTools.admin, false);
    assert.equal(guestTools.nights.length, 0);
    const ownerTools = await bodyOf(await api("/api/clubs/current/game-tools", { jar: owner }));
    assert.equal(ownerTools.admin, true);
    assert.ok(ownerTools.nights.some((night) => night.id === january.id && night.source === "import" && night.sessionNumber === 1));

    // Ada is paid $10 more than she put in over the night's total, so the night only balances with an adjustment.
    const editedBody = {
      date: "2026-01-05",
      players: [
        { name: "Ada", buyIn: "20", cashOut: "40", adjustment: "-10", adjustmentNote: "covers the short stack" },
        { name: "Bea", buyIn: "10", cashOut: "0" },
      ],
    };
    const unbalancedBody = { ...editedBody, players: [{ name: "Ada", buyIn: "20", cashOut: "40" }, { name: "Bea", buyIn: "10", cashOut: "0" }] };
    assert.equal((await api(`/api/clubs/current/sessions/${january.id}`, { jar: owner, method: "PATCH", body: unbalancedBody })).status, 409);
    assert.equal((await api(`/api/clubs/current/sessions/${january.id}`, { jar: guest, method: "PATCH", body: editedBody })).status, 403);
    assert.equal((await api(`/api/clubs/current/sessions/${january.id}`, { jar: guest, method: "DELETE" })).status, 403);
    assert.equal((await api(`/api/clubs/current/sessions/${january.id}`, { jar: rival, method: "PATCH", body: editedBody })).status, 404);
    assert.equal((await api(`/api/clubs/current/sessions/${january.id}`, { jar: rival, method: "DELETE" })).status, 404);
    const untouched = await dashboard(rival);
    assert.equal(profit(untouched, "Rival"), 10);

    const edited = await api(`/api/clubs/current/sessions/${january.id}`, { jar: owner, method: "PATCH", body: editedBody });
    assert.equal(edited.status, 200, JSON.stringify(await bodyOf(edited.clone())));
    const afterEdit = await dashboard(owner);
    assert.equal(profit(afterEdit, "Ada"), 20);
    assert.equal(profit(afterEdit, "Bea"), -10);
    assert.equal(afterEdit.totals.totalBuyIn, 50);
    assert.equal(afterEdit.totals.totalCashOut, 60);
    assert.equal(afterEdit.totals.balanceDifference, 10);
    assert.equal(sumProfit(afterEdit), afterEdit.totals.balanceDifference);
    // The adjustment changes what Ada is owed (+20 - 10), not her poker profit.
    const settlement = await bodyOf(await api(`/api/clubs/current/nights/${january.id}/settlement`, { jar: owner }));
    assert.equal(settlement.lines.find((line) => line.name === "Ada").netCents, 1000);
    assert.equal(settlement.lines.find((line) => line.name === "Bea").netCents, -1000);
    assert.ok(settlement.log.some((entry) => entry.kind === "edit"));
    const februaryStill = afterEdit.sessions.find((night) => night.date === "2026-02-05");
    assert.equal(februaryStill.totalBuyIn, 20);
    assert.equal(februaryStill.totalNet, 0);

    assert.equal((await api(`/api/clubs/current/sessions/${rivalNight.id}`, { jar: owner, method: "PATCH", body: editedBody })).status, 404);
    const rivalStill = await dashboard(rival);
    assert.equal(profit(rivalStill, "Rival"), 10);
    assert.equal(rivalStill.sessions.length, 1);

    assert.equal((await api(`/api/clubs/current/sessions/${january.id}`, { jar: owner, method: "DELETE" })).status, 204);
    const afterDelete = await dashboard(owner);
    assert.equal(afterDelete.sessions.length, 1);
    assert.equal(afterDelete.sessions[0].date, "2026-02-05");
    assert.equal(profit(afterDelete, "Ada"), 0);
    assert.equal(profit(afterDelete, "Bea"), 0);
    assert.equal(afterDelete.totals.totalBuyIn, 20);
    assert.equal(afterDelete.totals.totalCashOut, 20);
    assert.equal(sumProfit(afterDelete), afterDelete.totals.balanceDifference);
    const gone = await db.select().from(sessionResults).where(eq(sessionResults.sessionId, january.id));
    assert.equal(gone.length, 0);
    const kept = await db.select().from(sessionResults).where(eq(sessionResults.sessionId, february.id));
    assert.equal(kept.length, 2);
    assert.equal((await api(`/api/clubs/current/sessions/${january.id}`, { jar: owner, method: "DELETE" })).status, 404);
    assert.equal((await dashboard(rival)).sessions.length, 1);
  });

  test("deleting a night keeps settle-up and the jackpot consistent", async () => {
    const owner = await newClub("Kit");
    const clubId = await clubIdOf(owner);
    const play = async (rows, resolution) => {
      assert.equal((await api("/api/poker/live-session/start", { jar: owner, method: "POST" })).ok, true);
      for (const [name, buy, out] of rows) {
        assert.equal((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "buy_in", amount: buy, attributedPlayer: name } })).ok, true);
        assert.equal((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "cash_out", amount: out, attributedPlayer: name } })).ok, true);
      }
      if (resolution) {
        const choice = await api("/api/clubs/current/ledger/resolution", { jar: owner, method: "PUT", body: resolution });
        assert.equal(choice.ok, true, `resolution ${choice.status} ${await choice.text()}`);
      }
      const ended = await api("/api/poker/live-session/end", { jar: owner, method: "POST" });
      assert.equal(ended.ok, true, `end ${ended.status} ${await ended.text()}`);
      const activity = await bodyOf(await api("/api/poker/live-activity", { jar: owner }));
      const nights = await bodyOf(await api("/api/clubs/current/sessions", { jar: owner }));
      const night = nights.sessions.find((row) => row.source === "live" && !row.removed);
      return { key: activity.sessionKey, nights: nights.sessions };
    };

    const dropped = await play([["Kit", 10, 6]], { mode: "jackpot" });
    const jackpotNight = dropped.nights.find((night) => night.jackpot === 4);
    assert.ok(jackpotNight, JSON.stringify(dropped.nights));
    let pot = await bodyOf(await api("/api/clubs/current/jackpot", { jar: owner }));
    assert.equal(pot.total, 4);
    assert.equal((await api(`/api/clubs/current/sessions/${jackpotNight.id}`, { jar: owner, method: "PATCH", body: { date: "2026-03-01", players: [{ name: "Kit", buyIn: "10", cashOut: "10" }, { name: "Other", buyIn: "10", cashOut: "10" }] } })).status, 409); // the night's $4 jackpot is no longer covered
    assert.equal((await api(`/api/clubs/current/sessions/${jackpotNight.id}`, { jar: owner, method: "DELETE" })).status, 204);
    pot = await bodyOf(await api("/api/clubs/current/jackpot", { jar: owner }));
    assert.equal(pot.total, 0);
    assert.equal(pot.nights, 0);
    assert.equal((await db.select().from(sessionResults).where(eq(sessionResults.sessionId, jackpotNight.id))).length, 0);
    assert.equal((await db.select().from(liveSessions).where(eq(liveSessions.sessionKey, dropped.key))).length, 0);
    assert.equal((await db.select().from(liveActivityEvents).where(eq(liveActivityEvents.sessionKey, dropped.key))).length, 0);
    const again = await dashboard(owner);
    assert.equal(again.sessions.length, 0);

    const kept = await play([["Kit", 10, 6]], { mode: "jackpot" });
    const paidNight = kept.nights.find((night) => night.jackpot === 4);
    assert.ok(paidNight);
    const paid = await api("/api/clubs/current/jackpot/payouts", { jar: owner, method: "POST", body: { name: "Kit", amount: 3 } });
    assert.equal(paid.status, 201, JSON.stringify(await bodyOf(paid.clone())));
    pot = await bodyOf(paid);
    assert.equal(pot.total, 1);
    const refused = await api(`/api/clubs/current/sessions/${paidNight.id}`, { jar: owner, method: "DELETE" });
    assert.equal(refused.status, 409, JSON.stringify(await bodyOf(refused.clone())));
    pot = await bodyOf(await api("/api/clubs/current/jackpot", { jar: owner }));
    assert.equal(pot.total, 1);
    assert.equal(pot.payouts.length, 1);
    assert.ok((await db.select().from(sessionResults).where(eq(sessionResults.sessionId, paidNight.id))).length > 0);
    assert.equal((await dashboard(owner)).sessions.length, 1);

    assert.equal((await api("/api/poker/live-session/start", { jar: owner, method: "POST" })).ok, true);
    for (const [name, buy, out] of [["Kit", 20, 10], ["Bea", 10, 20]]) {
      assert.equal((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "buy_in", amount: buy, attributedPlayer: name } })).ok, true);
      assert.equal((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "cash_out", amount: out, attributedPlayer: name } })).ok, true);
    }
    const ended = await api("/api/poker/live-session/end", { jar: owner, method: "POST" });
    assert.equal(ended.ok, true, `balanced end ${ended.status} ${await ended.text()}`);
    const role = await bodyOf(await api("/api/poker/live-session/role", { jar: owner }));
    assert.equal(typeof role.nightId, "number");
    const ticked = await api(`/api/clubs/current/nights/${role.nightId}/settlement`, { jar: owner, method: "PUT", body: { name: "Bea", settled: true } });
    assert.equal(ticked.ok, true, `tick ${ticked.status} ${await ticked.text()}`);
    const marks = await db.select().from(nightSettlements).where(and(eq(nightSettlements.clubId, clubId), eq(nightSettlements.clubSessionId, role.nightId)));
    assert.equal(marks.length, 1);
    const activity = await bodyOf(await api("/api/poker/live-activity", { jar: owner }));
    assert.equal((await api(`/api/clubs/current/sessions/${role.nightId}`, { jar: owner, method: "DELETE" })).status, 204);
    assert.equal((await db.select().from(nightSettlements).where(eq(nightSettlements.clubSessionId, role.nightId))).length, 0);
    assert.equal((await db.select().from(sessionResults).where(eq(sessionResults.sessionId, role.nightId))).length, 0);
    assert.equal((await db.select().from(liveSessions).where(eq(liveSessions.sessionKey, activity.sessionKey))).length, 0);
    assert.equal((await api(`/api/clubs/current/nights/${role.nightId}/settlement`, { jar: owner })).status, 404);
    pot = await bodyOf(await api("/api/clubs/current/jackpot", { jar: owner }));
    assert.equal(pot.total, 1);
    assert.equal(pot.payouts.length, 1);
    const board = await dashboard(owner);
    assert.equal(board.sessions.length, 1);
    assert.equal(board.sessions[0].totalBuyIn, 10);
    assert.equal(sumProfit(board), board.totals.balanceDifference);
  });

  test("bank, host and admin edit a night; adjustments, jackpot, settling and the log", async () => {
    const owner = await newClub("Ivy");
    const bank = await join(owner, "Bob Bank");
    const other = await join(owner, "Cy Other");
    const history = "Date,Player,Buy-in,Cash-out\n2026-05-05,Ivy,20,30\n,Bob Bank,10,0\n,Cy Other,5,5";
    assert.equal((await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text: history } })).status, 201);
    const night = (await bodyOf(await api("/api/clubs/current/sessions", { jar: owner }))).sessions[0];
    const body = { date: "2026-05-05", players: [{ name: "Ivy", buyIn: "20", cashOut: "30" }, { name: "Bob Bank", buyIn: "10", cashOut: "0" }, { name: "Cy Other", buyIn: "5", cashOut: "5" }] };

    // Nobody but an admin can edit or set the bank until a bank is assigned.
    assert.equal((await api(`/api/clubs/current/sessions/${night.id}`, { jar: bank, method: "PATCH", body })).status, 403);
    assert.equal((await api(`/api/clubs/current/nights/${night.id}/bank`, { jar: bank, method: "PUT", body: { name: "Bob Bank" } })).status, 403);
    const set = await api(`/api/clubs/current/nights/${night.id}/bank`, { jar: owner, method: "PUT", body: { name: "Bob Bank" } });
    assert.equal(set.status, 200, JSON.stringify(await bodyOf(set.clone())));
    assert.equal((await bodyOf(set)).bankName, "Bob Bank");
    assert.equal((await api(`/api/clubs/current/nights/${night.id}/bank`, { jar: owner, method: "PUT", body: { name: "Nobody Here" } })).status, 400);

    // The bank may now edit, a bystander still may not.
    assert.equal((await bodyOf(await api(`/api/clubs/current/nights/${night.id}/edit`, { jar: bank }))).canEdit, true);
    assert.equal((await bodyOf(await api(`/api/clubs/current/nights/${night.id}/edit`, { jar: other }))).canEdit, false);
    assert.equal((await api(`/api/clubs/current/sessions/${night.id}`, { jar: other, method: "PATCH", body })).status, 403);
    // A surplus is absorbed by the jackpot; unaccounted money is refused.
    const surplus = { ...body, players: [{ name: "Ivy", buyIn: "20", cashOut: "25" }, body.players[1], body.players[2]] };
    assert.equal((await api(`/api/clubs/current/sessions/${night.id}`, { jar: bank, method: "PATCH", body: surplus })).status, 409);
    const withJackpot = await api(`/api/clubs/current/sessions/${night.id}`, { jar: bank, method: "PATCH", body: { ...surplus, jackpot: "5" } });
    assert.equal(withJackpot.status, 200, JSON.stringify(await bodyOf(withJackpot.clone())));
    assert.equal((await bodyOf(await api("/api/clubs/current/jackpot", { jar: owner }))).total, 5);

    // Tick someone settled, then change amounts: the night is flagged and the log says who did what.
    const ticked = await api(`/api/clubs/current/nights/${night.id}/settlement`, { jar: bank, method: "PUT", body: { name: "Bob Bank", settled: true } });
    assert.equal(ticked.status, 200);
    assert.equal((await api(`/api/clubs/current/nights/${night.id}/settlement`, { jar: other, method: "PUT", body: { name: "Ivy", settled: true } })).status, 403);
    const owe = await bodyOf(await api("/api/clubs/current/settle-up", { jar: owner }));
    assert.ok(owe.mine.owed.some((entry) => entry.nightId === night.id && entry.bank === "Bob Bank"), JSON.stringify(owe.mine));
    const trackedNight = owe.nights.find((row) => row.nightId === night.id);
    assert.equal(trackedNight.canEdit, true);
    const changed = { ...body, jackpot: "5", players: [{ name: "Ivy", buyIn: "20", cashOut: "26" }, body.players[1], body.players[2]] };
    assert.equal((await api(`/api/clubs/current/sessions/${night.id}`, { jar: bank, method: "PATCH", body: { ...changed, players: [{ name: "Ivy", buyIn: "20", cashOut: "26" }, { name: "Bob Bank", buyIn: "10", cashOut: "0" }, { name: "Cy Other", buyIn: "5", cashOut: "5", adjustment: "-1" }] } })).status, 200);
    const after = await bodyOf(await api(`/api/clubs/current/nights/${night.id}/settlement`, { jar: owner }));
    assert.equal(after.flagged, true);
    const kinds = after.log.map((entry) => entry.kind);
    assert.ok(kinds.includes("settled") && kinds.includes("bank") && kinds.includes("amounts_after_settled"), kinds.join(","));
    assert.ok(after.log.every((entry) => entry.by && entry.at));
    const unticked = await bodyOf(await api(`/api/clubs/current/nights/${night.id}/settlement`, { jar: bank, method: "PUT", body: { name: "Bob Bank", settled: false } }));
    assert.equal(unticked.log[0].kind, "unsettled");
  });

  test("editing and deleting a tournament stays inside the club", async () => {
    const owner = await newClub("Nia");
    const guest = await join(owner, "Owen Guest");
    const rival = await newClub("Rival T");
    const clubId = await clubIdOf(owner);
    const history = "Date,Player,Buy-in,Cash-out\n2026-03-03,Nia,15,15\n,Owen,15,15";
    assert.equal((await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text: history } })).status, 201);
    const cashBefore = await dashboard(owner);

    const form = {
      date: "2026-04-04",
      title: "Friday Freezeout",
      buyIn: 10,
      bounty: 0,
      shares: { first: 50, second: 30, third: 20 },
      players: [
        { name: "Nia", finishPlace: 1, entries: 1, knockouts: 0 },
        { name: "Owen", finishPlace: 2, entries: 1, knockouts: 0 },
      ],
    };
    assert.equal((await api("/api/clubs/current/tournaments", { method: "POST", body: form })).status, 401);
    assert.equal((await api("/api/clubs/current/tournaments", { jar: guest, method: "POST", body: form })).status, 403);
    const created = await api("/api/clubs/current/tournaments", { jar: owner, method: "POST", body: form });
    assert.equal(created.status, 201, JSON.stringify(await bodyOf(created.clone())));
    const id = (await bodyOf(created)).id;
    const [stored] = await db.select().from(clubTournaments).where(and(eq(clubTournaments.clubId, clubId), eq(clubTournaments.id, id)));
    assert.ok(stored);
    assert.equal((await db.select().from(tournamentResults).where(eq(tournamentResults.tournamentId, id))).length, 2);

    const changed = { ...form, title: "Saturday Freezeout", buyIn: 20 };
    assert.equal((await api(`/api/clubs/current/tournaments/${id}`, { jar: guest, method: "PATCH", body: changed })).status, 403);
    assert.equal((await api(`/api/clubs/current/tournaments/${id}`, { jar: guest, method: "DELETE" })).status, 403);
    assert.equal((await api(`/api/clubs/current/tournaments/${id}`, { jar: rival })).status, 404);
    assert.equal((await api(`/api/clubs/current/tournaments/${id}`, { jar: rival, method: "PATCH", body: changed })).status, 404);
    assert.equal((await api(`/api/clubs/current/tournaments/${id}`, { jar: rival, method: "DELETE" })).status, 404);

    const updated = await api(`/api/clubs/current/tournaments/${id}`, { jar: owner, method: "PATCH", body: changed });
    assert.equal(updated.status, 200, JSON.stringify(await bodyOf(updated.clone())));
    assert.equal((await bodyOf(updated)).totalCollected, 40);
    const afterEdit = await dashboard(owner);
    assert.equal(afterEdit.totals.totalBuyIn, cashBefore.totals.totalBuyIn);
    assert.equal(afterEdit.totals.totalCashOut, cashBefore.totals.totalCashOut);
    const event = afterEdit.tournaments.find((item) => item.id === `club-${id}`);
    assert.equal(event.title, "Saturday Freezeout");
    assert.equal(event.totalCollected, 40);
    assert.equal((await db.select().from(tournamentResults).where(eq(tournamentResults.tournamentId, id))).length, 2);

    assert.equal((await api(`/api/clubs/current/tournaments/${id}`, { jar: owner, method: "DELETE" })).status, 204);
    const afterDelete = await dashboard(owner);
    assert.equal(afterDelete.tournaments.length, 0);
    assert.equal(afterDelete.totals.totalBuyIn, cashBefore.totals.totalBuyIn);
    assert.equal(afterDelete.sessions.length, 1);
    assert.equal((await db.select().from(tournamentResults).where(eq(tournamentResults.tournamentId, id))).length, 0);
    assert.equal((await db.select().from(clubTournaments).where(eq(clubTournaments.id, id))).length, 0);
    assert.equal((await api(`/api/clubs/current/tournaments/${id}`, { jar: owner, method: "DELETE" })).status, 404);
    assert.equal((await dashboard(rival)).tournaments.length, 0);
  });
});
