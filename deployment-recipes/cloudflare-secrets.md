# Cloudflare Secrets Guide

All sensitive credentials are stored as **Cloudflare Worker secrets** (set via the setup script or `wrangler secret put`). They are never:
- committed to source code
- stored in `wrangler.jsonc`
- stored in SQLite / R2
- returned by any API endpoint
- logged

---

## Setting secrets: two ways

**Via setup script (recommended):**
```bash
./scripts/setup.sh          # sets CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID in GitHub
./scripts/setup.sh --access # sets POLICY_AUD, TEAM_DOMAIN in GitHub + Cloudflare Worker
```

**Via wrangler CLI (manual):**
```bash
wrangler secret put SECRET_NAME   # prompts for the value, never shows it in terminal history
```

---

## Core secrets

### Cloudflare Access (production only)

Set automatically by `./scripts/setup.sh --access`. To set manually:

```bash
wrangler secret put POLICY_AUD
# Paste the Audience tag from: Access → Application → Overview

wrangler secret put TEAM_DOMAIN
# Paste your Access team domain, e.g. https://yourteam.cloudflareaccess.com
```

---

## Debt Control — SpareBank 1

### Obtain credentials

1. Register at [https://developer.sparebank1.no](https://developer.sparebank1.no)
2. Create an application and request access to the **Transactions API** (personal banking)
3. Copy your **Client ID** and generate an **Access Token**

### Store secrets

```bash
wrangler secret put SB1_CLIENT_ID
# Paste your SpareBank 1 client_id

wrangler secret put SB1_ACCESS_TOKEN
# Paste your access token
```

### Verify

After deploying, navigate to `/mailbox/<your-email>/debt/bank` and click
**Test tilkobling**. The response should show `status: ok`.

---

## Rotating secrets

```bash
wrangler secret put SB1_ACCESS_TOKEN   # just run again with new value
```

Cloudflare deploys the new secret without redeploying the worker.

---

## Local development

For local dev (`wrangler dev`), create a `.dev.vars` file (gitignored):

```ini
SB1_CLIENT_ID=your-client-id
SB1_ACCESS_TOKEN=your-access-token
POLICY_AUD=
TEAM_DOMAIN=
```

Cloudflare Access validation is automatically skipped in `import.meta.env.DEV` mode.
