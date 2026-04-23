/**
 * Guardrail enforcement.
 * Every agent run must pass these checks before an AI call is made.
 */

import type { AgentGuardrails } from "../types";
import { checkAndIncrementRate, getDailyTokensUsed } from "../storage/repo";

export interface GuardrailResult {
	allowed: boolean;
	reason?: string;
}

/**
 * Check all guardrails for the agent before running.
 *
 * Checks (in order):
 * 1. Hourly rate limit (spam / runaway protection)
 * 2. Daily token budget exhaustion
 * 3. No-reply address for sending agents
 */
export async function checkGuardrails(
	sql: SqlStorage,
	agentId: string,
	guardrails: AgentGuardrails,
	senderEmail: string,
	role: string,
): Promise<GuardrailResult> {
	// 1. Hourly rate
	const allowed = checkAndIncrementRate(sql, agentId, guardrails.maxEmailsPerHour);
	if (!allowed) {
		return {
			allowed: false,
			reason: `Rate limit: agent has processed ≥${guardrails.maxEmailsPerHour} emails this hour`,
		};
	}

	// 2. Daily token budget
	const dailyTokens = getDailyTokensUsed(sql, agentId);
	if (dailyTokens >= guardrails.dailyTokenBudget) {
		return {
			allowed: false,
			reason: `Token budget exhausted: ${dailyTokens}/${guardrails.dailyTokenBudget} tokens used today`,
		};
	}

	// 3. No-reply protection: responder / support / marketing must not reply to no-reply addresses
	const sendingRoles = ["responder", "support", "marketing", "scheduler"];
	if (sendingRoles.includes(role)) {
		const noreplyPrefixes = ["noreply", "no-reply", "mailer-daemon", "postmaster", "bounce", "donotreply"];
		const localPart = senderEmail.split("@")[0]?.toLowerCase() ?? "";
		if (noreplyPrefixes.some((p) => localPart.includes(p))) {
			return {
				allowed: false,
				reason: `Sender is a no-reply address — agent will not respond automatically`,
			};
		}
	}

	return { allowed: true };
}

/**
 * Estimate the cost of a run from token usage for a given model.
 */
export function estimateCost(tokensIn: number, tokensOut: number, costPer1MInput?: number, costPer1MOutput?: number): number {
	const inCost  = costPer1MInput  ? (tokensIn  / 1_000_000) * costPer1MInput  : 0;
	const outCost = costPer1MOutput ? (tokensOut / 1_000_000) * costPer1MOutput : 0;
	return inCost + outCost;
}
