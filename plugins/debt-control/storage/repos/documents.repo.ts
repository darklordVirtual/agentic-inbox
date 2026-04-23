import type { DebtDocument, DocumentKind } from "../../types";
import { nanoid } from "nanoid";

function row(r: Record<string, unknown>): DebtDocument {
	return {
		id: r.id as string,
		caseId: r.case_id as string,
		emailId: r.email_id as string,
		attachmentId: (r.attachment_id as string | null) ?? null,
		kind: r.kind as DocumentKind,
		extractedText: (r.extracted_text as string | null) ?? null,
		analyzedAt: (r.analyzed_at as string | null) ?? null,
		createdAt: r.created_at as string,
	};
}

export const documentsRepo = {
	findByCaseId(sql: SqlStorage, caseId: string): DebtDocument[] {
		return [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_documents WHERE case_id = ? ORDER BY created_at ASC`,
			caseId,
		)].map(row);
	},

	findByEmailId(sql: SqlStorage, emailId: string): DebtDocument[] {
		return [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_documents WHERE email_id = ? ORDER BY created_at ASC`,
			emailId,
		)].map(row);
	},

	create(
		sql: SqlStorage,
		data: Omit<DebtDocument, "id" | "createdAt">,
	): DebtDocument {
		const id = nanoid();
		sql.exec(
			`INSERT INTO dc_documents
				(id, case_id, email_id, attachment_id, kind, extracted_text, analyzed_at)
			 VALUES (?,?,?,?,?,?,?)`,
			id,
			data.caseId,
			data.emailId,
			data.attachmentId ?? null,
			data.kind,
			data.extractedText ?? null,
			data.analyzedAt ?? null,
		);
		return documentsRepo.findByCaseId(sql, data.caseId).find((d) => d.id === id)!;
	},
};
