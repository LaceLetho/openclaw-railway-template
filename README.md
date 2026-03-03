# OpenClaw Railway Template (1‑click deploy)

This repo packages **OpenClaw** for Railway with a reverse proxy

## What you get

- **OpenClaw Gateway + Control UI** (served at `/` and `/openclaw`)
- Persistent state via **Railway Volume** (so config/credentials/memory survive redeploys)
- One-click **Export backup** (so users can migrate off Railway later)
- **Import backup** from `/setup` (advanced recovery)

## How it works (high level)

- The container runs a wrapper web server.
- The wrapper protects `/setup` (and the Control UI at `/openclaw`) with `SETUP_PASSWORD` using HTTP Basic auth.
- The wrapper is a **pure reverse proxy** - it does NOT run or configure OpenClaw. All OpenClaw initialization is done manually via SSH.
- After setup, **`/` is OpenClaw**. The wrapper reverse-proxies all traffic (including WebSockets) to the local gateway process.

## Quick Deploy Guide

This is a verified step-by-step workflow to deploy OpenClaw on Railway.

### 1. Create Railway Project

1. Go to Railway and create a new **Empty Project**
2. Add an **Empty Service** (not from a template)

### 2. Set Environment Variables

In Railway **Variables** tab:

| Variable | Value | Description |
|----------|-------|-------------|
| `MINIMAX_API_KEY` | Your MiniMax API Key | LLM provider |
| `BRAVE_API_KEY` | Your Brave Search API Key | Required for web search |
| `OPENCLAW_GIT_REF` | `v2026.3.2` | OpenClaw version |
| `OPENCLAW_STATE_DIR` | `/data/.openclaw` | State directory |
| `OPENCLAW_WORKSPACE_DIR` | `/data/workspace` | Workspace directory |
| `SETUP_PASSWORD` | Random password | HTTP Basic auth password |
| `OPENCLAW_GATEWAY_TOKEN` | Random token | Gateway auth token |

### 3. Configure Storage & Networking

1. Add a **Volume** to your service, mount at `/data`
2. Go to **Settings → Networking**, click **Generate Domain**
3. Enable **Public Networking** (HTTP)

### 4. Deploy

Connect to this GitHub repo and Railway will deploy automatically.

### 5. SSH and Install Homebrew

```bash
railway ssh --project=<project-id> --service=<service-id>

# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 6. Initialize OpenClaw

```bash
openclaw onboard --workspace /data/workspace --gateway-bind loopback --gateway-port 18789 --no-install-daemon
```

### 7. Configure OpenClaw

```bash
# Allow your Railway domain
openclaw config set --json gateway.controlUi.allowedOrigins ‘["https://<your-domain>.railway.app"]’

# Enable full tools
openclaw config set --json tools.profile ‘"full"’
```

### 8. Start Gateway

```bash
openclaw gateway start
# Or run in background:
nohup openclaw gateway start > /tmp/openclaw-gateway.log 2>&1 &
```

### 9. Approve Device Pairing

After visiting Control UI, approve the device:

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

# Restart gateway
openclaw gateway restart

# View logs
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log
railway logs

# Add channels
openclaw channels add --channel telegram --token <token>
openclaw channels add --channel discord --token <token>
```

---

## Troubleshooting

### "origin not allowed"
```bash
openclaw config set --json gateway.controlUi.allowedOrigins ‘["https://your-app.up.railway.app"]’
pkill -f openclaw-gateway
```

### "pairing required"
```bash
openclaw devices list
openclaw devices approve <requestId>
```

### 502 Bad Gateway
- Check Volume is mounted at `/data`
- Check `OPENCLAW_STATE_DIR` and `OPENCLAW_WORKSPACE_DIR` are set
- Check Railway logs for errors

