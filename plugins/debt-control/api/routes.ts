import { Hono } from "hono";
import type { MailboxContext } from "../../../workers/lib/mailbox";
import { settingsHandlers } from "./handlers/settings";
import { bankHandlers } from "./handlers/bank";
import { casesHandlers } from "./handlers/cases";
import { reconcileHandlers } from "./handlers/reconcile";
import { draftHandlers } from "./handlers/draft";
import { timelineHandlers } from "./handlers/timeline";
import { actionsHandlers } from "./handlers/actions";
import { lettersHandlers } from "./handlers/letters";
import { collectorHandlers } from "./handlers/collectors";
import { intelligenceHandlers } from "./handlers/intelligence";

/**
 * Mounts all Debt Control API routes.
 */
export function registerDebtControlRoutes(app: Hono<MailboxContext>): void {
	// Settings
	app.get("/settings",              settingsHandlers.get);
	app.patch("/settings",            settingsHandlers.update);

	// Bank settings
	app.get("/settings/bank",         bankHandlers.getStatus);
	app.post("/settings/bank/test",   bankHandlers.testConnection);
	app.post("/bank/sync",            bankHandlers.sync);

	// Cases
	app.get("/cases",                 casesHandlers.list);
	app.get("/cases/:id",             casesHandlers.get);

	// Timeline (immutable event log)
	app.get("/cases/:id/timeline",    timelineHandlers.get);

	// Findings and recommended action
	app.get("/cases/:id/findings",              actionsHandlers.getFindings);
	app.get("/cases/:id/recommended-action",    actionsHandlers.getRecommendedAction);
	app.get("/cases/:id/evidence-pack",         actionsHandlers.getEvidencePack);

	// Phase 2 Intelligence
	app.get("/cases/:id/prediction",            intelligenceHandlers.prediction);
	app.get("/cases/:id/tactical-response",     intelligenceHandlers.tacticalResponse);
	app.get("/cases/:id/timeline-insights",     intelligenceHandlers.timelineInsights);

	// Case status mutations
	app.post("/cases/:id/mark-objection",                       actionsHandlers.markObjection);
	app.post("/cases/:id/mark-processing-limitation-requested", actionsHandlers.markProcessingLimitationRequested);
	app.post("/cases/:id/mark-paid",                            actionsHandlers.markPaid);
	app.post("/cases/:id/mark-closed",                          actionsHandlers.markClosed);
	app.post("/cases/:id/set-status",                           actionsHandlers.setStatus);

	// Letter generation
	app.post("/cases/:id/generate-letter",  lettersHandlers.generate);

	// Collector profiles (Phase 2)
	app.get("/collectors",              collectorHandlers.list);
	app.get("/collectors/:name/fingerprint", collectorHandlers.fingerprint);

	// Reconcile
	app.post("/cases/:id/reconcile",  reconcileHandlers.reconcileCase);

	// Drafts (legacy)
	app.post("/cases/:id/draft-objection",     draftHandlers.draftObjection);
	app.post("/cases/:id/request-more-info",   draftHandlers.requestMoreInfo);
}
