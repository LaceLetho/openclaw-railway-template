import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import express from "express";
import httpProxy from "http-proxy";

// Migrate deprecated CLAWDBOT_* env vars → OPENCLAW_* so existing Railway deployments
// keep working. Users should update their Railway Variables to use the new names.
for (const suffix of ["PUBLIC_PORT", "STATE_DIR", "WORKSPACE_DIR", "GATEWAY_TOKEN", "CONFIG_PATH"]) {
  const oldKey = `CLAWDBOT_${suffix}`;
  const newKey = `OPENCLAW_${suffix}`;
  if (process.env[oldKey] && !process.env[newKey]) {
    process.env[newKey] = process.env[oldKey];
  }
  delete process.env[oldKey];
}

// Railway injects PORT at runtime and routes traffic to that port.
const PORT = Number.parseInt(process.env.PORT ?? process.env.OPENCLAW_PUBLIC_PORT ?? "3000", 10);

const STATE_DIR =
  process.env.OPENCLAW_STATE_DIR?.trim() ||
  path.join(os.homedir(), ".openclaw");

const WORKSPACE_DIR =
  process.env.OPENCLAW_WORKSPACE_DIR?.trim() ||
  path.join(STATE_DIR, "workspace");

// Gateway admin token — must be stable across restarts.
// If not provided via env, persist it in the state dir.
function resolveGatewayToken() {
  const envTok = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (envTok) return envTok;

  const tokenPath = path.join(STATE_DIR, "gateway.token");
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // ignore
  }

  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
  } catch {
    // best-effort
  }
  return generated;
}

const OPENCLAW_GATEWAY_TOKEN = resolveGatewayToken();
process.env.OPENCLAW_GATEWAY_TOKEN = OPENCLAW_GATEWAY_TOKEN;

// Where the gateway will listen internally (we proxy to it).
const INTERNAL_GATEWAY_PORT = Number.parseInt(process.env.INTERNAL_GATEWAY_PORT ?? "18789", 10);
const INTERNAL_GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_TARGET = `http://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}`;

// Where the Feishu webhook server listens (started by the feishu channel plugin).
// Must match channels.feishu.webhookPort in openclaw config (default: 3000).
const FEISHU_WEBHOOK_PORT = Number.parseInt(process.env.FEISHU_WEBHOOK_PORT ?? "3000", 10);
const FEISHU_WEBHOOK_TARGET = `http://127.0.0.1:${FEISHU_WEBHOOK_PORT}`;

const OPENCLAW_ENTRY = process.env.OPENCLAW_ENTRY?.trim() || "/openclaw/dist/entry.js";
const OPENCLAW_NODE = process.env.OPENCLAW_NODE?.trim() || "node";

function clawArgs(args) {
  return [OPENCLAW_ENTRY, ...args];
}

function resolveConfigCandidates() {
  const explicit = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (explicit) return [explicit];
  return [path.join(STATE_DIR, "openclaw.json")];
}

function isConfigured() {
  try {
    return resolveConfigCandidates().some((candidate) => fs.existsSync(candidate));
  } catch {
    return false;
  }
}

// One-time migration: rename legacy config files to openclaw.json.
(function migrateLegacyConfigFile() {
  if (process.env.OPENCLAW_CONFIG_PATH?.trim()) return;

  const canonical = path.join(STATE_DIR, "openclaw.json");
  if (fs.existsSync(canonical)) return;

  for (const legacy of ["clawdbot.json", "moltbot.json"]) {
    const legacyPath = path.join(STATE_DIR, legacy);
    try {
      if (fs.existsSync(legacyPath)) {
        fs.renameSync(legacyPath, canonical);
        console.log(`[migration] Renamed ${legacy} → openclaw.json`);
        return;
      }
    } catch (err) {
      console.warn(`[migration] Failed to rename ${legacy}: ${err}`);
    }
  }
})();

let gatewayProc = null;
let gatewayStarting = null;

let lastGatewayError = null;
let lastGatewayExit = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForGatewayReady(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const start = Date.now();
  const authHeader = `Bearer ${OPENCLAW_GATEWAY_TOKEN}`;
  while (Date.now() - start < timeoutMs) {
    try {
      const paths = ["/openclaw", "/"];
      for (const p of paths) {
        try {
          const res = await fetch(`${GATEWAY_TARGET}${p}`, {
            method: "GET",
            headers: { Authorization: authHeader },
          });
          if (res) return true;
        } catch {
          // try next
        }
      }
    } catch {
      // not ready
    }
    await sleep(250);
  }
  return false;
}

async function startGateway() {
  if (gatewayProc) return;
  if (!isConfigured()) throw new Error("Gateway cannot start: not configured");

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const args = [
    "gateway",
    "run",
    "--bind",
    "loopback",
    "--port",
    String(INTERNAL_GATEWAY_PORT),
    "--auth",
    "token",
    "--token",
    OPENCLAW_GATEWAY_TOKEN,
  ];

  gatewayProc = childProcess.spawn(OPENCLAW_NODE, clawArgs(args), {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: STATE_DIR,
      OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  gatewayProc.on("error", (err) => {
    const msg = `[gateway] spawn error: ${String(err)}`;
    console.error(msg);
    lastGatewayError = msg;
    gatewayProc = null;
  });

  gatewayProc.on("exit", (code, signal) => {
    const msg = `[gateway] exited code=${code} signal=${signal}`;
    console.error(msg);
    lastGatewayExit = { code, signal, at: new Date().toISOString() };
    gatewayProc = null;
  });
}


async function ensureGatewayRunning() {
  if (!isConfigured()) return { ok: false, reason: "not configured" };
  if (gatewayProc) return { ok: true };
  if (!gatewayStarting) {
    gatewayStarting = (async () => {
      try {
        lastGatewayError = null;
        await startGateway();
        const ready = await waitForGatewayReady({ timeoutMs: 20_000 });
        if (!ready) {
          if (gatewayProc) {
            try {
              gatewayProc.kill("SIGTERM");
            } catch {
              // ignore
            }
            gatewayProc = null;
          }
          throw new Error("Gateway did not become ready in time");
        }
      } catch (err) {
        const msg = `[gateway] start failure: ${String(err)}`;
        lastGatewayError = msg;
        throw err;
      }
    })().finally(() => {
      gatewayStarting = null;
    });
  }
  await gatewayStarting;
  return { ok: true };
}


function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 120_000;

    const proc = childProcess.spawn(cmd, args, {
      ...opts,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });

    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    let killTimer;
    const timer = setTimeout(() => {
      try { proc.kill("SIGTERM"); } catch {}
      killTimer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
      }, 2_000);
      out += `\n[timeout] Command exceeded ${timeoutMs}ms and was terminated.\n`;
      resolve({ code: 124, output: out });
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: code ?? 0, output: out });
    });
  });
}

// Protect the dashboard with a password (HTTP Basic Auth).
// Set PASSWORD in Railway Variables. Without it the service starts but all non-healthz
// requests are rejected with a 401 to prevent open access.
const DASHBOARD_PASSWORD = process.env.PASSWORD?.trim();

// Paths that bypass HTTP Basic Auth (third-party webhooks with their own auth mechanisms).
const PUBLIC_PATHS = [
  "/healthz",
  "/feishu/events", // Lark/Feishu webhook — verified by gateway via X-Lark-Signature
  "/hooks", // OpenClaw hooks — verified by gateway via token
];

function requireAuth(req, res, next) {
  // Railway health probe and third-party webhooks — always allow.
  if (PUBLIC_PATHS.some((p) => req.path === p || req.path.startsWith(p + "/"))) return next();

  if (!DASHBOARD_PASSWORD) {
    return res.status(503).type("text/plain").send(
      "PASSWORD env var is not set. Set it in Railway Variables to enable access.\n",
    );
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="OpenClaw"');
    return res.status(401).send("Authentication required\n");
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const password = decoded.slice(decoded.indexOf(":") + 1);
  if (password !== DASHBOARD_PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="OpenClaw"');
    return res.status(401).send("Invalid password\n");
  }
  return next();
}

const app = express();
app.disable("x-powered-by");

// Health check (no auth) for Railway probes.
app.get("/healthz", async (_req, res) => {
  let gatewayReachable = false;
  if (isConfigured()) {
    try {
      const net = await import("node:net");
      gatewayReachable = await new Promise((resolve) => {
        const sock = net.createConnection({
          host: INTERNAL_GATEWAY_HOST,
          port: INTERNAL_GATEWAY_PORT,
          timeout: 750,
        });
        const done = (ok) => { try { sock.destroy(); } catch {} resolve(ok); };
        sock.on("connect", () => done(true));
        sock.on("timeout", () => done(false));
        sock.on("error", () => done(false));
      });
    } catch {
      gatewayReachable = false;
    }
  }

  res.json({
    ok: true,
    wrapper: { configured: isConfigured(), stateDir: STATE_DIR, workspaceDir: WORKSPACE_DIR },
    gateway: {
      target: GATEWAY_TARGET,
      reachable: gatewayReachable,
      lastError: lastGatewayError,
      lastExit: lastGatewayExit,
    },
  });
});

// Proxy everything to the gateway.
const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
});

proxy.on("error", (err, _req, res) => {
  console.error("[proxy]", err);
  try {
    if (res && typeof res.writeHead === "function" && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Gateway unavailable\n");
    }
  } catch {
    // ignore
  }
});

function attachGatewayAuthHeader(req) {
  if (!req?.headers?.authorization && OPENCLAW_GATEWAY_TOKEN) {
    req.headers.authorization = `Bearer ${OPENCLAW_GATEWAY_TOKEN}`;
  }
}

proxy.on("proxyReqWs", (_proxyReq, req) => {
  attachGatewayAuthHeader(req);
});

// Separate proxy for the Feishu/Lark webhook server (runs on FEISHU_WEBHOOK_PORT).
// A dedicated proxy instance is needed so we can intercept the response and fix
// Content-Type: the Lark SDK returns text/plain for challenge responses, but Lark
// platform requires application/json or it rejects with "not valid JSON format".
const feishuProxy = httpProxy.createProxyServer({ target: FEISHU_WEBHOOK_TARGET });

feishuProxy.on("error", (err, _req, res) => {
  console.error("[feishu-proxy]", err);
  try {
    if (res && typeof res.writeHead === "function" && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feishu webhook server unavailable" }));
    }
  } catch {
    // ignore
  }
});

feishuProxy.on("proxyRes", (proxyRes) => {
  // Lark platform requires Content-Type: application/json on all webhook responses.
  if (proxyRes.headers["content-type"]?.startsWith("text/plain")) {
    proxyRes.headers["content-type"] = "application/json; charset=utf-8";
  }
});

// Route Feishu/Lark webhook events to the feishu channel's standalone HTTP server.
// NOTE: must NOT use app.use("/feishu", ...) — Express strips the matched prefix
// from req.url, so the proxy would forward /events instead of /feishu/events.
app.use((req, res, next) => {
  if (req.path === "/feishu" || req.path.startsWith("/feishu/")) {
    return feishuProxy.web(req, res);
  }
  return next();
});

app.use(requireAuth, async (req, res) => {
  try {
    await ensureGatewayRunning();
  } catch (err) {
    return res.status(503).type("text/plain").send(
      `Gateway not ready: ${String(err)}\n${lastGatewayError ?? ""}\n`,
    );
  }
  attachGatewayAuthHeader(req);
  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

const server = app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[wrapper] listening on :${PORT}`);
  console.log(`[wrapper] state dir: ${STATE_DIR}`);
  console.log(`[wrapper] workspace dir: ${WORKSPACE_DIR}`);

  try { fs.mkdirSync(path.join(STATE_DIR, "credentials"), { recursive: true }); } catch {}
  try { fs.chmodSync(path.join(STATE_DIR, "credentials"), 0o700); } catch {}
  try { fs.chmodSync(STATE_DIR, 0o700); } catch {}

  console.log(`[wrapper] gateway token: ${OPENCLAW_GATEWAY_TOKEN ? "(set)" : "(missing)"}`);
  console.log(`[wrapper] gateway target: ${GATEWAY_TARGET}`);

  // Sync gateway tokens in config on every startup (handles token rotation).
  if (isConfigured() && OPENCLAW_GATEWAY_TOKEN) {
    console.log("[wrapper] syncing gateway config...");
    try {
      await runCmd(OPENCLAW_NODE, clawArgs(["config", "set", "gateway.auth.mode", "token"]));
      await runCmd(OPENCLAW_NODE, clawArgs(["config", "set", "gateway.auth.token", OPENCLAW_GATEWAY_TOKEN]));
      await runCmd(OPENCLAW_NODE, clawArgs(["config", "set", "gateway.remote.token", OPENCLAW_GATEWAY_TOKEN]));
      await setJsonConfig("gateway.trustedProxies", ["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
      console.log("[wrapper] gateway config synced");
    } catch (err) {
      console.warn(`[wrapper] failed to sync gateway config: ${String(err)}`);
    }
  }

  // Optional bootstrap script under workspace dir.
  const bootstrapPath = path.join(WORKSPACE_DIR, "bootstrap.sh");
  if (fs.existsSync(bootstrapPath)) {
    console.log(`[wrapper] running bootstrap: ${bootstrapPath}`);
    try {
      await runCmd("bash", [bootstrapPath], {
        env: { ...process.env, OPENCLAW_STATE_DIR: STATE_DIR, OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR },
        timeoutMs: 10 * 60 * 1000,
      });
      console.log("[wrapper] bootstrap complete");
    } catch (err) {
      console.warn(`[wrapper] bootstrap failed (continuing): ${String(err)}`);
    }
  }

  if (isConfigured()) {
    console.log("[wrapper] config detected, starting gateway...");
    try {
      await ensureGatewayRunning();
      console.log("[wrapper] gateway ready");
    } catch (err) {
      console.error(`[wrapper] gateway failed to start at boot: ${String(err)}`);
    }
  }
});

server.on("upgrade", async (req, socket, head) => {
  if (!isConfigured()) {
    socket.destroy();
    return;
  }
  try {
    await ensureGatewayRunning();
  } catch {
    socket.destroy();
    return;
  }
  attachGatewayAuthHeader(req);
  proxy.ws(req, socket, head, { target: GATEWAY_TARGET });
});

process.on("SIGTERM", () => {
  try {
    if (gatewayProc) gatewayProc.kill("SIGTERM");
  } catch {
    // ignore
  }
  try {
    server.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
  setTimeout(() => process.exit(0), 5_000).unref?.();
});
