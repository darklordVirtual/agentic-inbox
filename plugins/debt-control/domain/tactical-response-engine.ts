/**
 * Tactical Response Engine
 *
 * Given a case, its findings, and the predicted next step, selects the
 * optimal tactical response for the debtor.
 *
 * All output is advisory — no automatic actions.
 * Language is cautious and non-conclusive.
 */

import type {
	DebtCase,
	Finding,
	RecommendedAction,
	TacticalResponse,
	TacticalObjective,
	NextCollectionStepPrediction,
	LetterKind,
} from "../types";

// ── Helpers ──────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null | undefined): number | null {
	if (!dateStr) return null;
	return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function hasFinding(findings: Finding[], code: string): boolean {
	return findings.some((f) => f.code === code);
}

// ── Main ─────────────────────────────────────────────────────────────

/**
 * Select the best tactical response based on the full case context.
 */
export function getTacticalResponse(
	debtCase: DebtCase,
	findings: Finding[],
	prediction?: NextCollectionStepPrediction,
): TacticalResponse {
	const amounts   = debtCase.amounts;
	const principal = amounts?.principal ?? null;
	const legalCosts = amounts?.legalCosts ?? null;
	const paid       = amounts?.paid ?? null;
	const dueDate    = debtCase.dueDate;
	const deadlineDays = daysUntil(dueDate);

	// ── 1. Verify closure ─────────────────────────────────────────
	if (debtCase.status === "closed" || debtCase.status === "paid") {
		return build({
			objective:        "verify_closure",
			urgency:          "low",
			summary:          "Saken ser ut til å være avsluttet. Bekreft at ingen ytterligere krav foreligger.",
			actionKind:       "VERIFY_PAYMENT",
			actionSummary:    "Hent betalingsbekreftelse og arkivér",
			actionRationale:  "Avsluttede saker bør bekreftes skriftlig",
			actionUrgency:    "when_convenient",
			draftTemplateId:  undefined,
			checklist: [
				"Bekreft at kravet er merket betalt/avsluttet i inkassoselskapets system",
				"Lagre kvittering/avslutningsbrev",
				"Sjekk at ingen nye krav med samme saksnummer dukker opp",
			],
		});
	}

	// ── 2. Fee increase imminent ──────────────────────────────────
	const feeIncreaseImminent =
		hasFinding(findings, "FEE_INCREASE_IMMINENT") ||
		hasFinding(findings, "NEXT_FEE_INCREASE_PREDICTED") ||
		prediction?.predictedNextDocumentKind === "restbeloep" ||
		(deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 7);

	if (feeIncreaseImminent) {
		const urgency =
			hasFinding(findings, "FEE_INCREASE_IMMINENT") ||
			(deadlineDays !== null && deadlineDays <= 2)
				? "critical"
				: "high";
		return build({
			objective:        "avoid_fee_increase",
			urgency,
			summary:          `Frist nærmer seg${deadlineDays !== null ? ` (${deadlineDays} dager)` : ""}. ` +
				"Betal hovedstol eller registrer innsigelse nå for å unngå salærøkning.",
			actionKind:       principal ? "PAY_PRINCIPAL_BEFORE_FEES" : "FILE_OBJECTION",
			actionSummary:    "Betal eller bestrid krav umiddelbart",
			actionRationale:  "Salærøkning er predikert innen kort tid basert på observert eskaleringsmønster",
			actionUrgency:    "immediate",
			draftTemplateId:  "prevent_fee_increase",
			checklist: [
				"Kontroller at kravet er korrekt og at fakturaene er reelle",
				"Betal bekreftet korrekt hovedstol for å stanse videre kostnadsakkumulering",
				"Alternativt: send forebyggende innsigelse dersom kravet er tvilsomt",
				"Lagre betalingsbevis / innsigelsesdokument",
			],
		});
	}

	// ── 3. Continued collection after objection ───────────────────
	const continuedAfterObjection =
		hasFinding(findings, "COLLECTION_CONTINUED_AFTER_OBJECTION") ||
		hasFinding(findings, "CONTINUED_AUTOMATION_AFTER_DISPUTE");

	if (continuedAfterObjection || (debtCase.objectionDate && !["closed", "paid"].includes(debtCase.status))) {
		return build({
			objective:       "stop_continued_collection",
			urgency:         "high",
			summary:         "Det ser ut som inkassoprosessen fortsatte etter at innsigelse ble registrert. " +
				"Be om status, stans og forklaring skriftlig.",
			actionKind:      "FILE_OBJECTION",
			actionSummary:   "Send ny innsigelse med referanse til forrige, be om skriftlig redegjørelse",
			actionRationale: "Basert på historiske dokumenter: krav etter innsigelse observert (indikert automated process pattern)",
			actionUrgency:   "immediate",
			draftTemplateId: "objection_after_continued_collection",
			checklist: [
				"Finn dato for første innsigelse og dokumentér den",
				"Identifisér hvilke krav/påminnelser som kom etter innsigelsen",
				"Send brev som ber om status, stans og redegjørelse",
				"Vurder klage til Finansklagenemnda ved manglende svar",
			],
		});
	}

	// ── 4. Fee-dominated claim: settle principal only ─────────────
	const feeRatioHigh =
		hasFinding(findings, "HIGH_FEE_RATIO") ||
		hasFinding(findings, "LOW_PRINCIPAL_HIGH_COLLECTION_COST");

	if (feeRatioHigh || (principal && legalCosts && legalCosts / principal >= 2)) {
		return build({
			objective:       "settle_principal_only",
			urgency:         "medium",
			summary:         "Salær dominerer kravet. Vurder tilbud om betaling av dokumentert hovedstol som fullt og endelig oppgjør.",
			actionKind:      "OFFER_PRINCIPAL_AS_FINAL_SETTLEMENT",
			actionSummary:   `Tilby betaling av kr ${principal ?? "?"} som endelig oppgjør`,
			actionRationale:
				`Salær (${legalCosts ?? "?"} kr) utgjør stor andel av totalkravet. ` +
				"Basert på observert mønster har inkassoselskaper akseptert kun-hovedstol-oppgjør i lignende saker.",
			actionUrgency:   "soon",
			draftTemplateId: "principal_only_settlement_process_economy",
			checklist: [
				"Beregn bekreftet dokumentert hovedstol (ikke renter/salær)",
				"Send skriftlig tilbud med eksplisitt forbehold om at salær bestrides",
				"Be om skriftlig aksept før betaling sendes",
				"Lagre all korrespondanse",
			],
		});
	}

	// ── 5. Missing documentation ──────────────────────────────────
	if (hasFinding(findings, "MISSING_ORIGINAL_INVOICE")) {
		return build({
			objective:       "request_documentation",
			urgency:         "medium",
			summary:         "Mangler original faktura. Be om komplett kravspesifikasjon og originalgrunnlag.",
			actionKind:      "REQUEST_DOCUMENTATION",
			actionSummary:   "Send formell forespørsel om kravspesifikasjon",
			actionRationale: "Krav bør dokumenteres med originalfaktura og beregningsgrunnlag",
			actionUrgency:   "soon",
			draftTemplateId: "payment_status_request",
			checklist: [
				"Be om originalfaktura og forfallsdato",
				"Be om detaljert kravspesifikasjon (hovedstol, renter, salærberegning)",
				"Kontroller at kreditor og inkassoselskap er korrekte",
			],
		});
	}

	// ── 6. Principal paid, fees remain ───────────────────────────
	if (
		debtCase.status === "principal_paid_fees_remain" ||
		hasFinding(findings, "PRINCIPAL_PAID_FEES_REMAIN")
	) {
		return build({
			objective:       "settle_principal_only",
			urgency:         "medium",
			summary:         "Hovedstol er betalt. Vurder om resterende beløp (salær/renter) kan bestrides eller frafalles.",
			actionKind:      "OFFER_PRINCIPAL_AS_FINAL_SETTLEMENT",
			actionSummary:   "Be om frafall av resterende salær ettersom hovedstol er betalt",
			actionRationale: "Basert på observert mønster: betaling av hovedstol har ført til saksavslutning i lignende saker",
			actionUrgency:   "soon",
			draftTemplateId: "principal_only_settlement_process_economy",
			checklist: [
				"Bekreft at betalt beløp dekker dokumentert hovedstol",
				"Send brev og be om bekreftelse på at resterende salær frafalles",
				"Lagre betalingsbevis",
			],
		});
	}

	// ── 7. Human review ───────────────────────────────────────────
	if (hasFinding(findings, "HUMAN_REVIEW_RECOMMENDED")) {
		return build({
			objective:       "human_review",
			urgency:         "medium",
			summary:         "Saken er kompleks og bør vurderes manuelt. Se gjennom alle dokumenter og funn.",
			actionKind:      "HUMAN_REVIEW",
			actionSummary:   "Gjennomgå saken manuelt",
			actionRationale: "Automatisk analyse indikerer at saken trenger manuell oppfølging",
			actionUrgency:   "soon",
			draftTemplateId: undefined,
			checklist: [
				"Les alle dokumenter i saken",
				"Vurder alle funn",
				"Konsulter fagperson ved behov",
			],
		});
	}

	// ── 8. Default: monitor and prepare complaint ─────────────────
	return build({
		objective:       "prepare_complaint",
		urgency:         "low",
		summary:         "Ingen kritisk handling påkrevet akkurat nå. Behold dokumentasjon og overvåk videre utvikling.",
		actionKind:      "EXPORT_EVIDENCE_PACK",
		actionSummary:   "Eksportér dokumentasjonsgrunnlag",
		actionRationale: "Bevissikring for eventuelle fremtidige klager",
		actionUrgency:   "when_convenient",
		draftTemplateId: undefined,
		checklist: [
			"Eksportér evidence pack",
			"Lagre alle brev og kvitteringer",
			"Overvåk for nye krav",
		],
	});
}

// ── Builder helper ───────────────────────────────────────────────────

function build(p: {
	objective: TacticalObjective;
	urgency: TacticalResponse["urgency"];
	summary: string;
	actionKind: RecommendedAction["kind"];
	actionSummary: string;
	actionRationale: string;
	actionUrgency: RecommendedAction["urgency"];
	draftTemplateId: LetterKind | undefined;
	checklist: string[];
}): TacticalResponse {
	return {
		objective: p.objective,
		urgency:   p.urgency,
		summary:   p.summary,
		recommendedAction: {
			kind:    p.actionKind,
			summary: p.actionSummary,
			rationale: p.actionRationale,
			urgency: p.actionUrgency,
		},
		draftTemplateId: p.draftTemplateId,
		checklist: p.checklist,
	};
}
