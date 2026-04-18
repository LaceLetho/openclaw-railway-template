import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Dockerfile prioritizes bundled openclaw binary in PATH", () => {
  const src = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(src, /ENV PATH="\/usr\/local\/bin:\/data\/npm\/bin:\/data\/pnpm:\$\{PATH\}"/);
});

test("server cleans persisted global openclaw before startup", () => {
  const src = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(src, /const PERSISTED_GLOBAL_OPENCLAW_BIN = "\/data\/npm\/bin\/openclaw"/);
  assert.match(src, /npm", \["uninstall", "-g", "openclaw"\]/);
  assert.match(src, /await removePersistedGlobalOpenClaw\(\);/);
});
