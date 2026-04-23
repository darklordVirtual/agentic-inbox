/**
 * Hook: onSyncRequest
 *
 * Called when a manual bank sync is requested.
 * Fetches transactions and runs reconciliation across all open cases.
 */

import type { OnSyncRequestPayload, PluginContext } from "../../../workers/plugins/types";
import { settingsRepo } from "../storage/repos/settings.repo";
import { casesRepo } from "../storage/repos/cases.repo";
import { transactionsRepo } from "../storage/repos/transactions.repo";
import { reconcile } from "../domain/reconciliation-engine";
import { SpareBank1Provider } from "../providers/bank/sparebank1/provider";

export async function onSyncRequest(
	payload: OnSyncRequestPayload,
	ctx: PluginContext,
): Promise<void> {
	const settings = settingsRepo.get(ctx.sql);
	if (!settings.enabled || settings.bankProvider === "none") return;

	interface EnvWithSecrets {
		SB1_CLIENT_ID?: string;
		SB1_ACCESS_TOKEN?: string;
	}

	// Only SpareBank1 supports automated sync; CSV is upload-only
	if (settings.bankProvider === "sparebank1") {
		const env = ctx.env as unknown as EnvWithSecrets;
		const clientId    = env.SB1_CLIENT_ID ?? "";
		const accessToken = env.SB1_ACCESS_TOKEN ?? "";
		if (!clientId || !accessToken) {
			console.warn("[debt-control] SB1 secrets not set, skipping sync.");
			return;
		}

		const provider = new SpareBank1Provider({ clientId, accessToken });
		const toDate   = new Date().toISOString().slice(0, 10);
		const fromDate = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
		const rawTxns  = await provider.listTransactions({ fromDate, toDate, limit: 500 });

		for (const t of rawTxns) {
			transactionsRepo.upsert(ctx.sql, {
				...t,
				mailboxId: ctx.mailboxId,
				provider: "sparebank1",
			});
		}

		if (settings.autoReconcile) {
			const cases = casesRepo.listByMailbox(ctx.sql, ctx.mailboxId);
			const txns  = transactionsRepo.listByMailbox(ctx.sql, ctx.mailboxId);
			reconcile(ctx.sql, cases, txns);
		}
	}
}
