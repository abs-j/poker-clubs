// Merge API, against a throwaway database. Skipped unless DATABASE_URL is set; CI must set it.
// The app is bundled the same way production starts it: Node cannot import the source tree directly.
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
  throw new Error("DATABASE_URL is required for merge API tests in CI");
}

process.env.SESSION_SECRET ??= "merge-test-session-secret-not-used-elsewhere";
process.env.LOG_LEVEL ??= "silent";

const PASS = "merge-test-pass-9";
let base = "";
let server;
let bundleDir = "";
let db;
let memberUsage;
let memberAvatars;
let siteVisits;
let liveSessions;

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
  const created = await api("/api/clubs", { jar, method: "POST", body: { name: `Merge ${playerName} ${stamp()}`, playerName } });
  assert.equal(created.status, 201, `create club ${created.status}`);
  return jar;
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
  return data.leaderboard.reduce((sum, player) => sum + player.profitTotal, 0);
}

describe("merge two names", { skip: process.env.DATABASE_URL ? false : "DATABASE_URL is required", concurrency: 1 }, () => {
  before(async () => {
    globalThis.require = createRequire(import.meta.url);
    bundleDir = await mkdtemp(path.join(tmpdir(), "merge-api-"));
    const sourceDir = path.resolve(import.meta.dirname, "..");
    await build({
      stdin: {
        contents: `import app from "./app.ts";\nimport { pool, db, memberUsage, memberAvatars, siteVisits, liveSessions } from "@workspace/db";\nexport default app;\nexport { pool, db, memberUsage, memberAvatars, siteVisits, liveSessions };\n`,
        resolveDir: sourceDir,
        sourcefile: "merge-test-app.ts",
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
        js: `import { createRequire as __bannerCrReq } from 'node:module';\nimport __bannerPath from 'node:path';\nimport __bannerUrl from 'node:url';\nglobalThis.require = __bannerCrReq(import.meta.url);\nglobalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);\nglobalThis.__dirname = __bannerPath.dirname(globalThis.__filename);\n`,
      },
    });
    const appModule = await import(pathToFileURL(path.join(bundleDir, "stdin.mjs")).href);
    db = appModule.db;
    memberUsage = appModule.memberUsage;
    memberAvatars = appModule.memberAvatars;
    siteVisits = appModule.siteVisits;
    liveSessions = appModule.liveSessions;
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

  test("permissions, club scoping, collisions, and totals", async () => {
    assert.equal((await api("/api/clubs/current/players/merge", { method: "POST", body: { keep: "Pat", merge: "Patt" } })).status, 401);

    const owner = await newClub("Pat");
    const rival = await newClub("Rival");
    const guest = cookieJar();
    await signUp(guest, "Guest Person");
    const invite = await api("/api/clubs/current/invites", { jar: owner, method: "POST", body: {} });
    assert.equal(invite.status, 201, `invite ${invite.status}`);
    const code = (await bodyOf(invite)).invite.code;
    const joined = await api(`/api/invites/${code}/accept`, { jar: guest, method: "POST", body: { name: "Guest Person" } });
    assert.equal(joined.ok, true, `join ${joined.status} ${JSON.stringify(await bodyOf(joined.clone()))}`);

    const refused = await api("/api/clubs/current/players/merge", { jar: guest, method: "POST", body: { keep: "Pat", merge: "Patt" } });
    assert.equal(refused.status, 403, `member merge ${refused.status}`);

    const same = await api("/api/clubs/current/players/merge/preview", { jar: owner, method: "POST", body: { keep: "Pat", merge: " pat " } });
    assert.equal(same.status, 400, `same name ${same.status}`);

    const history = [
      "Date,Player,Buy-in,Cash-out",
      "2026-03-03,Pat,20,50",
      ",Patt,10,0",
      ",Other,10,0",
      "2026-03-10,Pat,10,0",
      ",Other,10,20",
    ].join("\n");
    const imported = await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text: history } });
    assert.equal(imported.status, 201, `import ${imported.status} ${JSON.stringify(await bodyOf(imported.clone()))}`);

    const rivalHistory = "Date,Player,Buy-in,Cash-out\n2026-03-03,Patt,10,30\n,Other,10,0";
    assert.equal((await api("/api/clubs/current/import", { jar: rival, method: "POST", body: { text: rivalHistory } })).status, 201);

    const tournament = await api("/api/clubs/current/tournaments", {
      jar: owner,
      method: "POST",
      body: {
        date: "2026-03-12",
        title: "Merge Freezeout",
        buyIn: 20,
        players: [
          { name: "Pat", finishPlace: 1, entries: 1, knockouts: 0 },
          { name: "Patt", finishPlace: 2, entries: 1, knockouts: 0 },
          { name: "Other", finishPlace: 3, entries: 1, knockouts: 0 },
        ],
      },
    });
    assert.equal(tournament.status, 201, `tournament ${tournament.status} ${JSON.stringify(await bodyOf(tournament.clone()))}`);

    const started = await api("/api/poker/live-session/start", { jar: owner, method: "POST", body: { date: "2026-03-15" } });
    assert.equal(started.ok, true, `start ${started.status} ${await started.clone().text()}`);
    assert.equal((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "buy_in", amount: 10, attributedPlayer: "Patt" } })).ok, true);
    assert.equal((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "cash_out", amount: 6, attributedPlayer: "Patt" } })).ok, true);
    assert.equal((await api("/api/poker/live-session/bank", { jar: owner, method: "PUT", body: { name: "Patt" } })).ok, true);
    assert.equal((await api("/api/clubs/current/ledger/resolution", { jar: owner, method: "PUT", body: { mode: "jackpot" } })).ok, true);
    assert.equal((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, true);
    const payout = await api("/api/clubs/current/jackpot/payouts", { jar: owner, method: "POST", body: { name: "Patt", amount: 1 } });
    assert.equal(payout.ok, true, `payout ${payout.status} ${await payout.clone().text()}`);

    const settings = await bodyOf(await api("/api/clubs/current/settings", { jar: owner }));
    const clubId = settings.settings.id;
    await db.insert(memberUsage).values([
      { clubId, memberName: "Pat", section: "live", pageViews: 2, activeSeconds: 10 },
      { clubId, memberName: "Patt", section: "live", pageViews: 3, activeSeconds: 4 },
      { clubId, memberName: "Patt", section: "games", pageViews: 1, activeSeconds: 5 },
    ]);
    await db.insert(memberAvatars).values([
      { clubId, memberKey: "pat", memberName: "Pat", kind: "preset", preset: "fox" },
      { clubId, memberKey: "patt", memberName: "Patt", kind: "preset", preset: "owl" },
    ]);
    await db.insert(siteVisits).values({ clubId, memberName: "Patt" });
    await db.update(liveSessions).set({ balanceResolution: { mode: "player", name: "Patt" } }).where(eq(liveSessions.clubId, clubId));

    const missing = await api("/api/clubs/current/players/merge/preview", { jar: rival, method: "POST", body: { keep: "Patt", merge: "Pat" } });
    assert.equal(missing.status, 404, `other club ${missing.status} ${JSON.stringify(await bodyOf(missing.clone()))}`);

    const before = await dashboard(owner);
    const rivalBefore = await dashboard(rival);
    const jackpotBefore = await bodyOf(await api("/api/clubs/current/jackpot", { jar: owner }));
    assert.equal(profit(before, "Pat"), 20);
    assert.equal(profit(before, "Patt"), -14);
    assert.equal(profit(before, "Other"), 0);
    assert.equal(jackpotBefore.total, 3);

    const preview = await api("/api/clubs/current/players/merge/preview", { jar: owner, method: "POST", body: { keep: "Pat", merge: "Patt" } });
    const shown = await bodyOf(preview);
    assert.equal(preview.status, 200, JSON.stringify(shown));
    assert.equal(shown.irreversible, true);
    assert.equal(shown.nights, 2);
    assert.equal(shown.nightsCombined, 1);
    assert.equal(shown.ledgerEntries, 2);
    assert.equal(shown.tournaments, 1);
    assert.equal(shown.tournamentsCombined, 1);
    assert.equal(shown.jackpotPayouts, 1);
    assert.equal(shown.bankNights, 1);
    assert.equal(shown.claim, "stays");
    assert.equal(shown.picture, "kept");
    assert.deepEqual((await dashboard(owner)).leaderboard, before.leaderboard);

    const merged = await api("/api/clubs/current/players/merge", { jar: owner, method: "POST", body: { keep: "Pat", merge: "Patt" } });
    const done = await bodyOf(merged);
    assert.equal(merged.status, 200, JSON.stringify(done));
    assert.equal(done.merged, true);

    const after = await dashboard(owner);
    assert.equal(after.totals.totalBuyIn, before.totals.totalBuyIn);
    assert.equal(after.totals.totalCashOut, before.totals.totalCashOut);
    assert.equal(sumProfit(after), sumProfit(before));
    assert.equal(profit(after, "Pat"), 6);
    assert.equal(profit(after, "Patt"), null);
    assert.equal(profit(after, "Other"), 0);
    assert.equal(after.leaderboard.find((player) => player.name === "Pat").gamesPlayed, 3);
    const event = after.tournaments.find((item) => item.title === "Merge Freezeout");
    const eventBefore = before.tournaments.find((item) => item.title === "Merge Freezeout");
    const net = (results, name) => results.find((result) => result.player === name)?.netProfit ?? 0;
    assert.equal(net(event.results, "Pat"), net(eventBefore.results, "Pat") + net(eventBefore.results, "Patt"));
    assert.equal(net(event.results, "Other"), net(eventBefore.results, "Other"));
    assert.ok(Math.abs(event.results.reduce((sum, result) => sum + result.netProfit, 0)) < 0.02);

    const jackpotAfter = await bodyOf(await api("/api/clubs/current/jackpot", { jar: owner }));
    assert.equal(jackpotAfter.total, jackpotBefore.total);
    assert.equal(jackpotAfter.payouts[0].name, "Pat");
    assert.equal(jackpotAfter.payouts[0].amount, 1);

    const role = await bodyOf(await api("/api/poker/live-session/role", { jar: owner }));
    assert.equal(role.bankName, "Pat");
    const live = await bodyOf(await api("/api/poker/live-activity", { jar: owner }));
    assert.ok(live.entries.length >= 2);
    assert.ok(live.entries.every((entry) => entry.memberName === "Pat"), JSON.stringify(live.entries.map((entry) => entry.memberName)));

    const rivalAfter = await dashboard(rival);
    assert.deepEqual(
      rivalAfter.leaderboard.map((player) => [player.name, player.profitTotal]),
      rivalBefore.leaderboard.map((player) => [player.name, player.profitTotal]),
    );
    assert.equal(profit(rivalAfter, "Patt"), 20);

    const usage = await db.select().from(memberUsage).where(eq(memberUsage.clubId, clubId));
    const liveUsage = usage.find((row) => row.section === "live");
    const gamesUsage = usage.find((row) => row.section === "games");
    assert.equal(usage.length, 2);
    assert.equal(liveUsage.memberName, "Pat");
    assert.equal(liveUsage.pageViews, 5);
    assert.equal(liveUsage.activeSeconds, 14);
    assert.equal(gamesUsage.memberName, "Pat");
    assert.equal(gamesUsage.pageViews, 1);
    const pictures = await db.select().from(memberAvatars).where(eq(memberAvatars.clubId, clubId));
    assert.equal(pictures.length, 1);
    assert.equal(pictures[0].memberKey, "pat");
    const visits = await db.select().from(siteVisits).where(and(eq(siteVisits.clubId, clubId), eq(siteVisits.memberName, "Patt")));
    assert.equal(visits.length, 0);
    const [session] = await db.select({ resolution: liveSessions.balanceResolution }).from(liveSessions).where(eq(liveSessions.clubId, clubId));
    assert.equal(session.resolution.name, "Pat");
  });

  test("two accounts cannot be merged, and nothing changes", async () => {
    const owner = await newClub("Ada");
    const guest = cookieJar();
    await signUp(guest, "Bea");
    const invite = await api("/api/clubs/current/invites", { jar: owner, method: "POST", body: {} });
    const code = (await bodyOf(invite)).invite.code;
    assert.equal((await api(`/api/invites/${code}/accept`, { jar: guest, method: "POST", body: { name: "Bea" } })).ok, true);
    const before = await dashboard(owner);
    const refused = await api("/api/clubs/current/players/merge", { jar: owner, method: "POST", body: { keep: "Ada", merge: "Bea" } });
    const error = await bodyOf(refused);
    assert.equal(refused.status, 409, JSON.stringify(error));
    assert.match(error.error, /accounts/);
    const after = await dashboard(owner);
    assert.deepEqual(after.leaderboard.map((player) => player.name).sort(), before.leaderboard.map((player) => player.name).sort());
    const members = await bodyOf(await api("/api/clubs/current/members", { jar: owner }));
    assert.deepEqual(members.members.map((member) => member.name).sort(), ["Ada", "Bea"]);
  });

  test("settle-up ticks on a shared night stay only when both names were settled", async () => {
    const owner = await newClub("Sam");
    const play = async (date, rows) => {
      const started = await api("/api/poker/live-session/start", { jar: owner, method: "POST", body: { date } });
      assert.equal(started.ok, true, `start ${date} ${started.status} ${await started.text()}`);
      for (const [name, buy, out] of rows) {
        const bought = await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "buy_in", amount: buy, attributedPlayer: name } });
        assert.equal(bought.ok, true, `buy ${name} ${bought.status} ${await bought.text()}`);
        if (out > 0) {
          const cashed = await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "cash_out", amount: out, attributedPlayer: name } });
          assert.equal(cashed.ok, true, `cash ${name} ${cashed.status} ${await cashed.text()}`);
        }
      }
      const ended = await api("/api/poker/live-session/end", { jar: owner, method: "POST" });
      assert.equal(ended.ok, true, `end ${date} ${ended.status} ${await ended.text()}`);
      const nights = await bodyOf(await api("/api/clubs/current/sessions", { jar: owner }));
      const night = nights.sessions.find((session) => session.date === date);
      assert.ok(night, `night ${date} missing`);
      return night.id;
    };
    const tick = (id, name) => api(`/api/clubs/current/nights/${id}/settlement`, { jar: owner, method: "PUT", body: { name, settled: true } });
    const first = await play("2026-04-01", [["Sam", 10, 30], ["Sammy", 10, 20], ["Other", 30, 0]]);
    assert.equal((await tick(first, "Sam")).ok, true);
    assert.equal((await tick(first, "Sammy")).ok, true);
    const second = await play("2026-04-08", [["Sam", 10, 25], ["Sammy", 10, 5], ["Other", 10, 0]]);
    assert.equal((await tick(second, "Sam")).ok, true);

    const before = await bodyOf(await api("/api/clubs/current/settle-up", { jar: owner }));
    const preview = await bodyOf(await api("/api/clubs/current/players/merge/preview", { jar: owner, method: "POST", body: { keep: "Sam", merge: "Sammy" } }));
    assert.equal(preview.nightsCombined, 2);
    assert.equal(preview.settlementsCleared, 1);
    assert.equal(preview.settlementsCombined, 2);
    const merged = await api("/api/clubs/current/players/merge", { jar: owner, method: "POST", body: { keep: "Sam", merge: "Sammy" } });
    assert.equal(merged.status, 200, await merged.clone().text());

    const kept = await bodyOf(await api(`/api/clubs/current/nights/${first}/settlement`, { jar: owner }));
    const cleared = await bodyOf(await api(`/api/clubs/current/nights/${second}/settlement`, { jar: owner }));
    const line = (settlement, name) => settlement.lines.find((row) => row.name === name);
    assert.equal(line(kept, "Sam").netCents, 3000);
    assert.equal(line(kept, "Sam").settled, true);
    assert.equal(line(kept, "Other").netCents, -3000);
    assert.equal(line(cleared, "Sam").netCents, 1000);
    assert.equal(line(cleared, "Sam").settled, false);
    assert.equal(line(cleared, "Sammy"), undefined);
    const after = await bodyOf(await api("/api/clubs/current/settle-up", { jar: owner }));
    // Both of Sam's nights were ticked, so nothing was open. The second night's combined +$10 is not fully settled.
    assert.equal(before.mine.owedCents, 0);
    assert.equal(before.mine.oweCents, 0);
    assert.equal(after.mine.owedCents, 1000);
    assert.equal(after.mine.oweCents, 0);
    const data = await dashboard(owner);
    assert.equal(data.totals.totalBuyIn, 80);
    assert.equal(data.totals.totalCashOut, 80);
    assert.equal(sumProfit(data), 0);
  });

  test("a shared tournament that cannot be added together is refused and left as it was", async () => {
    const owner = await newClub("Jo");
    const saved = await api("/api/clubs/current/tournaments", {
      jar: owner,
      method: "POST",
      body: {
        date: "2026-05-01",
        title: "Top-ups",
        buyIn: 20,
        topUp: 10,
        players: [
          { name: "Jo", finishPlace: 1, entries: 1, knockouts: 0, topUp: true },
          { name: "Joey", finishPlace: 2, entries: 1, knockouts: 0, topUp: true },
        ],
      },
    });
    assert.equal(saved.status, 201, await saved.clone().text());
    const before = await dashboard(owner);
    const preview = await api("/api/clubs/current/players/merge/preview", { jar: owner, method: "POST", body: { keep: "Jo", merge: "Joey" } });
    const previewError = await bodyOf(preview);
    assert.equal(preview.status, 409, JSON.stringify(previewError));
    assert.match(previewError.error, /top-up/);
    const refused = await api("/api/clubs/current/players/merge", { jar: owner, method: "POST", body: { keep: "Jo", merge: "Joey" } });
    const error = await bodyOf(refused);
    assert.equal(refused.status, 409, JSON.stringify(error));
    assert.match(error.error, /top-up/);
    const after = await dashboard(owner);
    assert.equal(after.tournaments[0].players, before.tournaments[0].players);
    assert.deepEqual(
      after.tournaments[0].results.map((result) => result.player).sort(),
      before.tournaments[0].results.map((result) => result.player).sort(),
    );
  });

  test("merging an account onto an unclaimed name moves the host and the bank", async () => {
    const owner = await newClub("Pat Owner");
    const added = await api("/api/clubs/current/players", { jar: owner, method: "POST", body: { name: "Patrick" } });
    assert.equal(added.status, 201, await added.clone().text());
    assert.equal((await api("/api/poker/live-session/start", { jar: owner, method: "POST", body: { date: "2026-06-01" } })).ok, true);
    assert.equal((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "buy_in", amount: 10 } })).ok, true);
    assert.equal((await api("/api/poker/live-session/bank", { jar: owner, method: "PUT", body: { name: "Pat Owner" } })).ok, true);
    const preview = await bodyOf(await api("/api/clubs/current/players/merge/preview", { jar: owner, method: "POST", body: { keep: "Patrick", merge: "Pat Owner" } }));
    assert.equal(preview.claim, "moves");
    assert.equal(preview.hostNights, 1);
    assert.equal(preview.bankNights, 1);
    assert.ok(preview.ledgerEntries >= 1);
    const merged = await api("/api/clubs/current/players/merge", { jar: owner, method: "POST", body: { keep: "Patrick", merge: "Pat Owner" } });
    assert.equal(merged.status, 200, await merged.clone().text());
    const me = await bodyOf(await api("/api/clubs/me", { jar: owner }));
    assert.equal(me.clubs.find((club) => club.slug === me.active).playerName, "Patrick");
    const role = await bodyOf(await api("/api/poker/live-session/role", { jar: owner }));
    assert.equal(role.hostName, "Patrick");
    assert.equal(role.bankName, "Patrick");
    const live = await bodyOf(await api("/api/poker/live-activity", { jar: owner }));
    assert.ok(live.entries.every((entry) => entry.memberName === "Patrick"));
    const members = await bodyOf(await api("/api/clubs/current/members", { jar: owner }));
    assert.deepEqual(members.members.map((member) => member.name), ["Patrick"]);
  });
});
