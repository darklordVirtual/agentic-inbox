import type { DebtCase, CaseStatus, CasePriority } from "../../types";
import { nanoid } from "nanoid";

function row(r: Record<string, unknown>): DebtCase {
	return {
		id: r.id as string,
		mailboxId: r.mailbox_id as string,
		creditor: r.creditor as string,
		reference: (r.reference as string | null) ?? null,
		amountDue: (r.amount_due as number | null) ?? null,
		currency: (r.currency as string) ?? "NOK",
		dueDate: (r.due_date as string | null) ?? null,
		status: r.status as CaseStatus,
		priority: r.priority as CasePriority,
		firstEmailId: (r.first_email_id as string | null) ?? null,
		lastEmailId: (r.last_email_id as string | null) ?? null,
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

	findByCreditorRef(
		sql: SqlStorage,
		mailboxId: string,
		creditor: string,
		reference: string | null,
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
		// Fall back to most recent open case from same creditor
		const [r] = [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_cases WHERE mailbox_id = ? AND creditor = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
			mailboxId,
			creditor,
		)];
		return r ? row(r) : null;
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
		sql.exec(
			`INSERT INTO dc_cases
				(id, mailbox_id, creditor, reference, amount_due, currency, due_date,
				 status, priority, first_email_id, last_email_id)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			id,
			data.mailboxId,
			data.creditor,
			data.reference ?? null,
			data.amountDue ?? null,
			data.currency,
			data.dueDate ?? null,
			data.status,
			data.priority,
			data.firstEmailId ?? null,
			data.lastEmailId ?? null,
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

		if (patch.creditor !== undefined)    { fields.push("creditor = ?");     vals.push(patch.creditor); }
		if (patch.reference !== undefined)   { fields.push("reference = ?");    vals.push(patch.reference); }
		if (patch.amountDue !== undefined)   { fields.push("amount_due = ?");   vals.push(patch.amountDue); }
		if (patch.currency !== undefined)    { fields.push("currency = ?");     vals.push(patch.currency); }
		if (patch.dueDate !== undefined)     { fields.push("due_date = ?");     vals.push(patch.dueDate); }
		if (patch.status !== undefined)      { fields.push("status = ?");       vals.push(patch.status); }
		if (patch.priority !== undefined)    { fields.push("priority = ?");     vals.push(patch.priority); }
		if (patch.lastEmailId !== undefined) { fields.push("last_email_id = ?"); vals.push(patch.lastEmailId); }

		if (fields.length === 0) return;
		fields.push("updated_at = datetime('now')");
		vals.push(id);

		sql.exec(
			`UPDATE dc_cases SET ${fields.join(", ")} WHERE id = ?`,
			...vals,
		);
	},
};
