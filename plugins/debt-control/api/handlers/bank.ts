import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { settingsRepo } from "../../storage/repos/settings.repo";
import { transactionsRepo } from "../../storage/repos/transactions.repo";
import { bankRegistry } from "../../providers/bank/registry";
import { SpareBank1Provider } from "../../providers/bank/sparebank1/provider";
import { CsvProvider } from "../../providers/bank/csv/provider";

type C = Context<MailboxContext>;

/** Read SB1 secrets from environment — never from request body. */
function sb1Secrets(env: Cloudflare.Env) {
	return {
		clientId:    (env as unknown as Record<string, string>)["SB1_CLIENT_ID"]    ?? "",
		accessToken: (env as unknown as Record<string, string>)["SB1_ACCESS_TOKEN"] ?? "",
	};
}

export const bankHandlers = {
	/** Return bank provider status (no secrets exposed). */
	async getStatus(c: C) {
		const stub     = c.var.mailboxStub;
		const sql      = await stub.getSql();
		const settings = settingsRepo.get(sql);

		if (settings.bankProvider === "none") {
			return c.json({ status: "not_configured", provider: "none", lastSync: null });
		}

		return c.json({
			status: "configured",
			provider: settings.bankProvider,
			lastSync: null,  // Future: persist lastSyncAt in settings
		});
	},

	/** Test the configured bank connection. */
	async testConnection(c: C) {
		const stub     = c.var.mailboxStub;
		const sql      = await stub.getSql();
		const settings = settingsRepo.get(sql);

		if (settings.bankProvider === "sparebank1") {
			const secrets = sb1Secrets(c.env);
			if (!secrets.clientId || !secrets.accessToken) {
				return c.json({ status: "failed", message: "SB1_CLIENT_ID or SB1_ACCESS_TOKEN not set." }, 400);
			}
			const provider = new SpareBank1Provider(secrets);
			const result   = await provider.testConnection();
			return c.json(result);
		}

		if (settings.bankProvider === "csv") {
			return c.json({ status: "configured", lastSync: null, message: "CSV provider does not require a connection test." });
		}

		return c.json({ status: "not_configured", message: "No bank provider configured." }, 400);
	},

	/** Trigger a manual bank sync. */
	async sync(c: C) {
		const stub      = c.var.mailboxStub;
		const sql       = await stub.getSql();
		const settings  = settingsRepo.get(sql);
		const mailboxId = c.req.param("mailboxId")!;

		if (settings.bankProvider === "none") {
			return c.json({ error: "No bank provider configured." }, 400);
		}

		let provider;
		if (settings.bankProvider === "sparebank1") {
			const secrets = sb1Secrets(c.env);
			if (!secrets.clientId || !secrets.accessToken) {
				return c.json({ error: "SpareBank1 secrets not configured." }, 400);
			}
			provider = new SpareBank1Provider(secrets);
		} else if (settings.bankProvider === "csv") {
			// CSV sync happens via file upload — this endpoint not applicable
			return c.json({ error: "CSV provider requires file upload, not sync." }, 400);
		} else {
			return c.json({ error: "Unknown provider." }, 400);
		}

		// Fetch last 90 days by default
		const toDate   = new Date().toISOString().slice(0, 10);
		const fromDate = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

		const rawTxns = await provider.listTransactions({ fromDate, toDate, limit: 500 });
		let imported = 0;
		for (const t of rawTxns) {
			const isNew = transactionsRepo.upsert(sql, { ...t, mailboxId, provider: settings.bankProvider });
			if (isNew) imported++;
		}

		return c.json({ imported, total: rawTxns.length, fromDate, toDate });
	},
};
