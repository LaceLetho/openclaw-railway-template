"use strict";

const PATCH_PREFIX = "[openclaw-patch]";
const HEALTH_REFRESH_INTERVAL_MS = 60_000;
const TELEGRAM_HEALTH_PROBE_SIGNATURE = "refreshGatewayHealthSnapshot({ probe: true })";

const originalSetInterval = globalThis.setInterval;

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
