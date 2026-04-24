/**
 * Gjeldskontroll — norsk gjeldshåndtering for privatkunder.
 *
 * Klassifiserer innkommende inkassokrav og fakturaer, sjekker automatisk om
 * krav er betalt via SpareBank 1 Open API (sparebank1.no/open-api), og
 * prioriterer utestående betalinger etter tilgjengelig banksaldo.
 *
 * Overholder inkassoloven, finansavtaleloven og forsinkelsesrenteloven.
 *
 * Se plugins/debt-control/README.md for fullstendig dokumentasjon.
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
