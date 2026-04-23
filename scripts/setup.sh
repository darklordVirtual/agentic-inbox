#!/usr/bin/env bash
# Agentic Inbox — CI/CD setup script
#
# This script wires GitHub Actions to your Cloudflare account so every push
# to main auto-deploys the worker. It does NOT do the initial deploy — use
# the "Deploy to Cloudflare" button in the README for that (faster, provisions
# R2 + Durable Objects + Workers AI in one click).
#
# Usage:
#   ./scripts/setup.sh            # set up GitHub Actions CI/CD
#   ./scripts/setup.sh --access   # set POLICY_AUD + TEAM_DOMAIN after enabling Access

set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}✓${N}  $*"; }
info() { echo -e "${C}·${N}  $*"; }
ask()  { echo -en "${Y}?${N}  $* "; }
warn() { echo -e "${Y}!${N}  $*"; }
die()  { echo -e "${R}✗  ERROR:${N} $*" >&2; exit 1; }
hdr()  { echo -e "\n${C}══ $* ${N}"; }
try_open() {
  local url="$1"
  (command -v open    &>/dev/null && open    "$url" 2>/dev/null) ||
  (command -v xdg-open &>/dev/null && xdg-open "$url" 2>/dev/null) ||
  (command -v wslview &>/dev/null && wslview  "$url" 2>/dev/null) ||
  echo "  Open in browser: $url"
}

# ── auto-detect GitHub repo from git remote ───────────────────────────────────
detect_repo() {
  local remote
  remote=$(git remote get-url origin 2>/dev/null || echo "")
  # Handles https://github.com/owner/repo.git and git@github.com:owner/repo.git
  echo "$remote" | sed -E 's|.*github\.com[:/]([^/]+/[^/]+?)(\.git)?$|\1|'
}

REPO=$(detect_repo)
if [[ -z "$REPO" || "$REPO" == *"github.com"* ]]; then
  ask "GitHub repo (owner/name, e.g. darklordVirtual/agentic-inbox):"; read -r REPO
fi
ok "Target repo: $REPO"

# ── prerequisite checks ───────────────────────────────────────────────────────
hdr "Checking prerequisites"
MISSING=""
command -v gh       &>/dev/null || MISSING="$MISSING\n  • gh   — https://cli.github.com"
command -v wrangler &>/dev/null || MISSING="$MISSING\n  • wrangler — npm install -g wrangler"
if [[ -n "$MISSING" ]]; then
  die "Missing required tools. Install them first:\n$MISSING"
fi
ok "gh and wrangler found"

# ── --access: set POLICY_AUD + TEAM_DOMAIN only ───────────────────────────────
if [[ "${1:-}" == "--access" ]]; then
  hdr "Setting Cloudflare Access secrets"
  echo ""
  echo "  In the Cloudflare dashboard:"
  echo "  Zero Trust → Access → Applications — note your team domain"
  echo "  Workers & Pages → agentic-inbox → Settings → Domains & Routes → Enable Access"
  echo "  The modal shows the Audience Tag (POLICY_AUD) — copy it below."
  echo ""
  try_open "https://dash.cloudflare.com"
  ask "POLICY_AUD (Audience Tag from Access modal):";  read -rs POLICY_AUD;  echo
  [[ -z "$POLICY_AUD" ]] && die "POLICY_AUD cannot be empty"
  ask "TEAM_DOMAIN (e.g. your-team.cloudflareaccess.com):"; read -rs TEAM_DOMAIN; echo
  [[ -z "$TEAM_DOMAIN" ]] && die "TEAM_DOMAIN cannot be empty"
  echo ""

  # Store in GitHub secrets — the deploy workflow re-applies them on every deploy
  # so Access protection survives all future code pushes without any manual steps.
  gh secret set POLICY_AUD  --repo "$REPO" --body "$POLICY_AUD"  && ok "POLICY_AUD saved to GitHub secrets"
  gh secret set TEAM_DOMAIN --repo "$REPO" --body "$TEAM_DOMAIN" && ok "TEAM_DOMAIN saved to GitHub secrets"

  # Trigger a deploy so the secrets are applied to the live Worker right now.
  if gh workflow run deploy.yml --repo "$REPO" 2>/dev/null; then
    ok "Deploy triggered — secrets will be live in ~1 min"
    info "Watch: https://github.com/$REPO/actions"
  else
    warn "Could not trigger workflow automatically."
    info "Push any commit (or run the workflow manually) to apply the secrets."
    info "https://github.com/$REPO/actions → Deploy to Cloudflare Workers → Run workflow"
  fi
  echo ""
  ok "Access secrets stored. From now on every deploy automatically re-applies them."
  exit 0
fi


# ── main setup: wire GitHub Actions CI/CD ─────────────────────────────────────
echo ""
echo "  This script sets up GitHub Actions so every push to main auto-deploys."
echo "  Nothing sensitive is stored in the repo — only in GitHub Secrets."
echo ""

# 1. GitHub auth
hdr "GitHub authentication"
if ! gh auth status &>/dev/null; then
  info "Logging in to GitHub..."
  gh auth login || die "GitHub login failed"
fi
ok "GitHub authenticated"

# Verify repo access
if ! gh repo view "$REPO" &>/dev/null; then
  die "Cannot access https://github.com/$REPO\n  Check the repo name and that you have access"
fi

# 2. Cloudflare auth
hdr "Cloudflare authentication"
if ! wrangler whoami &>/dev/null 2>&1; then
  info "Logging in to Cloudflare..."
  wrangler login || die "Cloudflare login failed"
fi
ok "Cloudflare authenticated"

# 3. Account ID — auto-detect, fall back to prompt
hdr "Cloudflare account ID"
ACCOUNT_ID=$(wrangler whoami 2>&1 | grep -Eo '[0-9a-f]{32}' | head -1 || echo "")
if [[ -n "$ACCOUNT_ID" ]]; then
  ok "Auto-detected account ID: $ACCOUNT_ID"
else
  try_open "https://dash.cloudflare.com"
  echo "  Open https://dash.cloudflare.com — your Account ID is in the right sidebar."
  ask "Cloudflare Account ID:"; read -r ACCOUNT_ID
  [[ -z "$ACCOUNT_ID" ]] && die "Account ID cannot be empty"
fi

# 4. Domain
hdr "Domain"
ask "Your domain (e.g. example.com) — the part after @ in email addresses:"; read -r DOMAINS
[[ -z "$DOMAINS" ]] && die "Domain cannot be empty"
ok "Domain: $DOMAINS"

# 5. Cloudflare API token
hdr "Cloudflare API token"
echo "  Create a token at: https://dash.cloudflare.com/profile/api-tokens"
echo "  Required permissions (use a Custom Token):"
echo "    • Account / Workers Scripts: Edit"
echo "    • Account / Workers KV Storage: Edit  (if you use KV)"
echo "    • Account / D1: Edit  (if you use D1)"
echo "    • Zone / Workers Routes: Edit  (only if you use a custom domain)"
echo "  The 'Edit Cloudflare Workers' template covers the first three."
echo ""
try_open "https://dash.cloudflare.com/profile/api-tokens"
ask "Paste your Cloudflare API token:"; read -rs CLOUDFLARE_API_TOKEN; echo
[[ -z "$CLOUDFLARE_API_TOKEN" ]] && die "API token cannot be empty"

# Validate token against Cloudflare API before saving anywhere
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/user/tokens/verify" || echo "000")
if [[ "$STATUS" != "200" ]]; then
  die "API token verification failed (HTTP $STATUS). Check the token and try again."
fi
ok "API token verified"

# 6. Set GitHub secrets + variable
hdr "Saving secrets to GitHub"
gh secret set CLOUDFLARE_API_TOKEN  --repo "$REPO" --body "$CLOUDFLARE_API_TOKEN" && ok "CLOUDFLARE_API_TOKEN set"
gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$REPO" --body "$ACCOUNT_ID"           && ok "CLOUDFLARE_ACCOUNT_ID set"
gh variable set DOMAINS             --repo "$REPO" --body "$DOMAINS"               && ok "DOMAINS variable set"
warn "POLICY_AUD and TEAM_DOMAIN will be set after you enable Cloudflare Access (step 2 below)"

# 7. Trigger deploy
hdr "First deploy"
if gh workflow run deploy.yml --repo "$REPO" 2>/dev/null; then
  ok "Deploy triggered"
else
  warn "Workflow not yet runnable from API — push any commit to trigger the first deploy"
  info "Or: https://github.com/$REPO/actions → Deploy to Cloudflare Workers → Run workflow"
fi

# ── next steps ────────────────────────────────────────────────────────────────
echo ""
echo "  ╔═══════════════════════════════════════════════════════════════╗"
echo "  ║  CI/CD is live → https://github.com/$REPO/actions  "
echo "  ║                                                               ║"
echo "  ║  Two remaining steps in the Cloudflare dashboard:            ║"
echo "  ║                                                               ║"
echo "  ║  1. Email Routing: your domain → Email Routing               ║"
echo "  ║     Add catch-all rule → Send to Worker → agentic-inbox      ║"
echo "  ║                                                               ║"
echo "  ║  2. Access (optional but recommended):                       ║"
echo "  ║     Workers & Pages → agentic-inbox → Settings               ║"
echo "  ║     → Domains & Routes → Enable Access                       ║"
echo "  ║     Then run: ./scripts/setup.sh --access                    ║"
echo "  ║     This saves the secrets so every future deploy keeps      ║"
echo "  ║     Access protection — no manual re-apply needed.           ║"
echo "  ╚═══════════════════════════════════════════════════════════════╝"
echo ""
