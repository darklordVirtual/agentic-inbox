import type { PluginSettings } from "../../types";

const SINGLETON_ID = "singleton";

function defaults(): PluginSettings {
	return {
		enabled: true,
		bankProvider: "none",
		autoClassify: true,
		autoReconcile: true,
		autoDraftObjection: false,
		autoDraftInfoRequest: false,
		enableLegalityCheck: true,
		shortDeadlineDays: 7,
		highValueThresholdNok: 10000,
		autoEscalateCourtLetters: true,
	};
}

export const settingsRepo = {
	get(sql: SqlStorage): PluginSettings {
		const [r] = [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_settings WHERE id = ?`,
			SINGLETON_ID,
		)];
		if (!r) return defaults();
		return {
			enabled: Boolean(r.enabled),
			bankProvider: (r.bank_provider as PluginSettings["bankProvider"]) ?? "none",
			autoClassify: Boolean(r.auto_classify),
			autoReconcile: Boolean(r.auto_reconcile),
			autoDraftObjection: Boolean(r.auto_draft_objection),
			autoDraftInfoRequest: Boolean(r.auto_draft_info_request),
			enableLegalityCheck: Boolean(r.enable_legality_check ?? 1),
			shortDeadlineDays: Number(r.short_deadline_days ?? 7),
			highValueThresholdNok: Number(r.high_value_threshold_nok ?? 10000),
			autoEscalateCourtLetters: Boolean(r.auto_escalate_court_letters ?? 1),
		};
	},

	set(sql: SqlStorage, patch: Partial<PluginSettings>): void {
		const current = settingsRepo.get(sql);
		const merged = { ...current, ...patch };
		sql.exec(
			`INSERT OR REPLACE INTO dc_settings
				(id, enabled, bank_provider, auto_classify, auto_reconcile,
				 auto_draft_objection, auto_draft_info_request,
				 enable_legality_check, short_deadline_days,
				 high_value_threshold_nok, auto_escalate_court_letters,
				 updated_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
			SINGLETON_ID,
			merged.enabled ? 1 : 0,
			merged.bankProvider,
			merged.autoClassify ? 1 : 0,
			merged.autoReconcile ? 1 : 0,
			merged.autoDraftObjection ? 1 : 0,
			merged.autoDraftInfoRequest ? 1 : 0,
			merged.enableLegalityCheck ? 1 : 0,
			merged.shortDeadlineDays,
			merged.highValueThresholdNok,
			merged.autoEscalateCourtLetters ? 1 : 0,
		);
	},
};
