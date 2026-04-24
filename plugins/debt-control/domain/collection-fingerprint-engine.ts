/**
 * Collection Algorithm Fingerprint Engine
 *
 * Analyses all DebtEvents for a given collector/creditor and builds a
 * probabilistic process fingerprint — without claiming knowledge of any
 * specific internal system. All language is observational:
 * "sannsynlig regelmønster", "observed process pattern", "basert på
 * historiske dokumenter i denne saken".
 */

import type {
	DebtCase,
	DebtEvent,
	DocumentKind,
	CollectionAlgorithmFingerprint,
	CollectorProfile,
	ObservedStage,
	FingerprintEvidence,
} from "../types";

// ── Constants ────────────────────────────────────────────────────────

/** Approximate known Norwegian collection fee steps (NOK) */
const KNOWN_FEE_STEPS = [218.75, 234.38, 437.5, 468.75, 875, 937.5];

const ROUND_FEE_TOLERANCE = 10; // ± 10 NOK to match a known step

// ── Helpers ──────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
	return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function matchesKnownFeeStep(amount: number): number | null {
	for (const step of KNOWN_FEE_STEPS) {
		if (Math.abs(amount - step) <= ROUND_FEE_TOLERANCE) return step;
	}
	return null;
}

function avg(nums: number[]): number {
	return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

// ── Fingerprint builder ──────────────────────────────────────────────

/**
 * Build a CollectionAlgorithmFingerprint by analysing all events from
 * multiple cases belonging to the same collector (identified by creditor name).
 *
 * @param collectorName  Display name of the collection agency / creditor
 * @param cases          All cases for this collector in the mailbox
 * @param eventsByCaseId Map of caseId → DebtEvent[]
 */
export function buildCollectionFingerprint(
	collectorName: string,
	cases: DebtCase[],
	eventsByCaseId: Map<string, DebtEvent[]>,
	creditorName?: string,
): CollectionAlgorithmFingerprint {
	const evidence: FingerprintEvidence[] = [];
	const stageMap = new Map<DocumentKind, { daysAfterPrev: number[]; deadlineDays: number[]; count: number }>();
	const allFees: number[] = [];
	const allInterestRates: number[] = [];
	const deadlineDays: number[] = [];
	const feeIncreaseIntervals: number[] = [];

	let consolidationDetected = false;
	let settlementOffersDetected = false;
	let manualReviewTriggeredByObjection = false;
	let paymentClosesCasePattern = false;
	let principalOnlySettlementObserved = false;

	for (const c of cases) {
		const events = (eventsByCaseId.get(c.id) ?? []).sort(
			(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
		);
		if (!events.length) continue;

		// ── Stage timing ──────────────────────────────────────────
		for (let i = 0; i < events.length; i++) {
			const ev = events[i];
			const kind = ev.kind;
			if (!stageMap.has(kind)) {
				stageMap.set(kind, { daysAfterPrev: [], deadlineDays: [], count: 0 });
			}
			const stage = stageMap.get(kind)!;
			stage.count++;

			if (i > 0) {
				const gap = daysBetween(events[i - 1].date, ev.date);
				if (gap >= 0 && gap < 365) stage.daysAfterPrev.push(gap);
			}

			if (ev.deadline) {
				const dl = daysBetween(ev.date, ev.deadline);
				if (dl > 0 && dl < 90) {
					stage.deadlineDays.push(dl);
					deadlineDays.push(dl);
				}
			}
		}

		// ── Fee steps ─────────────────────────────────────────────
		let firstFeeDate: string | null = null;
		let firstFeeAmt: number | null = null;
		for (const ev of events) {
			const fee = ev.amounts?.legalCosts ?? ev.amounts?.fee ?? null;
			if (fee && fee > 0) {
				const matched = matchesKnownFeeStep(fee);
				if (matched !== null && !allFees.includes(matched)) allFees.push(matched);

				if (!firstFeeDate) {
					firstFeeDate = ev.date;
					firstFeeAmt = fee;
				} else if (firstFeeAmt && fee > firstFeeAmt * 1.5) {
					// Fee roughly doubled
					const gap = daysBetween(firstFeeDate, ev.date);
					if (gap > 0 && gap < 365) {
						feeIncreaseIntervals.push(gap);
						evidence.push({
							caseId: c.id,
							eventId: ev.id,
							date: ev.date,
							observation: `Indikert salærøkning fra ${firstFeeAmt} kr til ${fee} kr etter ${gap} dager (observed process pattern)`,
						});
					}
					firstFeeDate = ev.date;
					firstFeeAmt = fee;
				}
			}

			// ── Interest rate ─────────────────────────────────────
			if (ev.amounts?.interest && ev.amounts?.principal && ev.amounts.principal > 0) {
				const rate = (ev.amounts.interest / ev.amounts.principal) * 100;
				if (rate > 0 && rate < 30) {
					const rounded = Math.round(rate * 10) / 10;
					if (!allInterestRates.includes(rounded)) allInterestRates.push(rounded);
				}
			}
		}

		// ── Signal flags ─────────────────────────────────────────
		if (c.mergedCaseNos?.length) {
			consolidationDetected = true;
			evidence.push({
				caseId: c.id,
				eventId: events[0]?.id ?? "",
				date: events[0]?.date ?? c.createdAt,
				observation: "Sammenslåing av fakturaer observert i denne saken (consolidation pattern)",
			});
		}

		if (c.settlementOfferAmount) {
			settlementOffersDetected = true;
			evidence.push({
				caseId: c.id,
				eventId: events[events.length - 1]?.id ?? "",
				date: c.lastSeenAt ?? c.updatedAt,
				observation: "Tilbud om redusert oppgjør observert (settlement discount pattern)",
			});
		}

		if (c.objectionDate) {
			const laterEvents = events.filter((e) => e.date > c.objectionDate!);
			const hasManual = laterEvents.some((e) =>
				["innsigelse_besvart", "redusert_oppgjoer", "betalingsbekreftelse"].includes(e.kind),
			);
			if (hasManual) {
				manualReviewTriggeredByObjection = true;
				evidence.push({
					caseId: c.id,
					eventId: laterEvents[0]?.id ?? "",
					date: laterEvents[0]?.date ?? c.objectionDate,
					observation: "Innsigelse ble etterfulgt av manuell behandling / redusert oppgjør (manual review pattern)",
				});
			}
		}

		const hasPaidConfirmed = events.some((e) =>
			["betalingsbekreftelse", "avslutningsbrev", "payment_confirmation"].includes(e.kind),
		);
		if (hasPaidConfirmed && c.status === "closed") {
			paymentClosesCasePattern = true;
		}

		if (c.status === "principal_only_settlement" || c.status === "principal_paid_fees_remain") {
			principalOnlySettlementObserved = true;
			evidence.push({
				caseId: c.id,
				eventId: events[events.length - 1]?.id ?? "",
				date: c.lastSeenAt ?? c.updatedAt,
				observation: "Kun-hovedstol-oppgjør observert (principal-only settlement pattern)",
			});
		}
	}

	// ── Build observedStages ──────────────────────────────────────
	const observedStages: ObservedStage[] = [];
	for (const [kind, data] of stageMap.entries()) {
		observedStages.push({
			kind,
			averageDaysAfterPrevious: data.daysAfterPrev.length ? Math.round(avg(data.daysAfterPrev)) : null,
			typicalDeadlineDays: data.deadlineDays.length ? Math.round(avg(data.deadlineDays)) : null,
			count: data.count,
		});
	}
	// Sort by total count desc
	observedStages.sort((a, b) => b.count - a.count);

	// ── Standard deadline (e.g. 14 days) ─────────────────────────
	let standardDeadlineDays: number | undefined;
	if (deadlineDays.length >= 3) {
		const roundedDeadlines = deadlineDays.map((d) => Math.round(d / 7) * 7);
		const counter = new Map<number, number>();
		for (const d of roundedDeadlines) counter.set(d, (counter.get(d) ?? 0) + 1);
		const dominant = [...counter.entries()].sort((a, b) => b[1] - a[1])[0];
		if (dominant && dominant[1] / deadlineDays.length >= 0.5) {
			standardDeadlineDays = dominant[0];
		}
	}

	// ── Fee increase timing ───────────────────────────────────────
	const feeIncreaseAfterDays = feeIncreaseIntervals.length
		? Math.round(avg(feeIncreaseIntervals))
		: undefined;

	// ── Confidence ───────────────────────────────────────────────
	const totalEvents = [...stageMap.values()].reduce((s, v) => s + v.count, 0);
	const confidence = Math.min(1, totalEvents / 20);  // 1.0 at ≥20 events

	return {
		collectorName,
		creditorName,
		observedStages,
		standardDeadlineDays,
		feeIncreaseAfterDays,
		knownFeeSteps: allFees.sort((a, b) => a - b),
		knownInterestRates: allInterestRates.sort((a, b) => a - b),
		consolidationDetected,
		settlementOffersDetected,
		manualReviewTriggeredByObjection,
		paymentClosesCasePattern,
		principalOnlySettlementObserved,
		confidence,
		evidence,
	};
}

/**
 * Returns a human-readable summary of the fingerprint for display in cards.
 */
export function describeFingerprintMatch(
	c: DebtCase,
	fingerprint: CollectionAlgorithmFingerprint,
): string {
	const parts: string[] = [];

	if (fingerprint.standardDeadlineDays) {
		parts.push(`${fingerprint.standardDeadlineDays}-dagers standard betalingsfrist`);
	}
	if (fingerprint.knownFeeSteps.length) {
		parts.push(`salærtrinn ${fingerprint.knownFeeSteps.join(" → ")} kr`);
	}
	if (fingerprint.feeIncreaseAfterDays) {
		parts.push(`salærøkning etter ~${fingerprint.feeIncreaseAfterDays} dager`);
	}
	if (fingerprint.consolidationDetected) {
		parts.push("sammenslåing av krav");
	}
	if (fingerprint.settlementOffersDetected) {
		parts.push("tilbud om redusert oppgjør");
	}

	if (!parts.length) return "";

	return (
		`Denne saken matcher tidligere observert ${fingerprint.collectorName}-mønster med ` +
		parts.join(", ") +
		`. (Basert på historiske dokumenter i denne saken — sannsynlig regelmønster, ikke bekreftet internt system.)`
	);
}

/**
 * Build a minimal CollectorProfile from observed fingerprints.
 * Actual org numbers / domains should be seeded separately.
 */
export function buildCollectorProfile(
	collectorName: string,
	fingerprints: CollectionAlgorithmFingerprint[],
): CollectorProfile {
	return {
		name: collectorName,
		orgNo: undefined,
		portalDomains: [],
		paymentAccountNumbers: [],
		knownEmailAddresses: [],
		observedFingerprints: fingerprints,
		strategyNotes: [],
	};
}
