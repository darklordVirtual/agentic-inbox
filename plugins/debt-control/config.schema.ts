import { z } from "zod";

/** Zod schema for the plugin's persisted settings (stored in SQLite). */
export const PluginSettingsSchema = z.object({
	enabled: z.boolean().default(true),
	bankProvider: z.enum(["sparebank1", "csv", "none"]).default("none"),
	autoClassify: z.boolean().default(true),
	autoReconcile: z.boolean().default(true),
	// Draft & response
	autoDraftObjection: z.boolean().default(false),
	autoDraftInfoRequest: z.boolean().default(false),
	// Legality & validation
	enableLegalityCheck: z.boolean().default(true),
	shortDeadlineDays: z.number().int().min(1).max(90).default(7),
	// Priority & alerts
	highValueThresholdNok: z.number().int().min(0).default(10000),
	autoEscalateCourtLetters: z.boolean().default(true),
});

export type PluginSettingsInput = z.input<typeof PluginSettingsSchema>;
export type PluginSettingsOutput = z.output<typeof PluginSettingsSchema>;
