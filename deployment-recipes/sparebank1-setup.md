# SpareBank 1 Integration Setup

The SpareBank 1 provider uses the
[SpareBank 1 Transactions API](https://developer.sparebank1.no) to fetch
personal banking transactions.

---

## API endpoints used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/personal/banking/transactions/` | List transactions |
| GET | `/personal/banking/transactions/classified` | List with categories |
| GET | `/personal/banking/transactions/{id}/details` | Single transaction |
| GET | `/personal/banking/transactions/{id}/details/classified` | Single + category |
| GET | `/personal/banking/transactions/export` | CSV export |

All calls use a Bearer token and X-Client-Id header. No OAuth2 redirect flow
is required — credentials are provisioned once and stored as Worker secrets.

---

## Step-by-step setup

### 1. Register as a developer

Create an account at [https://developer.sparebank1.no](https://developer.sparebank1.no).

### 2. Create an application

- Application type: **server-to-server**
- Requested scope: `personal.transaction.read` (or equivalent)

### 3. Get credentials

After approval you will receive:
- **Client ID** — identifies your application
- **Access Token** — grants API access (may have an expiry; renew as needed)

### 4. Find your Account ID (optional)

If you have multiple accounts, you can specify which one to sync.
Leave `accountId` as `null` to sync all accounts.

Write the account ID into plugin settings:
```
PATCH /api/v1/mailboxes/<mailbox>/api/plugins/debt-control/settings
{ "bankProvider": "sparebank1" }
```

Then set secrets (see `cloudflare-secrets.md`).

---

## Testing

```bash
curl -X POST https://<your-worker>/api/v1/mailboxes/<email>/api/plugins/debt-control/settings/bank/test
```

Expected response:
```json
{ "status": "ok", "lastSync": "...", "message": "Connection successful. Sample size: 1." }
```

---

## Security notes

- The access token is **never** returned by any API response
- Frontend only sees `status: configured | ok | failed | not_configured`
- All transaction data is stored in the per-mailbox SQLite DO — not externally
- No transaction data is logged or sent anywhere other than your DO

---

## CSV fallback

If you cannot use the API (e.g. sandbox limitations or personal preference),
use the CSV provider instead:

1. Export transactions from SpareBank 1 online banking as CSV
2. Set bank provider to `csv` in plugin settings
3. Use the bank sync endpoint with CSV upload (future enhancement)

CSV format (semicolon-separated, with optional headers):
```
dato;beløp;valuta;beskrivelse;motpart;kid
01.01.2025;-15000;NOK;Fakturabetaling inkasso;Lindorff AS;12345678
```
