import type { PluginSettings } from "../../types";

const SINGLETON_ID = "singleton";

function defaults(): PluginSettings {
	return {
		enabled: true,
		bankProvider: "none",
		autoClassify: true,
		autoReconcile: true,
	};
}

export const settingsRepo = {
	get(sql: SqlStorage): PluginSettings {
		const [r] = [...sql.exec<Record<string, unknown>>(
			`SELECT * FROM dc_settings WHERE id = ?`,
			SINGLETON_ID,
		)];
		if (!r) return defaults();
		return {
			enabled: Boolean(r.enabled),
			bankProvider: (r.bank_provider as PluginSettings["bankProvider"]) ?? "none",
			autoClassify: Boolean(r.auto_classify),
			autoReconcile: Boolean(r.auto_reconcile),
		};
	},

	set(sql: SqlStorage, patch: Partial<PluginSettings>): void {
		const current = settingsRepo.get(sql);
		const merged = { ...current, ...patch };
		sql.exec(
			`INSERT OR REPLACE INTO dc_settings
				(id, enabled, bank_provider, auto_classify, auto_reconcile, updated_at)
			 VALUES (?,?,?,?,?,datetime('now'))`,
			SINGLETON_ID,
			merged.enabled ? 1 : 0,
			merged.bankProvider,
			merged.autoClassify ? 1 : 0,
			merged.autoReconcile ? 1 : 0,
		);
	},
};
