/**
 * Recommended action engine.
 *
 * Given a DebtCase and its findings, produces a single recommended action
 * for the user to take next. All actions are defensive suggestions only —
 * no automatic sending or payment.
 */

import type { DebtCase, Finding, RecommendedAction, RecommendedActionKind } from "../types";

interface ScoredAction {
	kind: RecommendedActionKind;
	score: number;
	summary: string;
	rationale: string;
	urgency: RecommendedAction["urgency"];
}

export function getRecommendedAction(
	debtCase: DebtCase,
	findings: Finding[],
): RecommendedAction | null {
	const codes = new Set(findings.map((f) => f.code));
	const hasCritical = findings.some((f) => f.severity === "critical");
	const amounts     = debtCase.amounts;
	const principal   = amounts?.principal ?? null;
	const legalCosts  = amounts?.legalCosts ?? null;
	const paid        = amounts?.paid ?? null;
	const outstanding = amounts?.outstanding ?? debtCase.amountDue;

	const actions: ScoredAction[] = [];

	// ── MARK_CLOSED ───────────────────────────────────────────────
	if (codes.has("PAYMENT_CONFIRMED_CLOSED") || debtCase.status === "closed") {
		actions.push({
			kind: "MARK_CLOSED",
			score: 100,
			summary: "Merk saken som avsluttet",
			rationale: "Et dokument bekrefter at betalingen er mottatt og saken er avsluttet. " +
				"Arkiver dokumentasjonen som bevis på oppgjør.",
			urgency: "when_convenient",
		});
	}

	// ── VERIFY_PAYMENT ────────────────────────────────────────────
	if (codes.has("POSSIBLE_ALREADY_PAID") || codes.has("PRINCIPAL_PAID_FEES_REMAIN")) {
		actions.push({
			kind: "VERIFY_PAYMENT",
			score: 90,
			summary: "Kontroller betalingsstatus",
			rationale: "En betaling ser ut til å ha blitt registrert, men saken er ikke avsluttet. " +
				"Be om skriftlig bekreftelse på betalingsstatus og hva et evt. restbeløp gjelder.",
			urgency: "soon",
		});
	}

	// ── FILE_OBJECTION ────────────────────────────────────────────
	if (codes.has("COLLECTION_CONTINUED_AFTER_OBJECTION")) {
		actions.push({
			kind: "REQUEST_PROCESSING_LIMITATION",
			score: 85,
			summary: "Be om stans i behandling",
			rationale: "Krav ser ut til å ha fortsatt etter registrert innsigelse. " +
				"Vurder å sende formell begjæring om at saken settes i bero mens innsigelsen behandles.",
			urgency: "immediate",
		});
	}

	// ── OFFER_PRINCIPAL_AS_FINAL_SETTLEMENT ───────────────────────
	if (codes.has("ONLY_PRINCIPAL_RECOMMENDED") || codes.has("HIGH_FEE_RATIO") || codes.has("SETTLEMENT_OFFER_AVAILABLE")) {
		const offerAmt = debtCase.settlementOfferAmount ?? principal;
		actions.push({
			kind: "OFFER_PRINCIPAL_AS_FINAL_SETTLEMENT",
			score: 80,
			summary: "Tilby hovedstol som endelig oppgjør",
			rationale: `Salær/renter er uforholdsmessig høye relativt til kravet. ` +
				(offerAmt ? `Vurder å tilby kr ${offerAmt.toFixed(2)} som fullt og endelig oppgjør. ` : "") +
				"Be om skriftlig bekreftelse på at salær og renter frafalles.",
			urgency: hasCritical ? "soon" : "when_convenient",
		});
	}

	// ── FILE_OBJECTION on fees ────────────────────────────────────
	if (codes.has("CLAIM_SPEC_SHOWS_ZERO_FEES") || codes.has("DOUBLE_FEE_APPLIED")) {
		actions.push({
			kind: "FILE_OBJECTION",
			score: 78,
			summary: "Registrer innsigelse på salær",
			rationale: "Salærgrunnlaget ser ut til å inneholde avvik. " +
				"Vurder formell innsigelse med krav om full kravspesifikasjon og dokumentasjon.",
			urgency: hasCritical ? "immediate" : "soon",
		});
	}

	// ── REQUEST_DOCUMENTATION ─────────────────────────────────────
	if (codes.has("MISSING_LEGAL_BASIS") || codes.has("MISSING_ORIGINAL_INVOICE") || codes.has("MISSING_SENDER_IDENTITY")) {
		actions.push({
			kind: "REQUEST_DOCUMENTATION",
			score: 70,
			summary: "Be om dokumentasjon",
			rationale: "Grunnleggende dokumentasjon (opprinnelig faktura, kravspesifikasjon, avsenderidentitet) " +
				"mangler i saken. Be om disse før du tar videre stilling.",
			urgency: "soon",
		});
	}

	// ── PAY_PRINCIPAL_BEFORE_FEES (notice received, no objection) ─
	if (
		(debtCase.status === "notice_received" || debtCase.status === "inkassovarsel" as string) &&
		!debtCase.objectionDate &&
		!codes.has("MISSING_LEGAL_BASIS") &&
		!codes.has("HIGH_FEE_RATIO")
	) {
		actions.push({
			kind: "PAY_PRINCIPAL_BEFORE_FEES",
			score: 60,
			summary: "Betal hovedstol/krav innen fristen",
			rationale: "Inkassovarsel er mottatt. Dersom kravet er korrekt, betal innen betalingsfristen " +
				"for å unngå ytterligere salær og renter. Registrer innsigelse nå dersom kravet bestrides.",
			urgency: codes.has("DEADLINE_SOON") ? "immediate" : "soon",
		});
	}

	// ── CASE_CONSOLIDATED ─────────────────────────────────────────
	if (codes.has("CASE_CONSOLIDATED")) {
		actions.push({
			kind: "HUMAN_REVIEW",
			score: 55,
			summary: "Kontroller sammenslåtte fakturaer",
			rationale: "Saken er sammenslått med andre saker. " +
				"Kontroller at alle fakturaer er korrekte og at betalinger er kreditert riktig krav.",
			urgency: "soon",
		});
	}

	// ── EXPORT_EVIDENCE_PACK ──────────────────────────────────────
	if (codes.has("LEGAL_ESCALATION_LANGUAGE") || codes.has("LEGAL_ESCALATION_LANGUAGE")) {
		actions.push({
			kind: "EXPORT_EVIDENCE_PACK",
			score: 50,
			summary: "Eksporter bevissammenstilling",
			rationale: "Rettslig eskalering er varslet. Eksporter timeline, beløpsoversikt og " +
				"alle relevante dokumenter som forberedelse.",
			urgency: "immediate",
		});
	}

	// ── HUMAN_REVIEW fallback ─────────────────────────────────────
	if (actions.length === 0 || codes.has("HUMAN_REVIEW_RECOMMENDED")) {
		actions.push({
			kind: "HUMAN_REVIEW",
			score: 20,
			summary: "Manuell gjennomgang anbefalt",
			rationale: "Saken inneholder punkter som bør vurderes manuelt.",
			urgency: "when_convenient",
		});
	}

	// Return highest-scored action
	actions.sort((a, b) => b.score - a.score);
	const best = actions[0]!;
	return { kind: best.kind, summary: best.summary, rationale: best.rationale, urgency: best.urgency };
}
