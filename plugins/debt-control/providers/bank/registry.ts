/**
 * Bank provider registry.
 * Keeps provider resolution decoupled from plugin core logic.
 */

import type { BankProvider } from "./types";

const providers = new Map<string, BankProvider>();

export const bankRegistry = {
	register(provider: BankProvider): void {
		providers.set(provider.id, provider);
	},

	get(id: string): BankProvider | null {
		return providers.get(id) ?? null;
	},

	list(): string[] {
		return [...providers.keys()];
	},
};
