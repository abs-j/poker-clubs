import test from "node:test";
import assert from "node:assert/strict";
import { cleanModelId, readNightWithAi, AiNotesError } from "./ai-notes.ts";

test("model ids", () => {
  assert.equal(cleanModelId("google/gemini-2.5-flash-lite"), "google/gemini-2.5-flash-lite");
  assert.equal(cleanModelId("meta-llama/llama-3.2-11b-vision-instruct:free"), "meta-llama/llama-3.2-11b-vision-instruct:free");
  assert.equal(cleanModelId("no-slash"), null);
  assert.equal(cleanModelId("a/b c"), null);
});

test("sends notes with the club's key and returns the text", async () => {
  let seen;
  const fetcher = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ choices: [{ message: { content: " Ann - 20 -> 30 " } }] }), { status: 200 });
  };
  const text = await readNightWithAi({ text: "ann in 20 out 30" }, { apiKey: "k", model: "a/b" }, fetcher);
  assert.equal(text, "Ann - 20 -> 30");
  assert.equal(seen.init.headers.Authorization, "Bearer k");
  assert.equal(JSON.parse(seen.init.body).model, "a/b");
});

test("explains a rejected key and no credit", async () => {
  for (const [status, re] of [[401, /rejected/], [402, /credit/], [429, /rate/]]) {
    await assert.rejects(readNightWithAi({ text: "x" }, { apiKey: "k", model: "a/b" }, async () => new Response("{}", { status })), (e) => e instanceof AiNotesError && re.test(e.message));
  }
});
