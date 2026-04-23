import type { BankTransaction, PaymentMatch, MatchConfidence } from "../../types";
import { nanoid } from "nanoid";

// ── Transactions ──────────────────────────────────────────────────

function txnRow(r: Record<string, unknown>): BankTransaction {
	return {
		id: r.id as string,
		mailboxId: r.mailbox_id as string,
		provider: r.provider as string,
		externalId: r.external_id as string,
		amount: r.amount as number,
		currency: r.currency as string,
		date: r.date as string,
		description: r.description as string,
		counterparty: (r.counterparty as string | null) ?? null,
		reference: (r.reference as string | null) ?? null,
		rawData: (r.raw_data as string | null) ?? null,
		importedAt: r.imported_at as string,
	};
}

export const transactionsRepo = {
	/**
	 * Upsert a transaction — if external_id already exists for this provider, skip.
	 * Returns true if the row was inserted (new), false if it already existed.
	 */
	upsert(sql: SqlStorage, data: Omit<BankTransaction, "id" | "importedAt">): boolean {
		const id = nanoid();
		sql.exec(
			`INSERT OR IGNORE INTO dc_transactions
				(id, mailbox_id, provider, external_id, amount, currency, date,
				 description, counterparty, reference, raw_data)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			id,
			data.mailboxId,
			data.provider,
			data.externalId,
			data.amount,
			data.currency,
			data.date,
			data.description,
			data.counterparty ?? null,
			data.reference ?? null,
			data.rawData ?? null,
		);
		// Check if the row was actually inserted
		const [r] = [...sql.exec<{ id: string }>(
			`SELECT id FROM dc_transactions WHERE provider = ? AND external_id = ?`,
			data.provider,
			data.externalId,
		)];
		return r?.id === id;
	},

	listByMailbox(sql: SqlStorage, mailboxId: string, limit = 200): BankTransaction[] {
		return [...sql.exec<Record<string, unknown>>(
			`SELECT * FROM dc_transactions WHERE mailbox_id = ? ORDER BY date DESC LIMIT ?`,
			mailboxId,
			limit,
		)].map(txnRow);
	},

	findById(sql: SqlStorage, id: string): BankTransaction | null {
		const [r] = [...sql.exec<Record<string, unknown>>(
			`SELECT * FROM dc_transactions WHERE id = ?`,
			id,
		)];
		return r ? txnRow(r) : null;
	},
};

// ── Payment matches ───────────────────────────────────────────────

function matchRow(r: Record<string, unknown>): PaymentMatch {
	return {
		id: r.id as string,
		caseId: r.case_id as string,
		transactionId: r.transaction_id as string,
		confidence: r.confidence as MatchConfidence,
		matchScore: r.match_score as number,
		matchReasons: r.match_reasons as string,
		confirmedAt: (r.confirmed_at as string | null) ?? null,
		createdAt: r.created_at as string,
	};
}

export const paymentMatchesRepo = {
	findByCaseId(sql: SqlStorage, caseId: string): PaymentMatch[] {
		return [...sql.exec<Record<string, unknown>>(
			`SELECT * FROM dc_payment_matches WHERE case_id = ? ORDER BY match_score DESC`,
			caseId,
		)].map(matchRow);
	},

	upsert(sql: SqlStorage, data: Omit<PaymentMatch, "id" | "createdAt">): void {
		const id = nanoid();
		sql.exec(
			`INSERT OR REPLACE INTO dc_payment_matches
				(id, case_id, transaction_id, confidence, match_score, match_reasons, confirmed_at)
			 VALUES (
				 COALESCE((SELECT id FROM dc_payment_matches WHERE case_id = ? AND transaction_id = ?), ?),
				 ?,?,?,?,?,?
			 )`,
			data.caseId, data.transactionId, id,
			data.caseId, data.transactionId,
			data.confidence, data.matchScore,
			data.matchReasons, data.confirmedAt ?? null,
		);
	},

	confirm(sql: SqlStorage, id: string): void {
		sql.exec(
			`UPDATE dc_payment_matches SET confirmed_at = datetime('now') WHERE id = ?`,
			id,
		);
	},
};
