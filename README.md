# OpenClaw Railway Template

This repo packages **OpenClaw** for Railway with a minimal reverse proxy wrapper.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/fxd-c2?referralCode=Se0h8C&utm_medium=integration&utm_source=template&utm_campaign=generic)

## What you get

- **OpenClaw Gateway + Control UI** (served at `/` and `/openclaw`)
- Persistent state via **Railway Volume** (config/credentials/memory survive redeploys)
- HTTP Basic Auth protecting the entire service (`PASSWORD` env var)
- Health check endpoint at `/healthz`

## How it works

- The container runs a small Express wrapper server.
- The wrapper protects all routes (except `/healthz`) with HTTP Basic Auth using the `PASSWORD` env var.
- **OpenClaw is initialized manually via SSH** — run `openclaw onboard` once after first deploy.
- After initialization, the wrapper auto-starts the OpenClaw gateway on every boot and reverse-proxies all traffic (including WebSockets) to it.

## Onboarding guide

### 1. SSH into the service

```bash
# login into the server
railway ssh --project=<project-id> --service=<service-id> --environment=<environment-id>

# Optional: install Homebrew if you want an easier path for extra CLI tools / skills
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Run onboarding (one-time setup)
openclaw onboard \
  --workspace /data/workspace \
  --gateway-bind loopback \
  --gateway-port 18789 \
  --gateway-auth token \
  --gateway-token "$OPENCLAW_GATEWAY_TOKEN" \
  --no-install-daemon

# Allow your Railway domain in the Control UI
openclaw config set --json gateway.controlUi.allowedOrigins '["https://<your-domain>.up.railway.app"]'

# Trust the local reverse proxy used by this template
openclaw config set --json gateway.trustedProxies '["127.0.0.1","::1","::ffff:127.0.0.1"]'

# Enable full tools
openclaw config set --json tools.profile '"full"'

# If you install non-bundled plugins, pin an explicit allowlist
openclaw config set --json plugins.allow '["telegram","feishu"]'
```

### 2. Restart / Redeploy the Railway service

After onboarding, redeploy or restart the Railway service. The wrapper will detect the config and start the gateway automatically.

> In Railway / Docker, prefer restarting the **service/deployment** itself. `openclaw gateway restart` is aimed at daemon-style installs and can be misleading in container environments.

### 3. Approve Device Pairing

After visiting the Control UI for the first time, approve device pairing via SSH:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

---

## Common Commands

```bash
# SSH into service
railway ssh --project=<project-id> --service=<service-id> --environment=<env-id>

# Check status
openclaw status
openclaw health
openclaw doctor

# View gateway logs
railway logs

# Restart the Railway service / redeploy from the Railway UI or CLI
railway redeploy
```

---

## Upgrading OpenClaw

To upgrade to a newer version of OpenClaw, update the `OPENCLAW_GIT_REF` environment variable in Railway and redeploy:

1. Go to your Railway service → **Variables**
2. Set `OPENCLAW_GIT_REF` to the desired version tag (e.g. `v2026.3.8`)
3. Redeploy the service — Railway will rebuild the Docker image from that git ref

Your persistent state (config, credentials, memory) on the Railway Volume is unaffected by upgrades.

### Updating Plugins

For **built-in OpenClaw plugins**, SSH into the service and run:

```bash
openclaw plugins update --all
```

For **third-party or custom plugins**, updates need to be handled manually — either follow the plugin's own documentation, or ask OpenClaw to help by referencing the relevant project docs.

---

## Troubleshooting

### Service returns 503 on startup
OpenClaw has not been initialized yet. SSH in and run `openclaw onboard` (Step 5 above).

### "origin not allowed" in Control UI
```bash
openclaw config set --json gateway.controlUi.allowedOrigins '["https://your-app.up.railway.app"]'
```
Then restart the service.

### "pairing required" / disconnected
```bash
openclaw devices list
openclaw devices approve <requestId>
```

### Proxy warnings like `Proxy headers detected from untrusted address`
```bash
openclaw config set --json gateway.trustedProxies '["127.0.0.1","::1","::ffff:127.0.0.1"]'
```
This template runs a local reverse proxy in front of the gateway, so these loopback proxy addresses should be trusted.

### Non-bundled plugin warnings (`plugins.allow is empty`)
If you install third-party plugins, pin an explicit allowlist:
```bash
openclaw config set --json plugins.allow '["telegram","feishu","<your-plugin-id>"]'
```

### Telegram group allowlist gotcha
`channels.telegram.allowFrom` / `groupAllowFrom` expect **Telegram user IDs**, not group chat IDs. To allow a group or supergroup, configure it under `channels.telegram.groups` and set the per-group policy there.

### Hook sessions keep multiplying
If you use hooks heavily, consider pinning a default session key:
```bash
openclaw config set hooks.defaultSessionKey hook:ingress
```

### 502 Bad Gateway
- Confirm the Volume is mounted at `/data`
- Confirm `OPENCLAW_STATE_DIR` and `OPENCLAW_WORKSPACE_DIR` are set
- Check Railway logs: `railway logs`
- Visit `/healthz` to see if the gateway process is reachable
ress
```

### 502 Bad Gateway
- Confirm the Volume is mounted at `/data`
- Confirm `OPENCLAW_STATE_DIR` and `OPENCLAW_WORKSPACE_DIR` are set
- Check Railway logs: `railway logs`
- Visit `/healthz` to see if the gateway process is reachable
