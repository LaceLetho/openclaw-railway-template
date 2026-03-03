# OpenClaw Railway Template (1‑click deploy)

This repo packages **OpenClaw** for Railway with a small **/setup** web wizard so users can deploy and onboard **without running any commands**.

## What you get

- **OpenClaw Gateway + Control UI** (served at `/` and `/openclaw`)
- A friendly **Setup Wizard** at `/setup` (protected by a password)
- Persistent state via **Railway Volume** (so config/credentials/memory survive redeploys)
- One-click **Export backup** (so users can migrate off Railway later)
- **Import backup** from `/setup` (advanced recovery)

## How it works (high level)

- The container runs a wrapper web server.
- The wrapper protects `/setup` (and the Control UI at `/openclaw`) with `SETUP_PASSWORD` using HTTP Basic auth.
- During setup, the wrapper runs `openclaw onboard --non-interactive ...` inside the container, writes state to the volume, and then starts the gateway.
- After setup, **`/` is OpenClaw**. The wrapper reverse-proxies all traffic (including WebSockets) to the local gateway process.

## Railway deploy instructions (what you’ll publish as a Template)

In Railway Template Composer:

1) Create a new template from this GitHub repo.
2) Add a **Volume** mounted at `/data`.
3) Set the following variables:

Required:
- `SETUP_PASSWORD` — user-provided password to access `/setup` and the Control UI (`/openclaw`) via HTTP Basic auth

Recommended:
- `OPENCLAW_STATE_DIR=/data/.openclaw`
- `OPENCLAW_WORKSPACE_DIR=/data/workspace`
- `OPENCLAW_GIT_REF=v2026.2.26` — OpenClaw version to build (optional, defaults to a recent release)

## LLM Provider Configuration

This template uses **environment variables** to configure the LLM provider instead of the wizard. This is more secure and flexible.

### Supported Providers

Set one or more of the following environment variables in Railway:

| Provider | Environment Variable | Model (default) |
|----------|---------------------|-----------------|
| MiniMax M2.1 | `MINIMAX_API_KEY` | MiniMax-M2.1 |
| MiniMax M2.1 Lightning | `MINIMAX_API_KEY` | MiniMax-M2.1-Lightning |
| OpenAI | `OPENAI_API_KEY` | gpt-4o |
| Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 |
| Google Gemini | `GEMINI_API_KEY` | gemini-2.0-flash |
| OpenRouter | `OPENROUTER_API_KEY` | openai/gpt-4o |
| Moonshot AI (Kimi) | `MOONSHOT_API_KEY` | moonshot-v1-8k |
| Kimi Code | `KIMI_CODE_API_KEY` | kimi-coder |
| Z.AI (GLM 4.7) | `ZAI_API_KEY` | glm-4 |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` + `AI_GATEWAY_ACCOUNT_ID` + `AI_GATEWAY_GATEWAY_ID` | - |
| Custom Provider | See below | - |

### Example: MiniMax (Recommended)

1. Get an API key from https://platform.minimaxi.com
2. In Railway, add variable: `MINIMAX_API_KEY=<your key>`
3. Deploy and run `/setup` — the wizard now skips auth and uses the env var automatically

### Example: OpenAI

1. Get an API key from https://platform.openai.com
2. In Railway, add variable: `OPENAI_API_KEY=<your key>`
3. Deploy and run `/setup`

### Custom Provider

To use a custom LLM provider:

1. Set these Railway variables:
   - `CUSTOM_PROVIDER_ID=my-provider`
   - `CUSTOM_BASE_URL=https://api.example.com/v1`
   - `CUSTOM_API_KEY=<your key>`
   - `CUSTOM_MODEL_ID=gpt-4`
   - `CUSTOM_API=openai` (or `anthropic`)

2. Run `/setup` — the wizard will add your custom provider

### Switching Providers

To switch providers after initial setup:

1. Update the environment variable in Railway
2. Edit the model in `/data/.openclaw/agents/main/agent/models.json` or use:
   ```bash
   openclaw config set models.defaultProvider=<provider-id>
   ```
3. Restart the gateway from `/setup` Debug Console

### Other Optional Variables

Optional:
- `OPENCLAW_GATEWAY_TOKEN` — if not set, the wrapper generates one (not ideal). In a template, set it using a generated secret.

Notes:
- This template pins OpenClaw to a released version by default via Docker build arg `OPENCLAW_GIT_REF` (override if you want `main`).

4) **Important:** In Railway, go to **Settings → Networking** and click **Generate Domain** to apply for a public domain.
   - This step is required! Without a public domain, the `RAILWAY_PUBLIC_DOMAIN` environment variable will not be set, and the Control UI will show "origin not allowed" errors.
   - Railway will assign a domain like `your-app.up.railway.app`.
5) Enable **Public Networking** (HTTP).
   - This service listens on Railway’s injected `PORT` at runtime (recommended).
6) Deploy.

Then:
- Visit `https://<your-app>.up.railway.app/setup`
  - Your browser will prompt for **HTTP Basic auth**. Use any username; the password is `SETUP_PASSWORD`.
- Complete setup
- Visit `https://<your-app>.up.railway.app/` and `/openclaw` (same Basic auth)

### Authorizing the Control UI

After setup, you need to authorize the Control UI to connect to the gateway:

1. Open the Control UI at `https://<your-app>.up.railway.app/openclaw`
2. Your browser will show "pairing required" - this is expected
3. Go to `/setup` → Use the **Debug Console** to run:
   - `openclaw devices list` — shows pending device requests
   - `openclaw devices approve <requestId>` — approves the request

Alternatively, you can approve pairing requests via Telegram or Discord if you have configured those channels.

## Support / community

- GitHub Issues: https://github.com/vignesh07/clawdbot-railway-template/issues
- Discord: https://discord.com/invite/clawd

If you’re filing a bug, please include the output of:
- `/healthz`
- `/setup/api/debug` (after authenticating to /setup)

## Getting chat tokens (so you don’t have to scramble)

### Telegram bot token
1) Open Telegram and message **@BotFather**
2) Run `/newbot` and follow the prompts
3) BotFather will give you a token that looks like: `123456789:AA...`
4) Paste that token into `/setup`

### Discord bot token
1) Go to the Discord Developer Portal: https://discord.com/developers/applications
2) **New Application** → pick a name
3) Open the **Bot** tab → **Add Bot**
4) Copy the **Bot Token** and paste it into `/setup`
5) Invite the bot to your server (OAuth2 URL Generator → scopes: `bot`, `applications.commands`; then choose permissions)

## Persistence (Railway volume)

Railway containers have an ephemeral filesystem. Only the mounted volume at `/data` persists across restarts/redeploys.

What persists cleanly today:
- **Custom skills / code:** anything under `OPENCLAW_WORKSPACE_DIR` (default: `/data/workspace`)
- **Node global tools (npm/pnpm):** this template configures defaults so global installs land under `/data`:
  - npm globals: `/data/npm` (binaries in `/data/npm/bin`)
  - pnpm globals: `/data/pnpm` (binaries) + `/data/pnpm-store` (store)
- **Python packages:** create a venv under `/data` (example below). The runtime image includes Python + venv support.

What does *not* persist cleanly:
- `apt-get install ...` (installs into `/usr/*`)
- Homebrew installs (typically `/opt/homebrew` or similar)

### Optional bootstrap hook

If `/data/workspace/bootstrap.sh` exists, the wrapper will run it on startup (best-effort) before starting the gateway.
Use this to initialize persistent install prefixes or create a venv.

Example `bootstrap.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Example: create a persistent python venv
python3 -m venv /data/venv || true

# Example: ensure npm/pnpm dirs exist
mkdir -p /data/npm /data/npm-cache /data/pnpm /data/pnpm-store
```

## Troubleshooting

### “origin not allowed” error when accessing Control UI

This error occurs because the gateway's `controlUi.allowedOrigins` config doesn't include your Railway domain.

**Root cause:** OpenClaw does exact origin matching, not wildcard matching. Even though `https://*.up.railway.app` is in the allowed list, the exact domain must also be present.

**Fix:**
1. Make sure you have applied for a public domain in **Railway → Settings → Networking** (click “Generate Domain”)
2. The wrapper should automatically sync your domain on startup. If not, you can manually add it:

```bash
# SSH into your Railway service
railway ssh --project=<project-id> --service=<service-id>

# Add your domain to allowedOrigins
openclaw config set --json gateway.controlUi.allowedOrigins '[“http://localhost:*”, “http://127.0.0.1:*”, “https://*.up.railway.app”, “https://*.railway.app”, “https://your-app.up.railway.app”]'

# Restart the gateway
pkill -f openclaw-gateway
```

Then access the Control UI again to trigger gateway restart.

### “disconnected (1008): pairing required” / dashboard health offline

This is not a crash — it means the gateway is running, but no device has been approved yet.

Fix:
- Open `/setup`
- Use the **Debug Console**:
  - `openclaw devices list`
  - `openclaw devices approve <requestId>`

If `openclaw devices list` shows no pending request IDs:
- Make sure you’re visiting the Control UI at `/openclaw` (or your native app) and letting it attempt to connect
  - Note: the Railway wrapper now proxies the gateway and injects the auth token automatically, so you should not need to paste the gateway token into the Control UI when using `/openclaw`.
- Ensure your state dir is the Railway volume (recommended): `OPENCLAW_STATE_DIR=/data/.openclaw`
- Check `/setup/api/debug` for the active state/workspace dirs + gateway readiness

### “unauthorized: gateway token mismatch”

The Control UI connects using `gateway.remote.token` and the gateway validates `gateway.auth.token`.

Fix:
- Re-run `/setup` so the wrapper writes both tokens.
- Or set both values to the same token in config.

### “Application failed to respond” / 502 Bad Gateway

Most often this means the wrapper is up, but the gateway can’t start or can’t bind.

Checklist:
- Ensure you mounted a **Volume** at `/data` and set:
  - `OPENCLAW_STATE_DIR=/data/.openclaw`
  - `OPENCLAW_WORKSPACE_DIR=/data/workspace`
- Ensure **Public Networking** is enabled (Railway will inject `PORT`).
- Check Railway logs for the wrapper error: it will show `Gateway not ready:` with the reason.

### Legacy CLAWDBOT_* env vars / multiple state directories

If you see warnings about deprecated `CLAWDBOT_*` variables or state dir split-brain (e.g. `~/.openclaw` vs `/data/...`):
- Use `OPENCLAW_*` variables only
- Ensure `OPENCLAW_STATE_DIR=/data/.openclaw` and `OPENCLAW_WORKSPACE_DIR=/data/workspace`
- Redeploy after fixing Railway Variables

### Build OOM (out of memory) on Railway

Building OpenClaw from source can exceed small memory tiers.

Recommendations:
- Use a plan with **2GB+ memory**.
- If you see `Reached heap limit Allocation failed - JavaScript heap out of memory`, upgrade memory and redeploy.

## Local smoke test

```bash
docker build -t clawdbot-railway-template .

docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  clawdbot-railway-template

# open http://localhost:8080/setup (password: test)
```

---

## Official template / endorsements

- Officially recommended by OpenClaw: <https://docs.openclaw.ai/railway>
- Railway announcement (official): [Railway tweet announcing 1‑click OpenClaw deploy](https://x.com/railway/status/2015534958925013438)

  ![Railway official tweet screenshot](assets/railway-official-tweet.jpg)

- Endorsement from Railway CEO: [Jake Cooper tweet endorsing the OpenClaw Railway template](https://x.com/justjake/status/2015536083514405182)

  ![Jake Cooper endorsement tweet screenshot](assets/railway-ceo-endorsement.jpg)

- Created and maintained by **Vignesh N (@vignesh07)**
- **1800+ deploys on Railway and counting** [Link to template on Railway](https://railway.com/deploy/clawdbot-railway-template)

![Railway template deploy count](assets/railway-deploys.jpg)
