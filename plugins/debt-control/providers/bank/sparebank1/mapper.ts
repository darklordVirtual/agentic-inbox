/**
 * SpareBank 1 → internal type mapper.
 * Isolates all SB1-specific field names here.
 */

import type { SB1RawTransaction, SB1RawAccount } from "./client";
import type { BankAccount, RawTransaction } from "../types";

export function mapTransaction(raw: SB1RawTransaction): RawTransaction {
	return {
		externalId: raw.transactionId,
		amount: raw.amount?.value ?? 0,
		currency: raw.amount?.currency ?? "NOK",
		date: raw.accountingDate ?? new Date().toISOString().slice(0, 10),
		description: raw.description ?? raw.text ?? "",
		counterparty: raw.counterpartyAccount?.name ?? null,
		reference: raw.remittanceInfo ?? null,
		rawData: JSON.stringify(raw),
	};
}

export function mapAccount(raw: SB1RawAccount): BankAccount {
	return {
		accountId: raw.accountId,
		accountNumber: raw.accountNumber,
		name: raw.accountName ?? raw.accountId,
		type: raw.accountType,
		balance: raw.balance?.value,
		availableBalance: raw.availableBalance?.value,
		currency: raw.balance?.currency ?? "NOK",
	};
}
