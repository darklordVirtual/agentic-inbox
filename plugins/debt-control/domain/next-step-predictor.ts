/**
 * Next Collection Step Predictor
 *
 * Predicts the next likely action in a Norwegian debt collection process
 * based on observed document sequence, timing, and optional fingerprint.
 *
 * Language is explicitly probabilistic: "predikert neste steg",
 * "basert på historiske dokumenter", "indikert eskaleringslogikk".
 */

import type {
	DebtCase,
	DebtEvent,
	DocumentKind,
	CaseStatus,
	RecommendedAction,
	NextCollectionStepPrediction,
	CollectionAlgorithmFingerprint,
} from "../types";

// ── Helpers ──────────────────────────────────────────────────────────

function daysAgo(dateStr: string): number {
	return Math.round((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function daysUntil(dateStr: string): number {
	return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function addDays(dateStr: string, days: number): string {
	const d = new Date(dateStr);
	d.setDate(d.getDate() + days);
	return d.toISOString().slice(0, 10);
}

// ── Main prediction function ─────────────────────────────────────────

/**
 * Predict the most likely next step in the debt collection process
 * for this case, given the observed event sequence and an optional
 * collector fingerprint.
 */
export function predictNextCollectionStep(
	debtCase: DebtCase,
	events: DebtEvent[],
	fingerprint?: CollectionAlgorithmFingerprint,
): NextCollectionStepPrediction {
	const sortedEvents = [...events].sort(
		(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
	);

	const lastEvent   = sortedEvents.at(-1);
	const lastKind    = lastEvent?.kind ?? "unknown";
	const status      = debtCase.status;
	const amounts     = debtCase.amounts;
	const principal   = amounts?.principal ?? null;
	const legalCosts  = amounts?.legalCosts ?? null;
	const paid        = amounts?.paid ?? null;
	const dueDate     = debtCase.dueDate ?? lastEvent?.deadline ?? null;
	const lastDate    = lastEvent?.date ?? debtCase.lastSeenAt ?? debtCase.createdAt;

	const deadlineInDays         = dueDate ? daysUntil(dueDate) : null;
	const daysSinceLast          = daysAgo(lastDate);
	const stdDeadline            = fingerprint?.standardDeadlineDays ?? 14;
	const feeIncreaseAfterDays   = fingerprint?.feeIncreaseAfterDays ?? 14;

	const reasoning: string[] = [];
	let predictedNextStatus: CaseStatus                   = status;
	let predictedNextDocumentKind: DocumentKind | undefined;
	let estimatedDate: string | undefined;
	let riskLevel: NextCollectionStepPrediction["riskLevel"] = "low";
	let costRiskAmount: number | undefined;
	let recommendedPreventiveAction: RecommendedAction | undefined;

	// ── Terminal states: no next step expected ────────────────────
	if (["closed", "paid"].includes(status)) {
		reasoning.push("Saken er lukket eller betalt. Ingen ytterligere steg forventes.");
		return {
			predictedNextStatus: status,
			predictedNextDocumentKind: undefined,
			estimatedDate: undefined,
			riskLevel: "low",
			costRiskAmount: undefined,
			reasoning,
			recommendedPreventiveAction: undefined,
		};
	}

	// ── Objection: monitor for continued collection ───────────────
	if (status === "objection_registered" || status === "disputed") {
		reasoning.push("Innsigelse er registrert. Basert på observert mønster kan saken gå til manuell behandling eller redusert oppgjør.");
		predictedNextDocumentKind = "innsigelse_besvart";
		estimatedDate = addDays(lastDate, 14);
		riskLevel = "medium";

		const continuedCollection = sortedEvents.some(
			(e) => e.date > (debtCase.objectionDate ?? "") &&
				["betalingsoppfordring", "betalingspaaminnelse", "restbeloep"].includes(e.kind),
		);
		if (continuedCollection) {
			reasoning.push("Indikert eskaleringslogikk: inkassoaktivitet etter innsigelse — predikert continued automation pattern.");
			riskLevel = "high";
			recommendedPreventiveAction = {
				kind:      "FILE_OBJECTION",
				summary:   "Send ny innsigelse med referanse til forrige innsigelse",
				rationale: "Basert på historiske dokumenter ser det ut til at inkassoprosessen ikke stoppet etter innsigelse",
				urgency:   "immediate",
			};
		}

		return buildResult({
			predictedNextStatus, predictedNextDocumentKind, estimatedDate,
			riskLevel, costRiskAmount, reasoning, recommendedPreventiveAction,
		});
	}

	// ── Processing limitation requested ──────────────────────────
	if (status === "processing_limitation_requested") {
		reasoning.push("Stansbegjæring er sendt. Avventer svar fra inkassoselskapet.");
		predictedNextDocumentKind = "innsigelse_besvart";
		estimatedDate = addDays(lastDate, 21);
		riskLevel = "low";
		return buildResult({ predictedNextStatus, predictedNextDocumentKind, estimatedDate, riskLevel, costRiskAmount, reasoning, recommendedPreventiveAction });
	}

	// ── Settlement offer ──────────────────────────────────────────
	if (status === "settlement_offer") {
		reasoning.push("Tilbud om redusert oppgjør foreligger. Akseptér eller forhandel innen fristen.");
		predictedNextDocumentKind = dueDate && deadlineInDays !== null && deadlineInDays < 5 ? "avslutningsbrev" : "redusert_oppgjoer";
		if (dueDate && deadlineInDays !== null && deadlineInDays < 0) {
			reasoning.push("Tilbudsfristen kan ha utløpt. Avklar status.");
			riskLevel = "high";
		}
		return buildResult({ predictedNextStatus, predictedNextDocumentKind, estimatedDate, riskLevel, costRiskAmount, reasoning, recommendedPreventiveAction });
	}

	// ── inkassovarsel (first notice) ──────────────────────────────
	if (["inkassovarsel", "collection_notice", "initial_demand", "notice_received"].includes(lastKind)) {
		if (deadlineInDays !== null && deadlineInDays <= 0) {
			reasoning.push(`Betalingsfristen er passert (${Math.abs(deadlineInDays)} dager siden). Predikert neste steg: betalingsoppfordring.`);
			predictedNextDocumentKind = "betalingsoppfordring";
			predictedNextStatus       = "collection_demand";
			estimatedDate             = addDays(lastDate, 3);
			riskLevel                 = "high";
			if (legalCosts && legalCosts > 0) {
				costRiskAmount = legalCosts;
				reasoning.push(`Salær på ${legalCosts} kr kan allerede påløpe.`);
			}
		} else if (deadlineInDays !== null && deadlineInDays <= 7) {
			reasoning.push(`Betalingsfrist nærmer seg (${deadlineInDays} dager). Etter frist ventes betalingsoppfordring.`);
			predictedNextDocumentKind = "betalingsoppfordring";
			predictedNextStatus       = "collection_demand";
			estimatedDate             = dueDate!;
			riskLevel                 = "medium";
		} else {
			reasoning.push(`Siste dokument: inkassovarsel. Betalingsfrist ${dueDate ?? "ukjent"}. Basert på observert mønster ventes betalingsoppfordring snart.`);
			predictedNextDocumentKind = "betalingsoppfordring";
			predictedNextStatus       = "collection_demand";
			estimatedDate             = dueDate ? addDays(dueDate, 3) : addDays(lastDate, stdDeadline + 5);
		}

		recommendedPreventiveAction = {
			kind:    "PAY_PRINCIPAL_BEFORE_FEES",
			summary: "Betal eller bestrid krav nå for å unngå salærpåføring",
			rationale: "Betalingsoppfordring vil sannsynligvis medføre salær",
			urgency: deadlineInDays !== null && deadlineInDays <= 3 ? "immediate" : "soon",
		};
	}

	// ── betalingsoppfordring (collection demand) ──────────────────
	else if (["betalingsoppfordring", "collection_demand"].includes(lastKind)) {
		if (dueDate && deadlineInDays !== null && deadlineInDays <= 0) {
			const daysOver = Math.abs(deadlineInDays);
			reasoning.push(`Betalingsoppfordring. Frist passert for ${daysOver} dager siden.`);

			if (daysOver > feeIncreaseAfterDays) {
				reasoning.push(`Basert på observert mønster: salærøkning forventes (etter ca. ${feeIncreaseAfterDays} dager).`);
				predictedNextDocumentKind = "restbeloep";
				predictedNextStatus       = "fee_increase_warning";
				riskLevel                 = "critical";
				if (legalCosts && legalCosts > 0) {
					costRiskAmount = legalCosts * 2;
					reasoning.push(`Predikert salær etter økning: ~${costRiskAmount} kr (indikert eskaleringslogikk).`);
				}
			} else {
				reasoning.push(`Sannsynlig neste steg: betalingspåminnelse eller salærøkning innen ${feeIncreaseAfterDays - daysOver} dager.`);
				predictedNextDocumentKind = "betalingspaaminnelse";
				predictedNextStatus       = "reminder";
				riskLevel                 = "high";
				estimatedDate             = addDays(lastDate, feeIncreaseAfterDays - daysOver);
				if (legalCosts && legalCosts > 0) {
					costRiskAmount = legalCosts;
				}
			}
		} else {
			reasoning.push("Betalingsoppfordring mottatt. Predikert neste steg: betalingspåminnelse hvis frist passeres.");
			predictedNextDocumentKind = "betalingspaaminnelse";
			predictedNextStatus       = "reminder";
			estimatedDate             = dueDate ? addDays(dueDate, 7) : addDays(lastDate, stdDeadline + 7);
			riskLevel                 = "medium";
		}

		recommendedPreventiveAction = {
			kind: "OFFER_PRINCIPAL_AS_FINAL_SETTLEMENT",
			summary: "Tilby betaling av dokumentert hovedstol for å unngå videre kostnader",
			rationale: "Salærøkning er predikert basert på observert regelmønster",
			urgency: riskLevel === "critical" ? "immediate" : "soon",
		};
	}

	// ── Reminder / restbeløp ──────────────────────────────────────
	else if (["betalingspaaminnelse", "reminder", "restbeloep", "fee_increase_warning"].includes(lastKind)) {
		reasoning.push("Påminnelse eller restbeløp mottatt. Sannsynlig neste steg: salærøkning eller langtidsovervåkning.");
		predictedNextDocumentKind = "langtidsoppfoelging";
		predictedNextStatus       = "long_term_monitoring";
		riskLevel                 = "high";
		estimatedDate             = addDays(lastDate, 30);
		if (legalCosts && legalCosts > 0) {
			costRiskAmount = legalCosts * 2;
			reasoning.push(`Predikert akkumulert salær: ~${costRiskAmount} kr.`);
		}
	}

	// ── Long-term monitoring ──────────────────────────────────────
	else if (["langtidsoppfoelging", "long_term_monitoring"].includes(lastKind)) {
		reasoning.push("Saken er i langtidsovervåkning. Indikert eskaleringslogikk: rettslig pågang eller sammenslåing.");
		predictedNextDocumentKind = "sammenslaaing";
		predictedNextStatus       = "consolidated";
		riskLevel                 = "medium";
		estimatedDate             = addDays(lastDate, 60);
	}

	// ── Multiple small claims from same creditor? ─────────────────
	// (Checked by caller, merged into reasoning if provided externally)

	// ── principal paid, fees remain ──────────────────────────────
	if (status === "principal_paid_fees_remain") {
		reasoning.push("Hovedstol er betalt. Predikert neste steg: krav om salær/renter eller avslutningsbrev ved frafall.");
		predictedNextDocumentKind = debtCase.settlementOfferAmount ? "avslutningsbrev" : "betalingspaaminnelse";
		predictedNextStatus       = "closed";
		riskLevel                 = "low";
		estimatedDate             = addDays(lastDate, 14);
	}

	return buildResult({
		predictedNextStatus,
		predictedNextDocumentKind,
		estimatedDate,
		riskLevel,
		costRiskAmount,
		reasoning,
		recommendedPreventiveAction,
	});
}

// ── Utility ──────────────────────────────────────────────────────────

function buildResult(p: {
	predictedNextStatus: CaseStatus;
	predictedNextDocumentKind: DocumentKind | undefined;
	estimatedDate: string | undefined;
	riskLevel: NextCollectionStepPrediction["riskLevel"];
	costRiskAmount: number | undefined;
	reasoning: string[];
	recommendedPreventiveAction: RecommendedAction | undefined;
}): NextCollectionStepPrediction {
	return {
		predictedNextStatus:            p.predictedNextStatus,
		predictedNextDocumentKind:      p.predictedNextDocumentKind,
		estimatedDate:                  p.estimatedDate,
		riskLevel:                      p.riskLevel,
		costRiskAmount:                 p.costRiskAmount,
		reasoning:                      p.reasoning,
		recommendedPreventiveAction:    p.recommendedPreventiveAction,
	};
}
