import type { DebtEvent, DebtAmountBreakdown } from "../../types";
import { nanoid } from "nanoid";

function rowToEvent(r: Record<string, unknown>): DebtEvent {
	return {
		id:                   r.id as string,
		caseId:               r.case_id as string,
		date:                 r.date as string,
		sourceEmailId:        r.source_email_id as string,
		sourceAttachmentId:   (r.source_attachment_id as string | null) ?? null,
		sourceFileName:       (r.source_file_name as string | null) ?? null,
		kind:                 r.kind as DebtEvent["kind"],
		creditor:             (r.creditor as string | null) ?? null,
		externalCaseNo:       (r.external_case_no as string | null) ?? null,
		invoiceNos:           JSON.parse((r.invoice_nos_json as string | null) ?? "[]"),
		amounts:              JSON.parse((r.amounts_json as string | null) ?? "{}") as DebtAmountBreakdown,
		deadline:             (r.deadline as string | null) ?? null,
		rawTextHash:          (r.raw_text_hash as string | null) ?? null,
		extractedTextPreview: (r.extracted_text_preview as string | null) ?? null,
		createdAt:            r.created_at as string,
	};
}

export const eventsRepo = {
	findByCaseId(sql: SqlStorage, caseId: string): DebtEvent[] {
		return [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_events WHERE case_id = ? ORDER BY date ASC, created_at ASC`,
			caseId,
		)].map(rowToEvent);
	},

	findByEmailId(sql: SqlStorage, emailId: string): DebtEvent[] {
		return [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_events WHERE source_email_id = ? ORDER BY created_at ASC`,
			emailId,
		)].map(rowToEvent);
	},

	create(sql: SqlStorage, data: Omit<DebtEvent, "id" | "createdAt">): DebtEvent {
		const id = nanoid();
		sql.exec(
			`INSERT INTO dc_events
				(id, case_id, date, source_email_id, source_attachment_id, source_file_name,
				 kind, creditor, external_case_no, invoice_nos_json, amounts_json,
				 deadline, raw_text_hash, extracted_text_preview)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			id,
			data.caseId,
			data.date,
			data.sourceEmailId,
			data.sourceAttachmentId ?? null,
			data.sourceFileName ?? null,
			data.kind,
			data.creditor ?? null,
			data.externalCaseNo ?? null,
			JSON.stringify(data.invoiceNos),
			JSON.stringify(data.amounts),
			data.deadline ?? null,
			data.rawTextHash ?? null,
			data.extractedTextPreview ?? null,
		);
		return { ...data, id, createdAt: new Date().toISOString() };
	},
};
