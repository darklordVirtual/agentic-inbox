import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { casesRepo } from "../../storage/repos/cases.repo";
import { eventsRepo } from "../../storage/repos/events.repo";
import { findingsRepo } from "../../storage/repos/findings.repo";
import { predictNextCollectionStep } from "../../domain/next-step-predictor";
import { getTacticalResponse } from "../../domain/tactical-response-engine";
import { buildDebtTimelineInsights } from "../../domain/timeline-insights";
import { buildCollectionFingerprint } from "../../domain/collection-fingerprint-engine";
import { casesRepo as cr } from "../../storage/repos/cases.repo";

type C = Context<MailboxContext>;

export const intelligenceHandlers = {
	/** GET /cases/:id/prediction */
	async prediction(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const events = eventsRepo.findByCaseId(sql, id);
		const mailboxId = debtCase.mailboxId;

		// Optional fingerprint from same collector
		const peerCases = cr.listByMailbox(sql, mailboxId).filter(
			(ca) => ca.creditor === debtCase.creditor && ca.id !== id,
		);
		const eventsByCaseId = new Map(
			peerCases.map((ca) => [ca.id, eventsRepo.findByCaseId(sql, ca.id)]),
		);
		const fingerprint = peerCases.length >= 2
			? buildCollectionFingerprint(debtCase.creditor, peerCases, eventsByCaseId)
			: undefined;

		const prediction = predictNextCollectionStep(debtCase, events, fingerprint);
		return c.json({ prediction });
	},

	/** GET /cases/:id/tactical-response */
	async tacticalResponse(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const events     = eventsRepo.findByCaseId(sql, id);
		const findings   = findingsRepo.findByCaseId(sql, id);

		const peerCases = cr.listByMailbox(sql, debtCase.mailboxId).filter(
			(ca) => ca.creditor === debtCase.creditor && ca.id !== id,
		);
		const eventsByCaseId = new Map(
			peerCases.map((ca) => [ca.id, eventsRepo.findByCaseId(sql, ca.id)]),
		);
		const fingerprint = peerCases.length >= 2
			? buildCollectionFingerprint(debtCase.creditor, peerCases, eventsByCaseId)
			: undefined;

		const prediction = predictNextCollectionStep(debtCase, events, fingerprint);
		const response   = getTacticalResponse(debtCase, findings, prediction);
		return c.json({ tacticalResponse: response, prediction });
	},

	/** GET /cases/:id/timeline-insights */
	async timelineInsights(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const events   = eventsRepo.findByCaseId(sql, id);
		const insights = buildDebtTimelineInsights(debtCase, events);
		return c.json({ insights });
	},
};
