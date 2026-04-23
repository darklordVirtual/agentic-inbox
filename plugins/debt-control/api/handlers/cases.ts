import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { casesRepo } from "../../storage/repos/cases.repo";
import { documentsRepo } from "../../storage/repos/documents.repo";
import { findingsRepo } from "../../storage/repos/findings.repo";
import { paymentMatchesRepo } from "../../storage/repos/transactions.repo";
import { runLegalityChecks } from "../../domain/legality-engine";
import { findingsRepo as fr } from "../../storage/repos/findings.repo";

type C = Context<MailboxContext>;

export const casesHandlers = {
	async list(c: C) {
		const stub      = c.var.mailboxStub;
		const sql       = await stub.getSql();
		const mailboxId = c.req.param("mailboxId")!;
		const status    = c.req.query("status") as string | undefined;

		const cases = casesRepo.listByMailbox(sql, mailboxId, status as any);
		return c.json(cases);
	},

	async get(c: C) {
		const stub   = c.var.mailboxStub;
		const sql    = await stub.getSql();
		const id     = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const documents = documentsRepo.findByCaseId(sql, id);
		const findings  = findingsRepo.findByCaseId(sql, id);
		const matches   = paymentMatchesRepo.findByCaseId(sql, id);

		// Re-run legality checks on every GET (cheap, deterministic)
		const freshFindings = runLegalityChecks(debtCase, documents);
		for (const f of freshFindings) {
			fr.upsert(sql, f);
		}
		const allFindings = findingsRepo.findByCaseId(sql, id);

		return c.json({ case: debtCase, documents, findings: allFindings, paymentMatches: matches });
	},
};
