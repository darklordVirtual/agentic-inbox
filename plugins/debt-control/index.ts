/**
 * Debt Control plugin entry point.
 *
 * This is the only file the plugin system needs to import.
 */

import type { InboxPlugin } from "../../workers/plugins/types";
import { debtControlManifest } from "./manifest";
import { debtControlMigrations } from "./storage/migrations";
import { registerDebtControlRoutes } from "./api/routes";
import { onEmailReceived } from "./hooks/on-email-received";
import { onSyncRequest } from "./hooks/on-sync-request";

export const debtControlPlugin: InboxPlugin = {
	manifest:   debtControlManifest,
	migrations: debtControlMigrations,

	registerRoutes: registerDebtControlRoutes,

	onEmailReceived,
	onSyncRequest,
};

export default debtControlPlugin;
