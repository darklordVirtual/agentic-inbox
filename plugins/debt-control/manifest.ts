import type { PluginManifest } from "../../workers/plugins/types";

export const debtControlManifest: PluginManifest = {
	id: "debt-control",
	name: "Debt Control",
	version: "0.1.0",
	description:
		"Mailbox-native debtor operations engine. Classifies incoming demands, " +
		"links them to cases, reconciles bank transactions and suggests actions.",
	settingsSchema: {
		enabled: {
			type: "boolean",
			label: "Enable Debt Control",
			default: true,
			required: false,
		},
		bankProvider: {
			type: "string",
			label: "Bank provider",
			description: "Which bank provider to use: sparebank1 | csv | none",
			default: "none",
		},
		autoClassify: {
			type: "boolean",
			label: "Auto-classify incoming emails",
			description:
				"Automatically run classification when a new email arrives.",
			default: true,
		},
		autoReconcile: {
			type: "boolean",
			label: "Auto-reconcile on bank sync",
			description:
				"Automatically match transactions to open cases after a sync.",
			default: true,
		},
	},
};
