import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("server exposes telegram webhook path as public and proxied", () => {
  const src = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(src, /TELEGRAM_WEBHOOK_PATH/);
  assert.match(src, /TELEGRAM_WEBHOOK_PORT/);
  assert.match(src, /const telegramProxy = httpProxy\.createProxyServer/);
  assert.match(src, /X-Telegram-Bot-Api-Secret-Token/);
  assert.match(src, /req\.path === TELEGRAM_WEBHOOK_PATH/);
});
