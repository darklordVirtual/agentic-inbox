/**
 * Debt Control Phase 2 — Unit Tests
 *
 * Uses synthetic documents to simulate real Norwegian debt collection scenarios.
 * Tests cover: amount parser, classification, fingerprint engine, predictions,
 * tactical response, timeline insights, legality rules.
 */

import { describe, it, expect } from "vitest";
import { parseNorwegianAmount, extractAllAmounts } from "./domain/amount-parser";
import { buildCollectionFingerprint } from "./domain/collection-fingerprint-engine";
import { predictNextCollectionStep } from "./domain/next-step-predictor";
import { getTacticalResponse } from "./domain/tactical-response-engine";
import { buildDebtTimelineInsights } from "./domain/timeline-insights";
import { runFindingRules } from "./domain/legality-engine";
import type { DebtCase, DebtEvent, Finding, DebtAmountBreakdown } from "./types";

// ── Synthetic factories ──────────────────────────────────────────────

let _idCounter = 0;
function uid() { return `test-${++_idCounter}`; }

function makeAmounts(override: Partial<DebtAmountBreakdown> = {}): DebtAmountBreakdown {
	return {
		principal:   null,
		interest:    null,
		fee:         null,
		reminderFee: null,
		legalCosts:  null,
		paid:        null,
		outstanding: null,
		amountToPay: null,
		currency:    "NOK",
		...override,
	};
}

function makeCase(override: Partial<DebtCase> = {}): DebtCase {
	const now = new Date().toISOString();
	return {
		id:                            uid(),
		mailboxId:                    "mb1",
		creditor:                     "Fair Collection AS",
		reference:                    null,
		externalCaseNo:               "FC-2024-001",
		amountDue:                    675.75,
		currency:                     "NOK",
		dueDate:                      null,
		amounts:                      makeAmounts({ principal: 57, legalCosts: 218.75, amountToPay: 275.75 }),
		invoices:                     [],
		parentCaseNo:                 null,
		mergedCaseNos:                [],
		status:                       "collection_demand",
		priority:                     "investigate_first",
		firstEmailId:                 "email-1",
		lastEmailId:                  "email-1",
		firstSeenAt:                  now,
		lastSeenAt:                   now,
		objectionDate:                null,
		processingLimitationRequestedAt: null,
		closedAt:                     null,
		settlementOfferAmount:        null,
		settlementOfferDeadline:      null,
		createdAt:                    now,
		updatedAt:                    now,
		...override,
	};
}

function makeEvent(override: Partial<DebtEvent> = {}): DebtEvent {
	return {
		id:                   uid(),
		caseId:               "case-1",
		date:                 "2025-01-10",
		sourceEmailId:        "email-1",
		sourceAttachmentId:   null,
		sourceFileName:       null,
		kind:                 "betalingsoppfordring",
		creditor:             "Fair Collection AS",
		externalCaseNo:       "FC-2024-001",
		invoiceNos:           [],
		amounts:              makeAmounts(),
		deadline:             null,
		rawTextHash:          null,
		extractedTextPreview: null,
		createdAt:            new Date().toISOString(),
		...override,
	};
}

// ── Amount parser tests ──────────────────────────────────────────────

describe("parseNorwegianAmount", () => {
	it("parses space-separated thousands with comma decimal", () => {
		expect(parseNorwegianAmount("1 234,56")).toBe(1234.56);
	});

	it("parses dot-separated thousands with comma decimal", () => {
		expect(parseNorwegianAmount("1.234,56")).toBe(1234.56);
	});

	it("parses simple comma decimal", () => {
		expect(parseNorwegianAmount("437,50")).toBe(437.50);
	});

	it("parses dot decimal English style", () => {
		expect(parseNorwegianAmount("437.50 NOK")).toBe(437.50);
	});

	it("parses kr prefix", () => {
		expect(parseNorwegianAmount("kr 437,50")).toBe(437.50);
	});

	it("handles integer amounts", () => {
		expect(parseNorwegianAmount("1000")).toBe(1000);
	});

	it("returns null for non-numeric", () => {
		expect(parseNorwegianAmount("ingen beløp")).toBeNull();
	});
});

describe("extractAllAmounts", () => {
	it("extracts multiple amounts from text", () => {
		const amounts = extractAllAmounts("Kreditert 218,75 kr. Nytt beløp: 437,50 kr.");
		expect(amounts).toContain(218.75);
		expect(amounts).toContain(437.50);
	});
});

// ── Prediction tests ─────────────────────────────────────────────────

describe("predictNextCollectionStep", () => {
	it("predicts betalingsoppfordring after expired inkassovarsel deadline", () => {
		const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
		const c = makeCase({
			status:  "notice_received",
			dueDate: yesterday,
			amounts: makeAmounts({ principal: 57, legalCosts: 218.75 }),
		});
		const events = [makeEvent({ kind: "inkassovarsel", deadline: yesterday, caseId: c.id })];
		const pred = predictNextCollectionStep(c, events);
		expect(pred.predictedNextDocumentKind).toBe("betalingsoppfordring");
		expect(pred.riskLevel).toBe("high");
	});

	it("predicts no next step for closed case", () => {
		const c = makeCase({ status: "closed" });
		const pred = predictNextCollectionStep(c, []);
		expect(pred.riskLevel).toBe("low");
		expect(pred.predictedNextDocumentKind).toBeUndefined();
	});

	it("uses fingerprint stdDeadline in reasoning", () => {
		const c = makeCase({ status: "collection_demand", dueDate: null });
		const events = [makeEvent({ kind: "betalingsoppfordring", caseId: c.id, date: "2025-01-10" })];
		const fp = {
			collectorName: "Fair Collection AS",
			creditorName: undefined,
			observedStages: [],
			standardDeadlineDays: 14,
			feeIncreaseAfterDays: 14,
			knownFeeSteps: [218.75, 437.50],
			knownInterestRates: [],
			consolidationDetected: false,
			settlementOffersDetected: false,
			manualReviewTriggeredByObjection: false,
			paymentClosesCasePattern: false,
			principalOnlySettlementObserved: false,
			confidence: 0.6,
			evidence: [],
		};
		const pred = predictNextCollectionStep(c, events, fp);
		expect(pred.predictedNextDocumentKind).toBe("betalingspaaminnelse");
	});

	it("predicts sammenslaaing for long_term_monitoring", () => {
		const c = makeCase({ status: "long_term_monitoring" });
		const events = [makeEvent({ kind: "langtidsoppfoelging", caseId: c.id, date: "2025-01-10" })];
		const pred = predictNextCollectionStep(c, events);
		expect(pred.predictedNextDocumentKind).toBe("sammenslaaing");
	});
});

// ── Legality / finding rules tests ───────────────────────────────────

describe("runFindingRules", () => {
	it("HIGH_FEE_RATIO — critical when legalCosts ≥ 5× principal", () => {
		const c = makeCase({ amounts: makeAmounts({ principal: 57, legalCosts: 437.50, amountToPay: 494.50 }) });
		const findings = runFindingRules(c, [], []);
		expect(findings.some((f) => f.code === "HIGH_FEE_RATIO" && f.severity === "critical")).toBe(true);
	});

	it("HIGH_FEE_RATIO — warning when legalCosts between 2× and 5× principal", () => {
		const c = makeCase({ amounts: makeAmounts({ principal: 200, legalCosts: 437.50, amountToPay: 637.50 }) });
		const findings = runFindingRules(c, [], []);
		expect(findings.some((f) => f.code === "HIGH_FEE_RATIO" && f.severity === "warning")).toBe(true);
	});

	it("PRINCIPAL_PAID_FEES_REMAIN when paid≥principal but outstanding>0", () => {
		const c = makeCase({
			amounts: makeAmounts({ principal: 500, paid: 500, outstanding: 218.75, amountToPay: 218.75 }),
		});
		const findings = runFindingRules(c, [], []);
		expect(findings.some((f) => f.code === "PRINCIPAL_PAID_FEES_REMAIN")).toBe(true);
	});

	it("CASE_CONSOLIDATED when mergedCaseNos.length > 0", () => {
		const c = makeCase({ mergedCaseNos: ["FC-2024-002", "FC-2024-003", "FC-2024-004"] });
		const findings = runFindingRules(c, [], []);
		expect(findings.some((f) => f.code === "CASE_CONSOLIDATED")).toBe(true);
	});

	it("SETTLEMENT_OFFER_AVAILABLE when event contains settlement signal", () => {
		const events = [makeEvent({ kind: "redusert_oppgjoer", caseId: "c1" })];
		const c = makeCase({ id: "c1", status: "settlement_offer", settlementOfferAmount: 200 });
		const findings = runFindingRules(c, [], events);
		expect(findings.some((f) => f.code === "SETTLEMENT_OFFER_AVAILABLE")).toBe(true);
	});

	it("CLAIM_SPEC_SHOWS_ZERO_FEES when kravspesifikasjon has 0 legalCosts and later fees", () => {
		const caseId = uid();
		const events = [
			makeEvent({ caseId, kind: "kravspesifikasjon", date: "2025-01-01", amounts: makeAmounts({ legalCosts: 0 }) }),
			makeEvent({ caseId, kind: "betalingsoppfordring", date: "2025-02-01", amounts: makeAmounts({ legalCosts: 218.75 }) }),
		];
		const c = makeCase({ id: caseId });
		const findings = runFindingRules(c, [], events);
		expect(findings.some((f) => f.code === "CLAIM_SPEC_SHOWS_ZERO_FEES")).toBe(true);
	});

	it("COLLECTION_CONTINUED_AFTER_OBJECTION when demand arrives after objectionDate", () => {
		const caseId = uid();
		const objDate = "2025-01-15";
		const events = [
			makeEvent({ caseId, kind: "betalingsoppfordring", date: "2025-02-01" }),
		];
		const c = makeCase({ id: caseId, objectionDate: objDate });
		const findings = runFindingRules(c, [], events);
		expect(findings.some((f) => f.code === "COLLECTION_CONTINUED_AFTER_OBJECTION")).toBe(true);
	});

	it("PREDICTABLE_FEE_ESCALATION when fee doubled in events", () => {
		const caseId = uid();
		const events = [
			makeEvent({ caseId, kind: "betalingsoppfordring", date: "2025-01-01", amounts: makeAmounts({ legalCosts: 218.75 }) }),
			makeEvent({ caseId, kind: "restbeloep", date: "2025-02-01", amounts: makeAmounts({ legalCosts: 437.50 }) }),
		];
		const c = makeCase({ id: caseId });
		const findings = runFindingRules(c, [], events);
		expect(findings.some((f) => f.code === "PREDICTABLE_FEE_ESCALATION")).toBe(true);
	});
});

// ── Collection fingerprint tests ─────────────────────────────────────

describe("buildCollectionFingerprint", () => {
	it("detects 14-day standard deadline pattern", () => {
		const caseId = uid();
		const c = makeCase({ id: caseId });
		const events = [
			// inkassovarsel: date 2025-01-01, deadline 2025-01-15 (14 days)
			makeEvent({ caseId, kind: "inkassovarsel", date: "2025-01-01", deadline: "2025-01-15" }),
			// betalingsoppfordring: date 2025-01-18, deadline 2025-02-01 (14 days)
			makeEvent({ caseId, kind: "betalingsoppfordring", date: "2025-01-18", deadline: "2025-02-01" }),
			// restbeloep: date 2025-02-10, deadline 2025-02-24 (14 days)
			makeEvent({ caseId, kind: "restbeloep", date: "2025-02-10", deadline: "2025-02-24" }),
		];

		const fp = buildCollectionFingerprint(
			"Fair Collection AS",
			[c],
			new Map([[caseId, events]]),
		);

		expect(fp.standardDeadlineDays).toBe(14);
	});

	it("detects fee escalation from 218.75 to 437.50", () => {
		const caseId = uid();
		const c = makeCase({ id: caseId });
		const events = [
			makeEvent({ caseId, kind: "betalingsoppfordring", date: "2025-01-01", amounts: makeAmounts({ legalCosts: 218.75 }) }),
			makeEvent({ caseId, kind: "restbeloep", date: "2025-01-20", amounts: makeAmounts({ legalCosts: 437.50 }) }),
		];

		const fp = buildCollectionFingerprint(
			"Fair Collection AS",
			[c],
			new Map([[caseId, events]]),
		);

		expect(fp.feeIncreaseAfterDays).toBe(19);
		expect(fp.knownFeeSteps).toContain(218.75);
		expect(fp.knownFeeSteps).toContain(437.50);
	});

	it("detects consolidation", () => {
		const caseId = uid();
		const c = makeCase({ id: caseId, mergedCaseNos: ["FC-001", "FC-002", "FC-003"] });
		const events = [makeEvent({ caseId, kind: "sammenslaaing" })];
		const fp = buildCollectionFingerprint(
			"Fair Collection AS",
			[c],
			new Map([[caseId, events]]),
		);
		expect(fp.consolidationDetected).toBe(true);
	});

	it("detects principal-only settlement", () => {
		const caseId = uid();
		const c = makeCase({ id: caseId, status: "principal_paid_fees_remain" });
		const events = [makeEvent({ caseId, kind: "betalingsbekreftelse" })];
		const fp = buildCollectionFingerprint(
			"Fair Collection AS",
			[c],
			new Map([[caseId, events]]),
		);
		expect(fp.principalOnlySettlementObserved).toBe(true);
	});

	it("detects manual override after objection", () => {
		const caseId = uid();
		const objDate = "2025-01-20";
		const c = makeCase({ id: caseId, objectionDate: objDate });
		const events = [
			makeEvent({ caseId, kind: "innsigelse_besvart", date: "2025-02-01" }),
		];
		const fp = buildCollectionFingerprint(
			"Fair Collection AS",
			[c],
			new Map([[caseId, events]]),
		);
		expect(fp.manualReviewTriggeredByObjection).toBe(true);
	});
});

// ── Timeline insights tests ──────────────────────────────────────────

describe("buildDebtTimelineInsights", () => {
	it("generates insights for full lifecycle", () => {
		const caseId = uid();
		const c = makeCase({ id: caseId, objectionDate: "2025-03-01" });
		const events = [
			makeEvent({ caseId, kind: "inkassovarsel",        date: "2025-01-01", deadline: "2025-01-15", amounts: makeAmounts({ amountToPay: 275.75, legalCosts: 218.75 }) }),
			makeEvent({ caseId, kind: "betalingsoppfordring", date: "2025-01-18", deadline: "2025-02-01", amounts: makeAmounts({ legalCosts: 218.75 }) }),
			makeEvent({ caseId, kind: "restbeloep",           date: "2025-02-10", amounts: makeAmounts({ legalCosts: 437.50 }) }),
			makeEvent({ caseId, kind: "sammenslaaing",        date: "2025-02-20", amounts: makeAmounts({ amountToPay: 1200 }) }),
			makeEvent({ caseId, kind: "betalingsbekreftelse", date: "2025-03-15", amounts: makeAmounts({ paid: 57 }) }),
			makeEvent({ caseId, kind: "avslutningsbrev",      date: "2025-03-20" }),
		];

		const insights = buildDebtTimelineInsights(c, events);

		expect(insights.length).toBeGreaterThan(4);
		expect(insights.some((i) => i.label.includes("Inkassovarsel"))).toBe(true);
		expect(insights.some((i) => i.importance === "critical")).toBe(true);    // fee escalation
		expect(insights.some((i) => i.importance === "positive")).toBe(true);    // payment / closure
	});
});

// ── Tactical response tests ──────────────────────────────────────────

describe("getTacticalResponse", () => {
	it("avoid_fee_increase when FEE_INCREASE_IMMINENT finding present", () => {
		const c = makeCase();
		const findings: Finding[] = [{
			id: uid(), caseId: c.id,
			code: "FEE_INCREASE_IMMINENT",
			severity: "critical",
			description: "test",
			detectedAt: new Date().toISOString(),
		}];
		const resp = getTacticalResponse(c, findings);
		expect(resp.objective).toBe("avoid_fee_increase");
		expect(resp.urgency).toBe("critical");
	});

	it("settle_principal_only when HIGH_FEE_RATIO finding present", () => {
		const c = makeCase({ amounts: makeAmounts({ principal: 57, legalCosts: 437.50 }) });
		const findings: Finding[] = [{
			id: uid(), caseId: c.id,
			code: "HIGH_FEE_RATIO",
			severity: "critical",
			description: "test",
			detectedAt: new Date().toISOString(),
		}];
		const resp = getTacticalResponse(c, findings);
		expect(resp.objective).toBe("settle_principal_only");
		expect(resp.draftTemplateId).toBeTruthy();
	});

	it("stop_continued_collection when CONTINUED_AUTOMATION_AFTER_DISPUTE present", () => {
		const c = makeCase({ objectionDate: "2025-01-15" });
		const findings: Finding[] = [{
			id: uid(), caseId: c.id,
			code: "CONTINUED_AUTOMATION_AFTER_DISPUTE",
			severity: "warning",
			description: "test",
			detectedAt: new Date().toISOString(),
		}];
		const resp = getTacticalResponse(c, findings);
		expect(resp.objective).toBe("stop_continued_collection");
	});

	it("verify_closure for closed case", () => {
		const c = makeCase({ status: "closed" });
		const resp = getTacticalResponse(c, []);
		expect(resp.objective).toBe("verify_closure");
	});

	it("settle_principal_only when PRINCIPAL_PAID_FEES_REMAIN present", () => {
		const c = makeCase({ status: "principal_paid_fees_remain" });
		const resp = getTacticalResponse(c, []);
		expect(resp.objective).toBe("settle_principal_only");
	});
});
