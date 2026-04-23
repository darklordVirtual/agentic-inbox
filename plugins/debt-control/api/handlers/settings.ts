import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { settingsRepo } from "../../storage/repos/settings.repo";
import { PluginSettingsSchema } from "../../config.schema";

type C = Context<MailboxContext>;

export const settingsHandlers = {
	async get(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		return c.json(settingsRepo.get(sql));
	},

	async update(c: C) {
		const stub  = c.var.mailboxStub;
		const sql   = await stub.getSql();
		const body  = await c.req.json();
		const patch = PluginSettingsSchema.partial().parse(body);
		settingsRepo.set(sql, patch);
		return c.json(settingsRepo.get(sql));
	},
};
