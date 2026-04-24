/**
 * Prioritization engine — deterministic rules, no AI required.
 *
 * Computes a CasePriority from observable case attributes.
 */

import type { CasePriority, DocumentKind, DebtAmountBreakdown } from "../types";

interface PrioritizationInput {
	kind: DocumentKind;
	amountDue: number | null;
	dueDate: string | null;
	amounts?: DebtAmountBreakdown | null;
	hasObjection?: boolean;
	hasLegalEscalation?: boolean;
	isFeeIncreaseWarning?: boolean;
	isPrincipalPaidFeesRemain?: boolean;
}

const KIND_BASE_SCORE: Record<DocumentKind, number> = {
	court_letter:              100,
	legal_notice:               90,
	collection_demand:          70,
	betalingsoppfordring:       70,
	collection_notice:          50,
	inkassovarsel:              50,
	betalingspaaminnelse:       35,
	reminder:                   30,
	restbeloep:                 40,
	redusert_oppgjoer:          45,
	avslutningsbrev:             0,
	betalingsbekreftelse:        0,
	payment_confirmation:        0,
	initial_demand:             20,
	sammenslaaing:              35,
	innsigelse_besvart:         30,
	kravspesifikasjon:          25,
	informasjon_om_krav:        10,
	langtidsoppfoelging:        15,
	ticket_timeline:             5,
	debt_settlement:            10,
	unknown:                    15,
};

function daysUntilDue(dueDate: string): number {
	const due = new Date(dueDate).getTime();
	const now = Date.now();
	return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
}

export function scoreCase(input: PrioritizationInput): number {
	let score = KIND_BASE_SCORE[input.kind] ?? 15;

	// Imminent / overdue deadline
	if (input.dueDate) {
		const days = daysUntilDue(input.dueDate);
		if (days < 0)        score += 40;
		else if (days <= 3)  score += 30;
		else if (days <= 7)  score += 20;
		else if (days <= 14) score += 10;
	}

	// Amount weight
	if (input.amountDue !== null) {
		if (input.amountDue >= 50_000) score += 20;
		else if (input.amountDue >= 10_000) score += 10;
		else if (input.amountDue >= 1_000)  score += 5;
	}

	// High fee ratio
	const principal  = input.amounts?.principal ?? null;
	const legalCosts = input.amounts?.legalCosts ?? null;
	if (principal && principal > 0 && legalCosts && legalCosts > 0) {
		const ratio = legalCosts / principal;
		if (ratio >= 2) score += 15;
	}

	// Special conditions
	if (input.isFeeIncreaseWarning)     score += 25;
	if (input.hasLegalEscalation)       score += 30;
	if (input.isPrincipalPaidFeesRemain) score += 20;
	if (input.hasObjection)             score += 10; // needs attention

	return score;
}

export function determinePriority(input: PrioritizationInput): CasePriority {
	const closedKinds: DocumentKind[] = ["payment_confirmation", "betalingsbekreftelse", "avslutningsbrev"];
	if (closedKinds.includes(input.kind)) return "already_paid_possible";

	const score = scoreCase(input);

	if (score >= 90)  return "pay_now";
	if (score >= 60)  return "object_now";
	if (score >= 35)  return "investigate_first";
	if (score >= 15)  return "waiting_response";
	return "low";
}
