/**
 * SpareBank 1 authentication helpers.
 *
 * SpareBank 1 uses an OAuth2 bearer token flow. The access token is
 * provisioned externally (via the SB1 developer portal) and stored as
 * a Cloudflare Worker secret. This file handles building auth headers
 * without ever exposing the token to the frontend.
 */

import type { SpareBank1Secrets } from "./config";

export function buildAuthHeaders(secrets: SpareBank1Secrets): Record<string, string> {
	return {
		Authorization: `Bearer ${secrets.accessToken}`,
		"X-Client-Id": secrets.clientId,
		Accept: "application/json",
		"Content-Type": "application/json",
	};
}
