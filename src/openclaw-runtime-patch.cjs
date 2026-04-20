"use strict";

const PATCH_PREFIX = "[openclaw-patch]";
const HEALTH_REFRESH_INTERVAL_MS = 60_000;
const TELEGRAM_HEALTH_PROBE_SIGNATURE = "refreshGatewayHealthSnapshot({ probe: true })";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

const originalSetInterval = globalThis.setInterval;
const originalFetch = globalThis.fetch;

function log(message) {
  process.stderr.write(`${PATCH_PREFIX} ${message}\n`);
}

function shouldSuppressBackgroundProbe(callback, delay) {
  if (delay !== HEALTH_REFRESH_INTERVAL_MS || typeof callback !== "function") {
    return false;
  }

  const source = Function.prototype.toString.call(callback);
  return source.includes(TELEGRAM_HEALTH_PROBE_SIGNATURE);
}

log(`hook-loaded pid=${process.pid}`);

globalThis.setInterval = function patchedSetInterval(callback, delay, ...args) {
  if (shouldSuppressBackgroundProbe(callback, delay)) {
    log("suppressing background probe=true health interval");
    return originalSetInterval(function suppressedBackgroundProbe() {}, delay, ...args);
  }
  return originalSetInterval(callback, delay, ...args);
};

if (
  process.env.OPENCLAW_DISABLE_OPENROUTER_MODEL_CATALOG === "1" &&
  typeof originalFetch === "function"
) {
  globalThis.fetch = async function patchedFetch(input, init) {
    const url =
      typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : "";
    if (url === OPENROUTER_MODELS_URL) {
      log("suppressing OpenRouter model catalog fetch");
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }
    return originalFetch.call(this, input, init);
  };
}
