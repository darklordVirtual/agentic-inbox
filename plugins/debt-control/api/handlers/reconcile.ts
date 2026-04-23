import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { casesRepo } from "../../storage/repos/cases.repo";
import { transactionsRepo } from "../../storage/repos/transactions.repo";
import { reconcile } from "../../domain/reconciliation-engine";

type C = Context<MailboxContext>;

export const reconcileHandlers = {
	/** Run reconciliation for a single case against all imported transactions. */
	async reconcileCase(c: C) {
		const stub      = c.var.mailboxStub;
		const sql       = await stub.getSql();
		const id        = c.req.param("id")!;
		const mailboxId = c.req.param("mailboxId")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const transactions = transactionsRepo.listByMailbox(sql, mailboxId);
		const result = reconcile(sql, [debtCase], transactions);

		return c.json(result);
	},
};
