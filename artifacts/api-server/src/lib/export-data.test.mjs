// Cash and tournament CSV export, against a throwaway database.
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

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for export tests in CI");
}

process.env.SESSION_SECRET ??= "export-test-session-secret-not-used-elsewhere";
process.env.LOG_LEVEL ??= "silent";

const PASS = "export-pass-9";
let base = "";
let server;
let bundleDir = "";

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
  const created = await api("/api/clubs", { jar, method: "POST", body: { name: `Export ${playerName} ${stamp()}`, playerName } });
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

const paths = [
  "/api/clubs/current/export.csv",
  "/api/clubs/current/tournaments/export/log.csv",
  "/api/clubs/current/tournaments/export/results.csv",
];

describe("csv export", { skip: process.env.DATABASE_URL ? false : "DATABASE_URL is required", concurrency: 1 }, () => {
  before(async () => {
    globalThis.require = createRequire(import.meta.url);
    bundleDir = await mkdtemp(path.join(tmpdir(), "export-api-"));
    const sourceDir = path.resolve(import.meta.dirname, "..");
    await build({
      stdin: {
        contents: `import app from "./app.ts";
import { pool } from "@workspace/db";
export default app;
export { pool };
`,
        resolveDir: sourceDir,
        sourcefile: "export-test-app.ts",
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
    server = createServer(appModule.default);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (bundleDir) {
      const { pool } = await import(pathToFileURL(path.join(bundleDir, "stdin.mjs")).href);
      await pool.end();
      await rm(bundleDir, { recursive: true, force: true });
    }
  });

  test("cash export lists the surplus and payouts, stays inside the club, and a member cannot download it", async () => {
    for (const path of paths) assert.equal((await api(path)).status, 401, path);

    const owner = await newClub("Ada");
    const guest = await join(owner, "Bea Guest");
    const rival = await newClub("Rival Secret");
    for (const path of paths) {
      assert.equal((await api(path, { jar: guest })).status, 401, `member ${path}`);
      assert.equal((await api(path)).status, 401, `signed out ${path}`);
    }

    const empty = await api("/api/clubs/current/export.csv", { jar: owner });
    assert.equal(empty.status, 200);
    assert.match(empty.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(empty.headers.get("content-disposition") ?? "", /attachment; filename=".+-results\.csv"/);
    assert.equal(await empty.text(), "Date,Player,Buy-in,Cash-out,Net\r\n");

    const history = "Date,Player,Buy-in,Cash-out\n2026-01-05,Ada,20,30\n,\"Bo, Jr.\",10,0";
    assert.equal((await api("/api/clubs/current/import", { jar: owner, method: "POST", body: { text: history } })).status, 201);
    assert.equal((await api("/api/poker/live-session/start", { jar: owner, method: "POST" })).ok, true);
    assert.equal((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "buy_in", amount: 10 } })).ok, true);
    assert.equal((await api("/api/poker/live-activity", { jar: owner, method: "POST", body: { action: "cash_out", amount: 6 } })).ok, true);
    assert.equal((await api("/api/clubs/current/ledger/resolution", { jar: owner, method: "PUT", body: { mode: "jackpot" } })).ok, true);
    assert.equal((await api("/api/poker/live-session/end", { jar: owner, method: "POST" })).ok, true);
    const paid = await api("/api/clubs/current/jackpot/payouts", { jar: owner, method: "POST", body: { name: "Bo, Jr.", amount: 1.5 } });
    assert.equal(paid.status, 201, await paid.clone().text());
    const payout = (await bodyOf(paid)).payouts[0];
    const payoutDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(payout.at));

    assert.equal((await api("/api/poker/live-session/start", { jar: rival, method: "POST" })).ok, true);
    assert.equal((await api("/api/poker/live-activity", { jar: rival, method: "POST", body: { action: "buy_in", amount: 10 } })).ok, true);
    assert.equal((await api("/api/poker/live-activity", { jar: rival, method: "POST", body: { action: "cash_out", amount: 6 } })).ok, true);
    assert.equal((await api("/api/clubs/current/ledger/resolution", { jar: rival, method: "PUT", body: { mode: "jackpot" } })).ok, true);
    assert.equal((await api("/api/poker/live-session/end", { jar: rival, method: "POST" })).ok, true);
    assert.equal((await api("/api/clubs/current/jackpot/payouts", { jar: rival, method: "POST", body: { name: "Rival Secret", amount: 1 } })).status, 201);

    const nights = await bodyOf(await api("/api/clubs/current/sessions", { jar: owner }));
    const surplus = nights.sessions.find((night) => night.jackpot === 4);
    assert.ok(surplus, JSON.stringify(nights.sessions));
    const csv = await (await api("/api/clubs/current/export.csv", { jar: owner })).text();
    assert.match(csv, new RegExp(`${surplus.date},Ada,10\\.00,6\\.00,-4\\.00`));
    assert.match(csv, new RegExp(`${surplus.date},Bad Beat Jackpot,0\\.00,4\\.00,4\\.00`));
    assert.match(csv, new RegExp(`${payoutDay},"Bad Beat Jackpot payout to Bo, Jr\\.",1\\.50,0\\.00,-1\\.50`));
    assert.doesNotMatch(csv, /Rival Secret/);
    assert.match(csv, /"Bo, Jr\."/);

    const rivalCsv = await (await api("/api/clubs/current/export.csv", { jar: rival })).text();
    assert.match(rivalCsv, /Bad Beat Jackpot payout to Rival Secret,1\.00,0\.00,-1\.00/);
    assert.doesNotMatch(rivalCsv, /Bo, Jr/);
    assert.doesNotMatch(rivalCsv, /2026-01-05/);

    const copy = await newClub("Copy Cat");
    const imported = await api("/api/clubs/current/import", { jar: copy, method: "POST", body: { text: csv } });
    assert.equal(imported.status, 201, await imported.clone().text());
    assert.equal((await bodyOf(imported)).imported, 2);
    const originalBoard = (await bodyOf(await api("/api/poker/dashboard", { jar: owner }))).leaderboard.map((player) => [player.name, player.profitTotal, player.gamesPlayed]);
    const copyBoard = (await bodyOf(await api("/api/poker/dashboard", { jar: copy }))).leaderboard.map((player) => [player.name, player.profitTotal, player.gamesPlayed]);
    assert.deepEqual(copyBoard, originalBoard);
    const copyPot = await bodyOf(await api("/api/clubs/current/jackpot", { jar: copy }));
    assert.equal(copyPot.total, 0);
    assert.equal(copyPot.payouts.length, 0);
    const copyCsv = await (await api("/api/clubs/current/export.csv", { jar: copy })).text();
    assert.doesNotMatch(copyCsv, /Bad Beat Jackpot/);
  });

  test("a tournament export imports back into another club and does not include anyone else's", async () => {
    const owner = await newClub("Ada");
    const guest = await join(owner, "Bea Guest");
    const rival = await newClub("Rival Secret");
    const freezeout = {
      date: "2026-10-04",
      title: 'Friday "Final"',
      venue: "Hall, Room 2",
      notes: "Bring chips, and a pen",
      buyIn: 10,
      topUp: 5,
      bounty: 2.5,
      startingStack: 10000,
      winnerKeepsBounty: true,
      shares: { first: 60, second: 40, third: 0 },
      players: [
        { name: "Ana", finishPlace: 1, entries: 2, knockouts: 3 },
        { name: "Bo, Jr.", finishPlace: 2, entries: 1, topUp: true, knockouts: 1 },
        { name: "Cy", finishPlace: 3, entries: 1, freeEntry: true },
        { name: "Di", finishPlace: null, entries: 1 },
      ],
    };
    const explicit = {
      date: "2026-11-01",
      title: "Payout Night",
      buyIn: 20,
      players: [
        { name: "Ana", finishPlace: 1, entries: 1, payout: 25 },
        { name: "Bo, Jr.", finishPlace: 2, entries: 1, payout: 15 },
      ],
    };
    assert.equal((await api("/api/clubs/current/tournaments", { jar: owner, method: "POST", body: freezeout })).status, 201);
    assert.equal((await api("/api/clubs/current/tournaments", { jar: owner, method: "POST", body: explicit })).status, 201);
    assert.equal((await api("/api/clubs/current/tournaments", { jar: rival, method: "POST", body: { date: "2026-09-01", title: "Rival Invitational", buyIn: 10, players: [{ name: "Rival Secret", finishPlace: 1, entries: 1 }, { name: "Other", finishPlace: 2, entries: 1 }] } })).status, 201);
    assert.equal((await api("/api/clubs/current/tournaments/export/log.csv", { jar: guest })).status, 401);

    const log = await api("/api/clubs/current/tournaments/export/log.csv", { jar: owner });
    const results = await api("/api/clubs/current/tournaments/export/results.csv", { jar: owner });
    assert.equal(log.status, 200);
    assert.match(log.headers.get("content-disposition") ?? "", /-tournament-log\.csv"/);
    assert.match(results.headers.get("content-disposition") ?? "", /-tournament-results\.csv"/);
    const logText = await log.text();
    const resultsText = await results.text();
    assert.match(logText, /Friday ""Final""/);
    assert.match(logText, /"Hall, Room 2"/);
    assert.match(logText, /Bring chips, and a pen/);
    assert.match(resultsText, /"Bo, Jr\."/);
    assert.doesNotMatch(logText, /Rival Invitational/);
    assert.doesNotMatch(resultsText, /Rival Secret/);
    const rivalLog = await (await api("/api/clubs/current/tournaments/export/log.csv", { jar: rival })).text();
    assert.match(rivalLog, /Rival Invitational/);
    assert.doesNotMatch(rivalLog, /Payout Night/);

    const copy = await newClub("Copy Cat");
    const imported = await api("/api/clubs/current/tournaments/import", { jar: copy, method: "POST", body: { logText, resultsText } });
    assert.equal(imported.status, 201, await imported.clone().text());
    assert.deepEqual(await bodyOf(imported), { imported: 2, duplicates: 0 });
    const again = await api("/api/clubs/current/tournaments/import", { jar: copy, method: "POST", body: { logText, resultsText } });
    assert.deepEqual(await bodyOf(again), { imported: 0, duplicates: 2 });

    const originalDash = await bodyOf(await api("/api/poker/dashboard", { jar: owner }));
    const copyDash = await bodyOf(await api("/api/poker/dashboard", { jar: copy }));
    const strip = (event) => {
      const { id, ...rest } = event;
      return rest;
    };
    for (const title of ["Friday \"Final\"", "Payout Night"]) {
      const left = originalDash.tournaments.find((event) => event.title === title);
      const right = copyDash.tournaments.find((event) => event.title === title);
      assert.ok(left && right, title);
      assert.deepEqual(strip(right), strip(left));
    }

    const listed = await bodyOf(await api("/api/clubs/current/tournaments", { jar: copy }));
    const storedId = listed.tournaments.find((row) => row.title === "Friday \"Final\"").id;
    const stored = await bodyOf(await api(`/api/clubs/current/tournaments/${storedId}`, { jar: copy }));
    assert.equal(stored.venue, "Hall, Room 2");
    assert.equal(stored.notes, "Bring chips, and a pen");
    assert.equal(stored.winnerKeepsBounty, true);
    assert.equal(stored.startingStack, 10000);
    assert.deepEqual(stored.shares, { first: 60, second: 40, third: 0 });
    const byName = new Map(stored.players.map((player) => [player.name, player]));
    assert.equal(byName.get("Cy").freeEntry, true);
    assert.equal(byName.get("Bo, Jr.").topUp, true);
    assert.equal(byName.get("Ana").entries, 2);
    assert.equal(byName.get("Ana").knockouts, 3);
    assert.equal(byName.get("Di").finishPlace, null);
    const paidId = listed.tournaments.find((row) => row.title === "Payout Night").id;
    const paid = await bodyOf(await api(`/api/clubs/current/tournaments/${paidId}`, { jar: copy }));
    assert.deepEqual(paid.players.map((player) => [player.name, player.payout]), [["Ana", 25], ["Bo, Jr.", 15]]);

    const rivalListed = await bodyOf(await api("/api/clubs/current/tournaments", { jar: rival }));
    assert.equal(rivalListed.tournaments.some((row) => row.title === "Payout Night"), false);
  });
});
