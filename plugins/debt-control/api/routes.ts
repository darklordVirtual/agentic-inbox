import { Hono } from "hono";
import type { MailboxContext } from "../../../workers/lib/mailbox";
import { settingsHandlers } from "./handlers/settings";
import { bankHandlers } from "./handlers/bank";
import { casesHandlers } from "./handlers/cases";
import { reconcileHandlers } from "./handlers/reconcile";
import { draftHandlers } from "./handlers/draft";

/**
 * Mounts all Debt Control API routes.
 * The Hono app passed here is already scoped to /api/plugins/debt-control/.
 * The active mailbox DO stub is available via c.var.mailboxStub,
 * and raw SQL via c.var.mailboxStub.ctx.storage.sql (accessed in handlers).
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

	// Reconcile
	app.post("/cases/:id/reconcile",  reconcileHandlers.reconcileCase);

	// Drafts
	app.post("/cases/:id/draft-objection",     draftHandlers.draftObjection);
	app.post("/cases/:id/request-more-info",   draftHandlers.requestMoreInfo);
}
