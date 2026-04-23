import { z } from "zod";

/** Zod schema for the plugin's persisted settings (stored in SQLite). */
export const PluginSettingsSchema = z.object({
	enabled: z.boolean().default(true),
	bankProvider: z.enum(["sparebank1", "csv", "none"]).default("none"),
	autoClassify: z.boolean().default(true),
	autoReconcile: z.boolean().default(true),
});

export type PluginSettingsInput = z.input<typeof PluginSettingsSchema>;
export type PluginSettingsOutput = z.output<typeof PluginSettingsSchema>;
