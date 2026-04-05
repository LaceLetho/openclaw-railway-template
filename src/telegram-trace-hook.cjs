"use strict";

const http = require("node:http");
const https = require("node:https");

const TRACE_PREFIX = "[telegram-trace]";
const TELEGRAM_HOSTS = new Set(["api.telegram.org", "api.telegram.org:443"]);

function logTrace(target, sourceLabel) {
  if (!target) {
    return;
  }
  const method = String(target.method || "GET").toUpperCase();
  const path = target.path || "/";
  process.stderr.write(
    `${TRACE_PREFIX} source=${sourceLabel} method=${method} host=${target.hostname} path=${path}\n`,
  );
}

function sanitizePath(pathname) {
  if (typeof pathname !== "string") {
    return "/";
  }
  return pathname.replace(/\/bot[^/]+/g, "/bot<redacted>");
}

function extractRequestTarget(args) {
  const [input, options] = args;

  if (input instanceof URL) {
    return {
      protocol: input.protocol,
      hostname: input.hostname,
      port: input.port,
      method: options?.method || "GET",
      path: sanitizePath(`${input.pathname}${input.search}`),
    };
  }

  if (typeof input === "string") {
    try {
      const parsed = new URL(input);
      return {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        method: options?.method || "GET",
        path: sanitizePath(`${parsed.pathname}${parsed.search}`),
      };
    } catch {
      return {
        protocol: "http:",
        hostname: options?.hostname || options?.host || "",
        port: options?.port,
        method: options?.method || "GET",
        path: sanitizePath(input),
      };
    }
  }

  if (input && typeof input === "object") {
    const protocol = input.protocol || options?.protocol || "http:";
    const hostname = input.hostname || input.host || options?.hostname || options?.host || "";
    const path = input.path || input.pathname || options?.path || options?.pathname || "/";
    return {
      protocol,
      hostname,
      port: input.port || options?.port,
      method: input.method || options?.method || "GET",
      path: sanitizePath(path),
    };
  }

  return null;
}

function shouldTrace(target) {
  if (!target) {
    return false;
  }
  if (TELEGRAM_HOSTS.has(target.hostname)) {
    return true;
  }
  if (target.port) {
    return TELEGRAM_HOSTS.has(`${target.hostname}:${target.port}`);
  }
  return false;
}

function patchRequest(moduleRef, label) {
  const originalRequest = moduleRef.request;
  if (typeof originalRequest !== "function") {
    return;
  }
  moduleRef.request = function patchedRequest(...args) {
    const target = extractRequestTarget(args);
    if (shouldTrace(target)) {
      logTrace(target, label);
    }
    return originalRequest.apply(this, args);
  };
}

patchRequest(http, "http");
patchRequest(https, "https");

function extractFetchTarget(input, init) {
  if (input instanceof URL) {
    return {
      hostname: input.hostname,
      port: input.port,
      method: init?.method || "GET",
      path: sanitizePath(`${input.pathname}${input.search}`),
    };
  }

  if (typeof input === "string") {
    try {
      const parsed = new URL(input);
      return {
        hostname: parsed.hostname,
        port: parsed.port,
        method: init?.method || "GET",
        path: sanitizePath(`${parsed.pathname}${parsed.search}`),
      };
    } catch {
      return null;
    }
  }

  if (input && typeof input === "object") {
    const url =
      typeof input.url === "string"
        ? input.url
        : input.url instanceof URL
          ? input.url.toString()
          : null;
    const method =
      init?.method ||
      (typeof input.method === "string" ? input.method : undefined) ||
      "GET";
    if (!url) {
      return null;
    }
    try {
      const parsed = new URL(url);
      return {
        hostname: parsed.hostname,
        port: parsed.port,
        method,
        path: sanitizePath(`${parsed.pathname}${parsed.search}`),
      };
    } catch {
      return null;
    }
  }

  return null;
}

function patchFetch(sourceObj, key, label) {
  const original = sourceObj && sourceObj[key];
  if (typeof original !== "function") {
    return;
  }
  sourceObj[key] = function patchedFetch(input, init) {
    const target = extractFetchTarget(input, init);
    if (shouldTrace(target)) {
      logTrace(target, label);
    }
    return original.apply(this, arguments);
  };
}

patchFetch(globalThis, "fetch", "global-fetch");

try {
  const undici = require("undici");
  patchFetch(undici, "fetch", "undici-fetch");
  const originalRequest = undici.request;
  if (typeof originalRequest === "function") {
    undici.request = function patchedUndiciRequest(input, options) {
      const target = extractFetchTarget(input, options);
      if (shouldTrace(target)) {
        logTrace(target, "undici-request");
      }
      return originalRequest.apply(this, arguments);
    };
  }
} catch {
  // ignore if undici is unavailable
}
