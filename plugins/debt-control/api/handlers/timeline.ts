import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { casesRepo } from "../../storage/repos/cases.repo";
import { eventsRepo } from "../../storage/repos/events.repo";

type C = Context<MailboxContext>;

export const timelineHandlers = {
	async get(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const events = eventsRepo.findByCaseId(sql, id);
		return c.json({ caseId: id, events });
	},
};
