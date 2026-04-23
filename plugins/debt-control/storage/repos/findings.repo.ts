import type { Finding, FindingCode } from "../../types";
import { nanoid } from "nanoid";

function row(r: Record<string, unknown>): Finding {
	return {
		id: r.id as string,
		caseId: r.case_id as string,
		code: r.code as FindingCode,
		severity: r.severity as Finding["severity"],
		description: r.description as string,
		detectedAt: r.detected_at as string,
	};
}

export const findingsRepo = {
	findByCaseId(sql: SqlStorage, caseId: string): Finding[] {
		return [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_findings WHERE case_id = ? ORDER BY detected_at DESC`,
			caseId,
		)].map(row);
	},

	/** Avoid duplicating the same code for the same case. */
	upsert(
		sql: SqlStorage,
		data: Omit<Finding, "id" | "detectedAt">,
	): void {
		const id = nanoid();
		sql.exec(
			`INSERT OR REPLACE INTO dc_findings (id, case_id, code, severity, description)
			 VALUES (
				 COALESCE((SELECT id FROM dc_findings WHERE case_id = ? AND code = ?), ?),
				 ?, ?, ?, ?
			 )`,
			data.caseId,
			data.code,
			id,
			data.caseId,
			data.code,
			data.severity,
			data.description,
		);
	},

	deleteForCase(sql: SqlStorage, caseId: string): void {
		sql.exec(`DELETE FROM dc_findings WHERE case_id = ?`, caseId);
	},
};
