"use strict";

const http = require("node:http");
const https = require("node:https");

const TRACE_PREFIX = "[telegram-trace]";
const TELEGRAM_HOSTS = new Set(["api.telegram.org", "api.telegram.org:443"]);

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
      const method = String(target.method || "GET").toUpperCase();
      const path = target.path || "/";
      process.stderr.write(
        `${TRACE_PREFIX} transport=${label} method=${method} host=${target.hostname} path=${path}\n`,
      );
    }
    return originalRequest.apply(this, args);
  };
}

patchRequest(http, "http");
patchRequest(https, "https");
