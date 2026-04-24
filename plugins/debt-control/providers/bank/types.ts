/**
 * BankProvider interface — all bank integrations must implement this.
 * Keep SpareBank1 / CSV specifics isolated to their own provider files.
 */

export interface TransactionFilter {
	accountId?: string;
	fromDate?: string;    // ISO date "YYYY-MM-DD"
	toDate?: string;
	limit?: number;
}

export interface RawTransaction {
	/** Provider-side unique identifier. */
	externalId: string;
	amount: number;
	currency: string;
	/** ISO date string. */
	date: string;
	description: string;
	counterparty: string | null;
	/** KID / payment reference / structured reference if available. */
	reference: string | null;
	/** Provider-specific raw data serialised as JSON string for auditability. */
	rawData: string | null;
}

export type ProviderStatus = "configured" | "ok" | "failed" | "not_configured";

export interface ConnectionStatus {
	status: ProviderStatus;
	lastSync: string | null;
	message?: string;
}

export interface BankAccount {
	accountId: string;
	accountNumber?: string;
	name: string;
	type?: string;
	balance?: number;
	availableBalance?: number;
	currency: string;
}

export interface BankProvider {
	readonly id: string;

	/** Health-check / auth verification. Returns status without storing data. */
	testConnection(): Promise<ConnectionStatus>;

	/** Fetch a list of raw transactions from the bank. */
	listTransactions(filter: TransactionFilter): Promise<RawTransaction[]>;

	/** Export transactions as CSV bytes (for download or archival). */
	exportTransactionsCsv(filter: TransactionFilter): Promise<Uint8Array>;

	/** List bank accounts (optional — only supported by API-based providers). */
	listAccounts?(): Promise<BankAccount[]>;
}
