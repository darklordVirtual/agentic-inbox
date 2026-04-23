/**
 * SpareBank 1 HTTP client.
 *
 * All raw HTTP calls to the SpareBank 1 Transactions API live here.
 * Authentication headers are injected; no business logic.
 *
 * Docs: https://api.sparebank1.no/personal/banking/transactions
 */

import { SB1_BASE_URL } from "./config";

export interface SB1TransactionListParams {
	accountId?: string;
	fromDate?: string;   // YYYY-MM-DD
	toDate?: string;
	limit?: number;
}

export interface SB1RawTransaction {
	transactionId: string;
	amount: { value: number; currency: string };
	accountingDate: string;
	description?: string;
	text?: string;
	counterpartyAccount?: { name?: string };
	remittanceInfo?: string;
	[key: string]: unknown;
}

export interface SB1RawClassifiedTransaction extends SB1RawTransaction {
	category?: { id?: string; name?: string };
	merchant?: { name?: string };
}

export class SpareBank1Client {
	constructor(private readonly headers: Record<string, string>) {}

	private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
		const url = new URL(`${SB1_BASE_URL}${path}`);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined && v !== "") url.searchParams.set(k, v);
			}
		}
		const res = await fetch(url.toString(), {
			method: "GET",
			headers: this.headers,
		});
		if (!res.ok) {
			throw new Error(`SpareBank1 API error: ${res.status} ${res.statusText} (${url.pathname})`);
		}
		return res.json() as Promise<T>;
	}

	async listTransactions(params: SB1TransactionListParams): Promise<SB1RawTransaction[]> {
		const q: Record<string, string> = {};
		if (params.accountId) q.accountId = params.accountId;
		if (params.fromDate)  q.fromDate  = params.fromDate;
		if (params.toDate)    q.toDate    = params.toDate;
		if (params.limit)     q.limit     = String(params.limit);

		const data = await this.get<{ transactions?: SB1RawTransaction[] }>("/", q);
		return data.transactions ?? [];
	}

	async listClassifiedTransactions(params: SB1TransactionListParams): Promise<SB1RawClassifiedTransaction[]> {
		const q: Record<string, string> = {};
		if (params.accountId) q.accountId = params.accountId;
		if (params.fromDate)  q.fromDate  = params.fromDate;
		if (params.toDate)    q.toDate    = params.toDate;
		if (params.limit)     q.limit     = String(params.limit);

		const data = await this.get<{ transactions?: SB1RawClassifiedTransaction[] }>("/classified", q);
		return data.transactions ?? [];
	}

	async getTransactionDetails(id: string): Promise<SB1RawTransaction> {
		return this.get<SB1RawTransaction>(`/${encodeURIComponent(id)}/details`);
	}

	async getTransactionDetailsClassified(id: string): Promise<SB1RawClassifiedTransaction> {
		return this.get<SB1RawClassifiedTransaction>(`/${encodeURIComponent(id)}/details/classified`);
	}

	async exportCsv(params: SB1TransactionListParams): Promise<Uint8Array> {
		const url = new URL(`${SB1_BASE_URL}/export`);
		if (params.accountId) url.searchParams.set("accountId", params.accountId);
		if (params.fromDate)  url.searchParams.set("fromDate", params.fromDate);
		if (params.toDate)    url.searchParams.set("toDate", params.toDate);

		const res = await fetch(url.toString(), {
			headers: { ...this.headers, Accept: "text/csv" },
		});
		if (!res.ok) {
			throw new Error(`SpareBank1 CSV export failed: ${res.status}`);
		}
		return new Uint8Array(await res.arrayBuffer());
	}
}
