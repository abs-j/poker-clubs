import assert from "node:assert/strict";
import test from "node:test";
import { trustedOrigin } from "./origins.ts";

const withEnv = (env, fn) => {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  try { return fn(); } finally { for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value); }
};

test("the app's own address and configured extras are trusted", () => {
  withEnv({ APP_URL: "https://cards.example/", TRUSTED_ORIGINS: "https://www.cards.example, https://staging.cards.example", NODE_ENV: "production" }, () => {
    assert.equal(trustedOrigin("https://cards.example"), true);
    assert.equal(trustedOrigin("https://www.cards.example"), true);
    assert.equal(trustedOrigin("https://staging.cards.example"), true);
  });
});

test("anything else is not, including look-alikes and missing values", () => {
  withEnv({ APP_URL: "https://cards.example", TRUSTED_ORIGINS: undefined, NODE_ENV: "production" }, () => {
    assert.equal(trustedOrigin("https://evil.example"), false);
    assert.equal(trustedOrigin("https://cards.example.evil.example"), false);
    assert.equal(trustedOrigin("http://cards.example"), false);
    assert.equal(trustedOrigin(undefined), false);
    assert.equal(trustedOrigin(null), false);
    assert.equal(trustedOrigin(""), false);
  });
});

test("localhost is trusted for development only", () => {
  withEnv({ APP_URL: undefined, NODE_ENV: "development" }, () => {
    assert.equal(trustedOrigin("http://localhost:5199"), true);
    assert.equal(trustedOrigin("http://127.0.0.1:3000"), true);
    assert.equal(trustedOrigin("http://localhost.evil.example"), false);
  });
  withEnv({ APP_URL: "https://cards.example", NODE_ENV: "production" }, () => {
    assert.equal(trustedOrigin("http://localhost:5199"), false);
  });
});
