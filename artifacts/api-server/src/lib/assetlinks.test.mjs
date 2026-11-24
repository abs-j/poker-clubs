import assert from "node:assert/strict";
import test from "node:test";
import { assetLinks } from "./assetlinks.ts";

const withEnv = (env, fn) => {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  try { return fn(); } finally { for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value); }
};

test("returns null when either variable is unset or empty", () => {
  withEnv({ ANDROID_PACKAGE_NAME: undefined, ANDROID_CERT_SHA256: undefined }, () => assert.equal(assetLinks(process.env), null));
  withEnv({ ANDROID_PACKAGE_NAME: "com.example.app", ANDROID_CERT_SHA256: undefined }, () => assert.equal(assetLinks(process.env), null));
  withEnv({ ANDROID_PACKAGE_NAME: undefined, ANDROID_CERT_SHA256: "AA:BB" }, () => assert.equal(assetLinks(process.env), null));
  withEnv({ ANDROID_PACKAGE_NAME: "com.example.app", ANDROID_CERT_SHA256: " , " }, () => assert.equal(assetLinks(process.env), null));
});

test("normalises fingerprints and passes the package name through", () => {
  withEnv({ ANDROID_PACKAGE_NAME: "com.example.app", ANDROID_CERT_SHA256: " aa:bb:cc , dd:ee:ff ,," }, () => {
    assert.deepEqual(assetLinks(process.env), [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "com.example.app", sha256_cert_fingerprints: ["AA:BB:CC", "DD:EE:FF"] },
      },
    ]);
  });
});
