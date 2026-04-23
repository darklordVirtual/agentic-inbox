/**
 * Prioritization engine — deterministic rules, no AI required.
 *
 * Computes a CasePriority from observable case attributes.
 */

import type { CasePriority, DocumentKind } from "../types";

interface PrioritizationInput {
	kind: DocumentKind;
	amountDue: number | null;
	dueDate: string | null;
}

const KIND_BASE_SCORE: Record<DocumentKind, number> = {
	court_letter:         100,
	legal_notice:          90,
	collection_demand:     70,
	collection_notice:     50,
	reminder:              30,
	initial_demand:        20,
	debt_settlement:       10,
	payment_confirmation:   0,
	unknown:               15,
};

function daysUntilDue(dueDate: string): number {
	const due = new Date(dueDate).getTime();
	const now = Date.now();
	return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
}

export function scoreCase(input: PrioritizationInput): number {
	let score = KIND_BASE_SCORE[input.kind] ?? 15;

	// Penalty for imminent due date
	if (input.dueDate) {
		const days = daysUntilDue(input.dueDate);
		if (days < 0)   score += 40;   // Overdue
		else if (days <= 3)  score += 30;
		else if (days <= 7)  score += 20;
		else if (days <= 14) score += 10;
	}

	// Moderate weight for significant amounts
	if (input.amountDue !== null) {
		if (input.amountDue >= 50_000) score += 20;
		else if (input.amountDue >= 10_000) score += 10;
		else if (input.amountDue >= 1_000)  score += 5;
	}

	return score;
}

export function determinePriority(input: PrioritizationInput): CasePriority {
	if (input.kind === "payment_confirmation") return "already_paid_possible";

	const score = scoreCase(input);

	if (score >= 90)  return "pay_now";
	if (score >= 60)  return "object_now";
	if (score >= 30)  return "investigate_first";
	if (score >= 10)  return "waiting_response";
	return "low";
}
