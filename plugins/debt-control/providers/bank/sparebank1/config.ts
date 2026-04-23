/**
 * SpareBank 1 provider configuration.
 *
 * Secrets (clientId, accessToken) must be stored as Cloudflare Worker
 * secrets — never in source code or local SQLite.
 *
 * Non-sensitive settings (accountId, lastSyncAt) are stored in SQLite.
 */

export const SB1_BASE_URL = "https://api.sparebank1.no/personal/banking/transactions";

export interface SpareBank1Secrets {
	/** OAuth2 client_id. Set via: wrangler secret put SB1_CLIENT_ID */
	clientId: string;
	/** Bearer access token. Set via: wrangler secret put SB1_ACCESS_TOKEN */
	accessToken: string;
}

export interface SpareBank1Settings {
	accountId: string | null;
	lastSyncAt: string | null;
}

/** Validate that secrets are present (do not log or expose them). */
export function validateSecrets(secrets: Partial<SpareBank1Secrets>): boolean {
	return Boolean(secrets.clientId && secrets.accessToken);
}
