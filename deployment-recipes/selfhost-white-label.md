# Self-host & White-label Guide

> For the fastest path, use the **Deploy to Cloudflare** button in the README.
> This guide covers what the button and setup script do under the hood,
> and how to white-label the worker name/domain.

## What "self-hosted" means here

- All email and bank data lives in **your** Cloudflare Durable Object — not on any central server
- You control all secrets — nothing is ever sent to a third party
- You can use your own domain, your own Worker name, and your own Cloudflare account

---

## Fastest path: Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/darklordVirtual/agentic-inbox)

Provisions R2, Durable Objects, and Workers AI in one click. Enter your domain when prompted.

After deploy: follow the two remaining Cloudflare dashboard steps in the main README.

---

## CI/CD path: GitHub Actions

```bash
npm install
./scripts/setup.sh          # auth, secrets, first deploy
./scripts/setup.sh --access # after enabling Access in Cloudflare
```

See the main [README → Deploy](../README.md#deploy) for details.

---

## White-labeling (custom Worker name)

If you want a different Worker name than `agentic-inbox`, edit `wrangler.jsonc`:

```jsonc
{
  "name": "my-company-inbox"   // change this
}
```

Also update the R2 bucket name to match:

```jsonc
"r2_buckets": [{
  "binding": "BUCKET",
  "bucket_name": "my-company-inbox"
}]
```

Create the renamed bucket before deploying:

```bash
wrangler r2 bucket create my-company-inbox
```

---

## White-label UI branding

1. Update `app/root.tsx` — change the page title
2. Replace `public/favicon.ico`
3. Add CSS variables in `app/index.css`
4. Plugin labels can be changed in `plugins/debt-control/manifest.ts`

---

## Adding more plugins

1. Create `plugins/my-plugin/index.ts` implementing `InboxPlugin`
2. Register it in `workers/plugins/register.ts`:
   ```typescript
   import { myPlugin } from "../../plugins/my-plugin";
   pluginRegistry.register(myPlugin);
   ```
3. Add UI routes in `app/routes.ts`

See the [Plugins section in the README](../README.md#adding-a-new-plugin) for the full interface reference.

---

## Required Cloudflare resources (auto-provisioned by the Deploy button)

| Resource | Purpose |
|----------|---------|
| Workers + Durable Objects | Runs the app and stores per-mailbox data |
| R2 bucket `agentic-inbox` | Email attachment storage |
| Workers AI | Powers the email agent |
| Email Routing | Receives inbound email and routes to the Worker |
| Cloudflare Access | Protects the app from public access |
