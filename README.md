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

### 1. SSH and Install Homebrew

```bash
# login into the server
railway ssh --project=<project-id> --service=<service-id> --environment=<environment-id>

# Install Homebrew (helpful for installing skills) 
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

# Enable full tools (enable all tools for openclaw)
openclaw config set --json tools.profile ‘"full"’
```

### 2. Restart the Service

After onboarding, redeploy or restart the Railway service. The wrapper will detect the config and start the gateway automatically.

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
