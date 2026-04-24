import type { DebtCase, CaseStatus, CasePriority, DebtAmountBreakdown, DebtInvoice } from "../../types";
import { nanoid } from "nanoid";

function row(r: Record<string, unknown>): DebtCase {
	return {
		id: r.id as string,
		mailboxId: r.mailbox_id as string,
		creditor: r.creditor as string,
		reference: (r.reference as string | null) ?? null,
		externalCaseNo: (r.external_case_no as string | null) ?? null,
		amountDue: (r.amount_due as number | null) ?? null,
		currency: (r.currency as string) ?? "NOK",
		dueDate: (r.due_date as string | null) ?? null,
		amounts: r.amounts_json ? (JSON.parse(r.amounts_json as string) as DebtAmountBreakdown) : null,
		invoices: JSON.parse((r.invoices_json as string | null) ?? "[]") as DebtInvoice[],
		parentCaseNo: (r.parent_case_no as string | null) ?? null,
		mergedCaseNos: JSON.parse((r.merged_case_nos_json as string | null) ?? "[]") as string[],
		status: r.status as CaseStatus,
		priority: r.priority as CasePriority,
		firstEmailId: (r.first_email_id as string | null) ?? null,
		lastEmailId: (r.last_email_id as string | null) ?? null,
		firstSeenAt: (r.first_seen_at as string | null) ?? null,
		lastSeenAt: (r.last_seen_at as string | null) ?? null,
		objectionDate: (r.objection_date as string | null) ?? null,
		processingLimitationRequestedAt: (r.processing_limitation_requested_at as string | null) ?? null,
		closedAt: (r.closed_at as string | null) ?? null,
		settlementOfferAmount: (r.settlement_offer_amount as number | null) ?? null,
		settlementOfferDeadline: (r.settlement_offer_deadline as string | null) ?? null,
		createdAt: r.created_at as string,
		updatedAt: r.updated_at as string,
	};
}

export const casesRepo = {
	findById(sql: SqlStorage, id: string): DebtCase | null {
		const [r] = [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_cases WHERE id = ?`,
			id,
		)];
		return r ? row(r) : null;
	},

	findByExternalCaseNo(sql: SqlStorage, mailboxId: string, externalCaseNo: string): DebtCase | null {
		const [r] = [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_cases WHERE mailbox_id = ? AND external_case_no = ? LIMIT 1`,
			mailboxId,
			externalCaseNo,
		)];
		return r ? row(r) : null;
	},

	findByCreditorRef(
		sql: SqlStorage,
		mailboxId: string,
		creditor: string,
		reference: string | null,
		amountDue?: number | null,
		dueDate?: string | null,
	): DebtCase | null {
		if (reference) {
			const [r] = [...sql.exec<Record<string, SqlStorageValue>>(
				`SELECT * FROM dc_cases WHERE mailbox_id = ? AND creditor = ? AND reference = ? LIMIT 1`,
				mailboxId,
				creditor,
				reference,
			)];
			if (r) return row(r);
		}
		// Without a reference, score open cases from the same creditor by how closely
		// amount and due-date match. Require at least one field to match; return null
		// when none are close enough so a new case is created instead of merging
		// unrelated claims from the same creditor.
		const candidates = [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_cases WHERE mailbox_id = ? AND creditor = ? AND status = 'open' ORDER BY created_at DESC LIMIT 10`,
			mailboxId,
			creditor,
		)].map(row);

		if (candidates.length === 0) return null;

		// Score each candidate
		let best: DebtCase | null = null;
		let bestScore = 0;

		for (const c of candidates) {
			let score = 0;
			if (amountDue != null && c.amountDue != null) {
				// Consider amounts equal within 1 NOK rounding
				if (Math.abs(amountDue - c.amountDue) < 1) score += 3;
			}
			if (dueDate && c.dueDate === dueDate) score += 2;
			if (score > bestScore) {
				bestScore = score;
				best = c;
			}
		}

		// Only merge if we had a meaningful field match (score ≥ 2)
		return bestScore >= 2 ? best : null;
	},

	listByMailbox(
		sql: SqlStorage,
		mailboxId: string,
		status?: CaseStatus,
	): DebtCase[] {
		if (status) {
			return [...sql.exec<Record<string, SqlStorageValue>>(
				`SELECT * FROM dc_cases WHERE mailbox_id = ? AND status = ? ORDER BY updated_at DESC`,
				mailboxId,
				status,
			)].map(row);
		}
		return [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_cases WHERE mailbox_id = ? ORDER BY updated_at DESC`,
			mailboxId,
		)].map(row);
	},

	create(
		sql: SqlStorage,
		data: Omit<DebtCase, "id" | "createdAt" | "updatedAt">,
	): DebtCase {
		const id = nanoid();
		const now = new Date().toISOString();
		sql.exec(
			`INSERT INTO dc_cases
				(id, mailbox_id, creditor, reference, external_case_no, amount_due, currency, due_date,
				 amounts_json, invoices_json, parent_case_no, merged_case_nos_json,
				 status, priority, first_email_id, last_email_id,
				 first_seen_at, last_seen_at, objection_date,
				 processing_limitation_requested_at, closed_at,
				 settlement_offer_amount, settlement_offer_deadline)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			id,
			data.mailboxId,
			data.creditor,
			data.reference ?? null,
			data.externalCaseNo ?? null,
			data.amountDue ?? null,
			data.currency,
			data.dueDate ?? null,
			data.amounts ? JSON.stringify(data.amounts) : null,
			JSON.stringify(data.invoices ?? []),
			data.parentCaseNo ?? null,
			JSON.stringify(data.mergedCaseNos ?? []),
			data.status,
			data.priority,
			data.firstEmailId ?? null,
			data.lastEmailId ?? null,
			data.firstSeenAt ?? now,
			data.lastSeenAt ?? now,
			data.objectionDate ?? null,
			data.processingLimitationRequestedAt ?? null,
			data.closedAt ?? null,
			data.settlementOfferAmount ?? null,
			data.settlementOfferDeadline ?? null,
		);
		return casesRepo.findById(sql, id)!;
	},

	update(
		sql: SqlStorage,
		id: string,
		patch: Partial<Omit<DebtCase, "id" | "mailboxId" | "createdAt">>,
	): void {
		const fields: string[] = [];
		const vals: unknown[] = [];

		if (patch.creditor !== undefined)            { fields.push("creditor = ?");             vals.push(patch.creditor); }
		if (patch.reference !== undefined)           { fields.push("reference = ?");            vals.push(patch.reference); }
		if (patch.externalCaseNo !== undefined)      { fields.push("external_case_no = ?");     vals.push(patch.externalCaseNo); }
		if (patch.amountDue !== undefined)           { fields.push("amount_due = ?");           vals.push(patch.amountDue); }
		if (patch.currency !== undefined)            { fields.push("currency = ?");             vals.push(patch.currency); }
		if (patch.dueDate !== undefined)             { fields.push("due_date = ?");             vals.push(patch.dueDate); }
		if (patch.amounts !== undefined)             { fields.push("amounts_json = ?");         vals.push(patch.amounts ? JSON.stringify(patch.amounts) : null); }
		if (patch.invoices !== undefined)            { fields.push("invoices_json = ?");        vals.push(JSON.stringify(patch.invoices)); }
		if (patch.parentCaseNo !== undefined)        { fields.push("parent_case_no = ?");       vals.push(patch.parentCaseNo); }
		if (patch.mergedCaseNos !== undefined)       { fields.push("merged_case_nos_json = ?"); vals.push(JSON.stringify(patch.mergedCaseNos)); }
		if (patch.status !== undefined)              { fields.push("status = ?");               vals.push(patch.status); }
		if (patch.priority !== undefined)            { fields.push("priority = ?");             vals.push(patch.priority); }
		if (patch.lastEmailId !== undefined)         { fields.push("last_email_id = ?");        vals.push(patch.lastEmailId); }
		if (patch.lastSeenAt !== undefined)          { fields.push("last_seen_at = ?");         vals.push(patch.lastSeenAt); }
		if (patch.objectionDate !== undefined)       { fields.push("objection_date = ?");       vals.push(patch.objectionDate); }
		if (patch.processingLimitationRequestedAt !== undefined) { fields.push("processing_limitation_requested_at = ?"); vals.push(patch.processingLimitationRequestedAt); }
		if (patch.closedAt !== undefined)            { fields.push("closed_at = ?");            vals.push(patch.closedAt); }
		if (patch.settlementOfferAmount !== undefined)   { fields.push("settlement_offer_amount = ?");   vals.push(patch.settlementOfferAmount); }
		if (patch.settlementOfferDeadline !== undefined) { fields.push("settlement_offer_deadline = ?"); vals.push(patch.settlementOfferDeadline); }

		if (fields.length === 0) return;
		fields.push("updated_at = datetime('now')");
		vals.push(id);

		sql.exec(`UPDATE dc_cases SET ${fields.join(", ")} WHERE id = ?`, ...vals);
	},
};
