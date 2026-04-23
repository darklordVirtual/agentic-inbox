/**
 * SpareBank 1 BankProvider implementation.
 * Uses client.ts for HTTP + mapper.ts for type conversion.
 */

import type { BankProvider, ConnectionStatus, RawTransaction, TransactionFilter } from "../types";
import type { SpareBank1Secrets } from "./config";
import { validateSecrets } from "./config";
import { buildAuthHeaders } from "./auth";
import { SpareBank1Client } from "./client";
import { mapTransaction } from "./mapper";

export class SpareBank1Provider implements BankProvider {
	readonly id = "sparebank1";
	private client: SpareBank1Client;
	private accountId: string | null;

	constructor(secrets: SpareBank1Secrets, accountId: string | null = null) {
		if (!validateSecrets(secrets)) {
			throw new Error("SpareBank1Provider: missing required secrets (clientId / accessToken).");
		}
		const headers = buildAuthHeaders(secrets);
		this.client  = new SpareBank1Client(headers);
		this.accountId = accountId;
	}

	async testConnection(): Promise<ConnectionStatus> {
		try {
			const txns = await this.client.listTransactions({
				accountId: this.accountId ?? undefined,
				limit: 1,
			});
			return {
				status: "ok",
				lastSync: new Date().toISOString(),
				message: `Connection successful. Sample size: ${txns.length}.`,
			};
		} catch (err) {
			return {
				status: "failed",
				lastSync: null,
				message: err instanceof Error ? err.message : "Unknown error",
			};
		}
	}

	async listTransactions(filter: TransactionFilter): Promise<RawTransaction[]> {
		const raw = await this.client.listTransactions({
			accountId: filter.accountId ?? this.accountId ?? undefined,
			fromDate: filter.fromDate,
			toDate: filter.toDate,
			limit: filter.limit,
		});
		return raw.map(mapTransaction);
	}

	async exportTransactionsCsv(filter: TransactionFilter): Promise<Uint8Array> {
		return this.client.exportCsv({
			accountId: filter.accountId ?? this.accountId ?? undefined,
			fromDate: filter.fromDate,
			toDate: filter.toDate,
		});
	}
}
