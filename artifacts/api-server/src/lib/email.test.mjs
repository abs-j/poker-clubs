import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { devOutbox, emailMode, sendEmail } from "./email.ts";
import { resetPasswordMessage, verifyEmailMessage } from "./email-templates.ts";

const withEnv = async (env, fn) => {
  const saved = {};
  for (const key of Object.keys(env)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  try { return await fn(); } finally { for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value); }
};

test("the mode follows the environment: key means resend, no key means log, or off in production", async () => {
  await withEnv({ RESEND_API_KEY: "re_x", NODE_ENV: "production" }, () => assert.equal(emailMode(), "resend"));
  await withEnv({ RESEND_API_KEY: undefined, NODE_ENV: "production" }, () => assert.equal(emailMode(), "off"));
  await withEnv({ RESEND_API_KEY: undefined, NODE_ENV: "development" }, () => assert.equal(emailMode(), "log"));
});

test("log mode keeps the email in memory and sends nothing", async () => {
  await withEnv({ RESEND_API_KEY: undefined, NODE_ENV: "development" }, async () => {
    const before = devOutbox.length;
    await sendEmail({ to: "a@example.com", subject: "Hi", text: "body", html: "<p>body</p>" });
    assert.equal(devOutbox.length, before + 1);
    assert.equal(devOutbox.at(-1).to, "a@example.com");
  });
});

test("off mode refuses rather than pretending to send", async () => {
  await withEnv({ RESEND_API_KEY: undefined, NODE_ENV: "production" }, async () => {
    await assert.rejects(() => sendEmail({ to: "a@example.com", subject: "s", text: "t", html: "h" }), /not configured/);
  });
});

async function fakeResend(status, body) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], body: JSON.parse(raw) });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("resend mode posts to /emails with the key, sender, recipient and both bodies", async () => {
  const fake = await fakeResend(200, { id: "abc" });
  try {
    await withEnv({ RESEND_API_KEY: "re_test", RESEND_API_URL: fake.url, EMAIL_FROM: "Club <hi@club.example>" }, () =>
      sendEmail({ to: "sam@example.com", subject: "Hello", text: "plain", html: "<p>rich</p>" }));
    assert.equal(fake.seen.length, 1);
    const request = fake.seen[0];
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/emails");
    assert.equal(request.auth, "Bearer re_test");
    assert.equal(request.type, "application/json");
    assert.deepEqual(request.body, { from: "Club <hi@club.example>", to: ["sam@example.com"], subject: "Hello", html: "<p>rich</p>", text: "plain" });
  } finally { await fake.close(); }
});

test("a provider error surfaces with its status, so it can be logged", async () => {
  const fake = await fakeResend(403, { name: "validation_error", message: "domain not verified" });
  try {
    await withEnv({ RESEND_API_KEY: "re_test", RESEND_API_URL: fake.url }, async () => {
      await assert.rejects(() => sendEmail({ to: "a@example.com", subject: "s", text: "t", html: "h" }), /Resend returned 403.*domain not verified/);
    });
  } finally { await fake.close(); }
});

test("templates carry the link in both versions and escape what people typed", () => {
  const url = "https://club.example/reset-password?token=abc&x=1";
  const reset = resetPasswordMessage({ to: "a@example.com", name: "Sam Smith", url });
  assert.match(reset.text, /https:\/\/club\.example\/reset-password\?token=abc&x=1/);
  assert.match(reset.html, /token=abc&amp;x=1/);
  assert.match(reset.text, /Hi Sam,/);
  assert.match(verifyEmailMessage({ to: "a@example.com", name: "Al", url }).subject, /Confirm your email/);
  const tricky = resetPasswordMessage({ to: "a@example.com", name: "<b>Bold</b>", url });
  assert.doesNotMatch(tricky.html, /<b>Bold<\/b>/);
});
