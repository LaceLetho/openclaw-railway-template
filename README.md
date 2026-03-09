# OpenClaw Railway Template

This repo packages **OpenClaw** for Railway with a minimal reverse proxy wrapper.

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

## Deploy Guide

### 1. Create Railway Project

1. Go to Railway and create a new **Empty Project**
2. Add an **Empty Service** (not from a template)

### 2. Set Environment Variables

In the Railway **Variables** tab:

| Variable | Value | Description |
|----------|-------|-------------|
| `PASSWORD` | A strong password | HTTP Basic Auth — protects the entire service |
| `OPENCLAW_GATEWAY_TOKEN` | A random token | Gateway auth token (keep secret, stays stable) |
| `OPENCLAW_STATE_DIR` | `/data/.openclaw` | State directory (set by default in railway.toml) |
| `OPENCLAW_WORKSPACE_DIR` | `/data/workspace` | Workspace directory (set by default in railway.toml) |
| `MINIMAX_API_KEY` | Your MiniMax API Key | LLM provider |
| `BRAVE_API_KEY` | Your Brave Search API Key | Web search |
| `OPENCLAW_GIT_REF` | `v2026.3.2` | OpenClaw version to build |

### 3. Configure Storage & Networking

1. Add a **Volume** to your service, mount at `/data`
2. Go to **Settings → Networking**, click **Generate Domain**
3. Enable **Public Networking** (HTTP)

### 4. Deploy

Connect this GitHub repo — Railway will build and deploy automatically.

The service will start but return 503 until OpenClaw is initialized (next step).

### 5. SSH and Install Homebrew

```bash
railway ssh --project=<project-id> --service=<service-id>

# Install Homebrew
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

# Enable full tools
openclaw config set --json tools.profile ‘"full"’
```

### 6. Restart the Service

After onboarding, redeploy or restart the Railway service. The wrapper will detect the config and start the gateway automatically.

### 7. Approve Device Pairing

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

# Restart gateway (takes effect after Railway redeploy)
openclaw gateway restart
```

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

### 502 Bad Gateway
- Confirm the Volume is mounted at `/data`
- Confirm `OPENCLAW_STATE_DIR` and `OPENCLAW_WORKSPACE_DIR` are set
- Check Railway logs: `railway logs`
- Visit `/healthz` to see if the gateway process is reachable
