// Platform usage: an email allow-list, fail closed, and a read-only view across clubs.
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
import { count } from "drizzle-orm";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for platform admin tests in CI");
}

process.env.SESSION_SECRET ??= "platform-admin-test-session-secret-not-used-elsewhere";
process.env.LOG_LEVEL ??= "silent";
delete process.env.PLATFORM_ADMIN_EMAILS;

const PASS = "platform-admin-pass-9";
let base = "";
let server;
let bundleDir = "";
let db;
let memberUsage;
let siteVisits;
let clubSessions;

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

function allow(value) {
  if (value === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = value;
}

async function signUp(jar, name) {
  const email = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${stamp()}@example.com`;
  const response = await api("/api/identity/sign-up/email", {
    jar,
    method: "POST",
    body: { name, email, password: PASS },
  });
  assert.equal(response.ok, true, `sign-up ${response.status} ${await response.clone().text()}`);
  return email;
}

async function newClub(playerName, clubName) {
  const jar = cookieJar();
  const email = await signUp(jar, playerName);
  const created = await api("/api/clubs", { jar, method: "POST", body: { name: clubName, playerName } });
  assert.equal(created.status, 201, `create club ${created.status}`);
  return { jar, email };
}

async function recordUsage(jar, section, activeSeconds) {
  const response = await api("/api/poker/usage", {
    jar,
    method: "POST",
    body: { section, pageView: true, activeSeconds },
  });
  assert.equal(response.status, 202, `usage ${response.status} ${await response.clone().text()}`);
  await api("/api/auth/member/session", { jar });
}

function clubNamed(payload, name) {
  return payload.clubs?.find((club) => club.name === name) ?? null;
}

async function tableCount(table) {
  const [row] = await db.select({ n: count() }).from(table);
  return Number(row.n);
}

describe("platform usage", { skip: process.env.DATABASE_URL ? false : "DATABASE_URL is required", concurrency: 1 }, () => {
  before(async () => {
    globalThis.require = createRequire(import.meta.url);
    bundleDir = await mkdtemp(path.join(tmpdir(), "platform-admin-api-"));
    const sourceDir = path.resolve(import.meta.dirname, "..");
    await build({
      stdin: {
        contents: `import app from "./app.ts";
import { pool, db, memberUsage, siteVisits, clubSessions } from "@workspace/db";
export default app;
export { pool, db, memberUsage, siteVisits, clubSessions };
`,
        resolveDir: sourceDir,
        sourcefile: "platform-admin-test-app.ts",
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
    memberUsage = appModule.memberUsage;
    siteVisits = appModule.siteVisits;
    clubSessions = appModule.clubSessions;
    server = createServer(appModule.default);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (db) {
      const { pool } = await import(pathToFileURL(path.join(bundleDir, "stdin.mjs")).href);
      await pool.end();
    }
    if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
  });

  test("an empty allow-list makes nobody a platform admin", async () => {
    const owner = await newClub("Ada Closed", `Closed Club ${stamp()}`);
    for (const value of [undefined, "", "   ", " , , "]) {
      allow(value);
      const response = await api("/api/platform/usage", { jar: owner.jar });
      assert.equal(response.status, 403, `allow-list ${JSON.stringify(value ?? "")} returned ${response.status}`);
      const body = await bodyOf(response);
      assert.equal(JSON.stringify(body).includes(owner.email), false);
      assert.equal(JSON.stringify(body).includes("Closed Club"), false);
    }
    assert.equal((await api("/api/platform/usage")).status, 401);
    const session = await bodyOf(await api("/api/auth/member/session", { jar: owner.jar }));
    assert.equal(session.platformAdmin, false);
  });

  test("a club owner who is not on the list is denied, and the old usage routes are gone", async () => {
    const owner = await newClub("Bea Owner", `Bea Club ${stamp()}`);
    const guest = cookieJar();
    await signUp(guest, "Bea Guest");
    const invite = await api("/api/clubs/current/invites", { jar: owner.jar, method: "POST", body: {} });
    assert.equal(invite.status, 201);
    const code = (await bodyOf(invite)).invite.code;
    assert.equal((await api(`/api/invites/${code}/accept`, { jar: guest, method: "POST", body: { name: "Bea Guest" } })).ok, true);

    allow("someone-else@example.com");
    assert.equal((await api("/api/platform/usage", { jar: owner.jar })).status, 403);
    assert.equal((await api("/api/platform/usage", { jar: guest })).status, 403);
    assert.equal((await api("/api/platform/usage")).status, 401);
    for (const path of ["/api/admin/visits", "/api/admin/members", "/api/admin/audit", "/api/admin/health"]) {
      assert.equal((await api(path, { jar: owner.jar })).status, 404, `${path} should be retired`);
      assert.equal((await api(path)).status, 404, `${path} should be retired when signed out`);
    }
    const session = await bodyOf(await api("/api/auth/member/session", { jar: owner.jar }));
    assert.equal(session.authenticated, true);
    assert.equal(session.platformAdmin, false);
  });

  test("only the allow-listed owner can read usage from every club, and reading changes nothing", async () => {
    const alphaName = `Alpha Club ${stamp()}`;
    const betaName = `Beta Club ${stamp()}`;
    const alpha = await newClub("Cara Alpha", alphaName);
    const beta = await newClub("Drew Beta", betaName);
    await recordUsage(alpha.jar, "live", 10);
    await recordUsage(beta.jar, "sessions", 25);

    allow(`  ${alpha.email.toUpperCase()} , other@example.com `);
    const before = {
      usage: await tableCount(memberUsage),
      visits: await tableCount(siteVisits),
      nights: await tableCount(clubSessions),
    };

    const allowed = await api("/api/platform/usage?clubId=1", { jar: alpha.jar });
    assert.equal(allowed.status, 200, await allowed.clone().text());
    const payload = await bodyOf(allowed);
    assert.equal(JSON.stringify(payload).includes("@"), false, "usage must not include email addresses");

    const alphaClub = clubNamed(payload, alphaName);
    const betaClub = clubNamed(payload, betaName);
    assert.ok(alphaClub, "the owner's own club is missing");
    assert.ok(betaClub, "the other club is missing");
    const cara = alphaClub.members.find((member) => member.name === "Cara Alpha");
    const drew = betaClub.members.find((member) => member.name === "Drew Beta");
    assert.ok(cara, "Cara is missing from her club");
    assert.ok(drew, "Drew is missing from the other club");
    assert.ok(cara.signIns >= 1, "sign-ins were not counted");
    assert.equal(cara.sections.find((section) => section.section === "live")?.activeSeconds, 10);
    assert.equal(drew.sections.find((section) => section.section === "sessions")?.activeSeconds, 25);
    assert.ok(betaClub.activeSeconds >= 25);

    const denied = await api("/api/platform/usage", { jar: beta.jar });
    assert.equal(denied.status, 403);
    const deniedBody = JSON.stringify(await bodyOf(denied));
    assert.equal(deniedBody.includes(alphaName), false);
    assert.equal(deniedBody.includes("Cara Alpha"), false);

    allow(beta.email);
    const swapped = await bodyOf(await api("/api/platform/usage", { jar: beta.jar }));
    assert.ok(clubNamed(swapped, alphaName), "turning the list on for the other owner should reveal both clubs");
    assert.equal((await api("/api/platform/usage", { jar: alpha.jar })).status, 403);

    allow(`not-${alpha.email}`);
    assert.equal((await api("/api/platform/usage", { jar: alpha.jar })).status, 403, "a lookalike address must not match");

    allow(alpha.email);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await api("/api/platform/usage", { jar: alpha.jar, method, body: { name: "Renamed" } });
      assert.equal(response.status, 404, `${method} should not be a usage route`);
    }
    const after = {
      usage: await tableCount(memberUsage),
      visits: await tableCount(siteVisits),
      nights: await tableCount(clubSessions),
    };
    assert.deepEqual(after, before, "reading usage changed stored rows");

    const session = await bodyOf(await api("/api/auth/member/session", { jar: alpha.jar }));
    assert.equal(session.platformAdmin, true);
  });
});
