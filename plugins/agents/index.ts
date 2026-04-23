import type { InboxPlugin } from "../../workers/plugins/types";
import { agentsMigrations } from "./storage/migrations";
import { registerAgentsRoutes } from "./api/routes";
import { onEmailReceived } from "./hooks/on-email-received";

export const agentsPlugin: InboxPlugin = {
	manifest: {
		id: "agents",
		name: "AI Agents",
		version: "1.0.0",
		description: "Configurable AI agents for automated email processing — spam guard, research, auto-reply, summarization, and more.",
		settingsSchema: {
			defaultProviderId: {
				type: "string",
				label: "Default AI Provider",
				description: "Provider used when creating new agents",
				default: "cloudflare",
			},
		},
	},
	migrations: agentsMigrations,
	registerRoutes: registerAgentsRoutes,
	onEmailReceived,
};

export default agentsPlugin;
