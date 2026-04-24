import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { casesRepo } from "../../storage/repos/cases.repo";
import { findingsRepo } from "../../storage/repos/findings.repo";
import { eventsRepo } from "../../storage/repos/events.repo";
import { documentsRepo } from "../../storage/repos/documents.repo";
import { runLegalityChecks } from "../../domain/legality-engine";
import { getRecommendedAction } from "../../domain/recommended-action-engine";
import { buildEvidencePack } from "../../domain/evidence-pack";
import type { CaseStatus } from "../../types";

type C = Context<MailboxContext>;

export const actionsHandlers = {
	/** GET /cases/:id/findings — refresh + return findings */
	async getFindings(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const docs     = documentsRepo.findByCaseId(sql, id);
		const events   = eventsRepo.findByCaseId(sql, id);
		const fresh    = runLegalityChecks(debtCase, docs, events);
		for (const f of fresh) findingsRepo.upsert(sql, f);

		const findings = findingsRepo.findByCaseId(sql, id);
		return c.json({ findings });
	},

	/** GET /cases/:id/recommended-action */
	async getRecommendedAction(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const findings = findingsRepo.findByCaseId(sql, id);
		const action   = getRecommendedAction(debtCase, findings);
		return c.json({ action });
	},

	/** GET /cases/:id/evidence-pack */
	async getEvidencePack(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const events   = eventsRepo.findByCaseId(sql, id);
		const findings = findingsRepo.findByCaseId(sql, id);
		const name     = c.req.query("name") ?? undefined;
		const pack     = buildEvidencePack(debtCase, events, findings, name);
		return c.json(pack);
	},

	/** POST /cases/:id/mark-objection */
	async markObjection(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		casesRepo.update(sql, id, {
			objectionDate: new Date().toISOString(),
			status:        "objection_registered",
		});
		return c.json({ ok: true });
	},

	/** POST /cases/:id/mark-processing-limitation-requested */
	async markProcessingLimitationRequested(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		casesRepo.update(sql, id, {
			processingLimitationRequestedAt: new Date().toISOString(),
			status: "processing_limitation_requested",
		});
		return c.json({ ok: true });
	},

	/** POST /cases/:id/mark-paid */
	async markPaid(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		casesRepo.update(sql, id, { status: "paid" });
		return c.json({ ok: true });
	},

	/** POST /cases/:id/mark-closed */
	async markClosed(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		casesRepo.update(sql, id, {
			status:   "closed",
			closedAt: new Date().toISOString(),
		});
		return c.json({ ok: true });
	},

	/** POST /cases/:id/set-status */
	async setStatus(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const body = await c.req.json<{ status: CaseStatus }>();
		if (!body?.status) return c.json({ error: "Missing status" }, 400);

		casesRepo.update(sql, id, { status: body.status });
		return c.json({ ok: true });
	},
};
