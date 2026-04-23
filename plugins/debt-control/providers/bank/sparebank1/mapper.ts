/**
 * SpareBank 1 → internal type mapper.
 * Isolates all SB1-specific field names here.
 */

import type { SB1RawTransaction } from "./client";
import type { RawTransaction } from "../types";

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
