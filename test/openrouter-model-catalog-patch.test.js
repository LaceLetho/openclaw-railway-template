import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const serverSrc = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const patchSrc = fs.readFileSync(
  new URL("../src/openclaw-runtime-patch.cjs", import.meta.url),
  "utf8",
);
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("server enables runtime patch when OpenRouter model catalog suppression is requested", () => {
  assert.match(serverSrc, /OPENCLAW_DISABLE_OPENROUTER_MODEL_CATALOG === "1"/);
});

test("runtime patch suppresses OpenRouter model catalog fetches", () => {
  assert.match(patchSrc, /OPENROUTER_MODELS_URL = "https:\/\/openrouter\.ai\/api\/v1\/models"/);
  assert.match(patchSrc, /suppressing OpenRouter model catalog fetch/);
  assert.match(patchSrc, /new Response\(JSON\.stringify\(\{ data: \[\] \}\)/);
});

test("README documents OpenRouter model catalog suppression flag", () => {
  assert.match(readme, /OPENCLAW_DISABLE_OPENROUTER_MODEL_CATALOG=1/);
});
