import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { casesRepo } from "../../storage/repos/cases.repo";
import { findingsRepo } from "../../storage/repos/findings.repo";
import { buildDraft, suggestObjectionKind } from "../../domain/objection-engine";
import type { ObjectionKind } from "../../domain/objection-engine";

type C = Context<MailboxContext>;

export const draftHandlers = {
	/** Generate an objection draft for a case. */
	async draftObjection(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const body     = await c.req.json().catch(() => ({}));
		const findings = findingsRepo.findByCaseId(sql, id);

		// Allow explicit override; otherwise auto-suggest
		const kind: ObjectionKind =
			(body as { kind?: ObjectionKind }).kind ??
			suggestObjectionKind(findings) ??
			"missing_basis";

		const senderName: string = (body as { senderName?: string }).senderName ?? "";
		const draft = buildDraft(kind, debtCase, senderName || undefined);

		return c.json(draft);
	},

	/** Generate a request-more-information draft. */
	async requestMoreInfo(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const body       = await c.req.json().catch(() => ({}));
		const senderName = (body as { senderName?: string }).senderName ?? "";
		const draft      = buildDraft("missing_basis", debtCase, senderName || undefined);

		// Reword subject for info-request
		draft.subject = `Svar: Forespørsel om dokumentasjon – ${debtCase.creditor}`;
		return c.json(draft);
	},
};
