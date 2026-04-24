import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { settingsRepo } from "../../storage/repos/settings.repo";
import { transactionsRepo } from "../../storage/repos/transactions.repo";
import { bankRegistry } from "../../providers/bank/registry";
import { SpareBank1Provider } from "../../providers/bank/sparebank1/provider";
import { CsvProvider, parseCsvTransactions } from "../../providers/bank/csv/provider";

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
			lastSync: null,
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

	/** List SpareBank 1 accounts (requires configured secrets). */
	async listAccounts(c: C) {
		const secrets = sb1Secrets(c.env);
		if (!secrets.clientId || !secrets.accessToken) {
			return c.json({ error: "SB1_CLIENT_ID or SB1_ACCESS_TOKEN not set." }, 400);
		}
		try {
			const provider = new SpareBank1Provider(secrets);
			const accounts = await provider.listAccounts!();
			return c.json({ accounts });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : "Failed to list accounts" }, 502);
		}
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
			return c.json({ error: "CSV provider requires file upload, not sync." }, 400);
		} else {
			return c.json({ error: "Unknown provider." }, 400);
		}

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

	/**
	 * Upload a CSV bank statement (multipart/form-data, field: "file").
	 * Switches provider to "csv" and imports the transactions immediately.
	 */
	async uploadCsv(c: C) {
		const mailboxId = c.req.param("mailboxId")!;
		const stub      = c.var.mailboxStub;
		const sql       = await stub.getSql();

		let csvContent: string;
		try {
			const formData = await c.req.formData();
			const file     = formData.get("file");
			if (!file || typeof file === "string") {
				return c.json({ error: "Missing 'file' field in multipart upload." }, 400);
			}
			csvContent = await (file as File).text();
		} catch {
			return c.json({ error: "Failed to parse multipart form data." }, 400);
		}

		if (!csvContent.trim()) {
			return c.json({ error: "Uploaded file is empty." }, 400);
		}

		// Switch provider to csv
		settingsRepo.update(sql, { bankProvider: "csv" } as any);

		// Parse and import
		let transactions: ReturnType<typeof parseCsvTransactions>;
		try {
			transactions = parseCsvTransactions(csvContent);
		} catch {
			return c.json({ error: "Could not parse CSV. Check the file format." }, 422);
		}

		if (transactions.length === 0) {
			return c.json({ error: "No valid transactions found in CSV." }, 422);
		}

		let imported = 0;
		for (const t of transactions) {
			const isNew = transactionsRepo.upsert(sql, { ...t, mailboxId, provider: "csv" });
			if (isNew) imported++;
		}

		console.log(`[bank] CSV upload mailbox=${mailboxId} rows=${transactions.length} imported=${imported}`);
		return c.json({ imported, total: transactions.length });
	},
};
