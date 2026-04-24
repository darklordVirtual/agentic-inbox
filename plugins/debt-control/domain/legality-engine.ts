/**
 * Finding engine (replaces legality-engine).
 *
 * Deterministic rule checks that produce Finding records.
 * Side-effect free — returns findings without writing to storage.
 * All alert text uses cautious, non-conclusive language.
 */

import type { DebtCase, DebtDocument, DebtEvent, Finding, FindingCode } from "../types";

// ── Helper ────────────────────────────────────────────────────────

function finding(
	caseId: string,
	code: FindingCode,
	severity: Finding["severity"],
	description: string,
): Omit<Finding, "id" | "detectedAt"> {
	return { caseId, code, severity, description };
}

function daysUntil(dateStr: string): number {
	return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

// ── Main rule runner ──────────────────────────────────────────────

/**
 * Run all finding rules against a case and its documents + events.
 * Returns an array of findings (may be empty).
 */
export function runLegalityChecks(
	c: DebtCase,
	docs: DebtDocument[],
	events?: DebtEvent[],
): Omit<Finding, "id" | "detectedAt">[] {
	return runFindingRules(c, docs, events ?? []);
}

export function runFindingRules(
	c: DebtCase,
	docs: DebtDocument[],
	events: DebtEvent[],
): Omit<Finding, "id" | "detectedAt">[] {
	const results: Omit<Finding, "id" | "detectedAt">[] = [];

	const amounts   = c.amounts;
	const principal = amounts?.principal ?? null;
	const legalCosts = amounts?.legalCosts ?? null;
	const paid      = amounts?.paid ?? null;
	const outstanding = amounts?.outstanding ?? c.amountDue;

	// ── A. HIGH_FEE_RATIO ─────────────────────────────────────────
	if (principal && principal > 0 && legalCosts && legalCosts > 0) {
		const ratio = legalCosts / principal;
		if (ratio >= 5) {
			results.push(finding(c.id, "HIGH_FEE_RATIO", "critical",
				`Salær (${legalCosts} kr) utgjør ${(ratio * 100).toFixed(0)} % av hovedstol (${principal} kr). ` +
				`Vurder om salærberegningen bør kontrolleres og om innsigelse er aktuelt.`));
		} else if (ratio >= 2) {
			results.push(finding(c.id, "HIGH_FEE_RATIO", "warning",
				`Salær (${legalCosts} kr) utgjør ${(ratio * 100).toFixed(0)} % av hovedstol (${principal} kr). ` +
				`Vurder om salærgrunnlaget bør dokumenteres nærmere.`));
		}
	}

	// ── B. LOW_PRINCIPAL_HIGH_COLLECTION_COST ─────────────────────
	if (principal !== null && principal < 200 && legalCosts !== null && legalCosts > principal) {
		results.push(finding(c.id, "LOW_PRINCIPAL_HIGH_COLLECTION_COST", "warning",
			`Hovedstol (${principal} kr) er lav, men salær/inndrivingskostnad (${legalCosts} kr) er høyere. ` +
			`Dette kan indikere et uforholdsmessig høyt salær i forhold til kravet.`));
	}

	// ── C. PRINCIPAL_PAID_FEES_REMAIN ─────────────────────────────
	if (principal !== null && paid !== null && outstanding !== null) {
		if (paid >= principal && outstanding > 0) {
			results.push(finding(c.id, "PRINCIPAL_PAID_FEES_REMAIN", "warning",
				`Det ser ut som hovedstol (${principal} kr) kan være betalt, men utestående beløp (${outstanding} kr) gjenstår. ` +
				`Kontroller om restbeløpet kun gjelder salær/renter, og vurder om det er grunnlag for innsigelse.`));
		}
	}

	// ── D. FEE_INCREASE_IMMINENT ──────────────────────────────────
	const feeIncreaseText = /salæret\s+kan\s+dobles|salærøkning|ytterligere\s+salær/i;
	const hasFeeIncreaseWarning = docs.some((d) => d.extractedText && feeIncreaseText.test(d.extractedText));
	if (hasFeeIncreaseWarning && c.dueDate) {
		const days = daysUntil(c.dueDate);
		if (days <= 7) {
			results.push(finding(c.id, "FEE_INCREASE_IMMINENT", "critical",
				`Dokumentet varsler mulig salærøkning, og betalingsfrist er om ${Math.max(0, days)} dag(er). ` +
				`Vurder å kontakte kreditor eller registrere innsigelse før fristen.`));
		}
	}

	// ── E. DOUBLE_FEE_APPLIED ─────────────────────────────────────
	const legalCostsList = events
		.map((e) => e.amounts?.legalCosts)
		.filter((v): v is number => v !== null && v !== undefined)
		.sort((a, b) => a - b);
	if (legalCostsList.length >= 2) {
		const first = legalCostsList[0]!;
		const last  = legalCostsList[legalCostsList.length - 1]!;
		// 218,75 kr doubled to ~437,50 is a common pattern
		const isNearDouble = last >= first * 1.8 && first > 0;
		if (isNearDouble && Math.abs(first - 218.75) < 5) {
			results.push(finding(c.id, "DOUBLE_FEE_APPLIED", "warning",
				`Salæret ser ut til å ha økt fra ca. ${first.toFixed(2)} kr til ${last.toFixed(2)} kr. ` +
				`Kontroller om salærøkning er varslet og rettmessig.`));
		}
	}

	// ── F. CASE_CONSOLIDATED ──────────────────────────────────────
	if (c.status === "consolidated" || (c.mergedCaseNos && c.mergedCaseNos.length > 0)) {
		const invoiceCount = c.invoices?.length ?? 0;
		results.push(finding(c.id, "CASE_CONSOLIDATED", "info",
			`Saken ser ut til å være sammenslått med ${c.mergedCaseNos?.length ?? "ukjent antall"} andre sak(er)` +
			(invoiceCount > 0 ? ` med totalt ${invoiceCount} faktura(er)` : "") + `. ` +
			`Kontroller at hver faktura kun inngår én gang og at betalinger er korrekt kreditert.`));
	}

	// ── G. SETTLEMENT_OFFER_AVAILABLE ─────────────────────────────
	const settlementText = /redusert\s+oppgjør|avslag\s+på\s+salæret|[35]0\s*%\s+avslag|tilbud\s+om\s+å\s+avslutte/i;
	const hasSettlement = docs.some((d) => d.extractedText && settlementText.test(d.extractedText));
	if (hasSettlement || c.settlementOfferAmount !== null) {
		const offerStr = c.settlementOfferAmount ? ` (${c.settlementOfferAmount} kr)` : "";
		results.push(finding(c.id, "SETTLEMENT_OFFER_AVAILABLE", "opportunity",
			`Det ser ut til å foreligge et tilbud om redusert oppgjør${offerStr}. ` +
			`Vurder tilbudet opp mot total gjeld og kontakt inkassoselskapet for skriftlig bekreftelse på vilkårene.`));
	}

	// ── H. COLLECTION_CONTINUED_AFTER_OBJECTION ──────────────────
	if (c.objectionDate) {
		const objDate = new Date(c.objectionDate);
		const laterDemands = events.filter((e) => {
			const d = new Date(e.date);
			return d > objDate && (
				e.kind === "betalingsoppfordring" ||
				e.kind === "inkassovarsel" ||
				e.kind === "betalingspaaminnelse" ||
				e.kind === "restbeloep" ||
				(e.amounts?.legalCosts ?? 0) > 0 ||
				(e.amounts?.interest ?? 0) > 0
			);
		});
		if (laterDemands.length > 0) {
			results.push(finding(c.id, "COLLECTION_CONTINUED_AFTER_OBJECTION", "warning",
				`Det ser ut som saken har fortsatt å akkumulere eller sende krav etter registrert innsigelse (${c.objectionDate}). ` +
				`Vurder å be om status og stans i videre behandling mens saken avklares.`));
		}
	}

	// ── I. PAYMENT_CONFIRMED_CLOSED ───────────────────────────────
	const closedText = /Takk\s+for\s+din\s+betaling.*saken\s+er\s+nå\s+avsluttet|saken\s+er\s+nå\s+avsluttet/is;
	const hasClosedConfirm = docs.some((d) => d.extractedText && closedText.test(d.extractedText));
	if (hasClosedConfirm && c.status !== "closed" && c.status !== "paid") {
		results.push(finding(c.id, "PAYMENT_CONFIRMED_CLOSED", "info",
			`Et dokument bekrefter at betalingen er mottatt og saken er avsluttet. ` +
			`Merk saken som avsluttet og arkiver dokumentasjonen.`));
	}

	// ── J. CLAIM_SPEC_SHOWS_ZERO_FEES ─────────────────────────────
	const kravspekDocs = events.filter((e) => e.kind === "kravspesifikasjon");
	const laterFeeEvents = events.filter((e) =>
		(e.amounts?.legalCosts ?? 0) > 0 &&
		kravspekDocs.some((k) => new Date(e.date) > new Date(k.date)),
	);
	if (kravspekDocs.length > 0 && laterFeeEvents.length > 0) {
		const kravLegalCosts = kravspekDocs
			.map((e) => e.amounts?.legalCosts ?? null)
			.filter((v): v is number => v !== null);
		if (kravLegalCosts.some((v) => v === 0)) {
			results.push(finding(c.id, "CLAIM_SPEC_SHOWS_ZERO_FEES", "warning",
				`Kravspesifikasjonen viser 0 i utenrettslig inndrivingskostnad/salær, ` +
				`men et senere brev inkluderer salær. Kontroller grunnlaget for salærkravet.`));
		}
	}

	// ── K. ONLY_PRINCIPAL_RECOMMENDED ────────────────────────────
	const highFeeRatio = principal && legalCosts && legalCosts / principal >= 2;
	const lowPrincipal = principal !== null && principal < 200;
	const hasObjection = !!c.objectionDate;
	const hasSettlementOffer = c.settlementOfferAmount !== null;
	if (highFeeRatio || lowPrincipal || (hasObjection && legalCosts) || hasSettlementOffer) {
		results.push(finding(c.id, "ONLY_PRINCIPAL_RECOMMENDED", "info",
			`Basert på sakens profil (${[
				highFeeRatio && "høy salær/hovedstol-ratio",
				lowPrincipal && "lav hovedstol",
				hasObjection && "registrert innsigelse",
				hasSettlementOffer && "redusert oppgjør tilgjengelig",
			].filter(Boolean).join(", ")}) kan det være aktuelt å tilby betaling av ` +
			`kun dokumentert hovedstol som endelig oppgjør.`));
	}

	// ── Legacy checks (kept for backward compat) ──────────────────

	// Payment confirmation exists but status not paid
	const hasPaymentConfirmation = docs.some(
		(d) => d.kind === "payment_confirmation" || d.kind === "betalingsbekreftelse",
	);
	if (hasPaymentConfirmation && c.status !== "paid" && c.status !== "closed") {
		results.push(finding(c.id, "POSSIBLE_ALREADY_PAID", "critical",
			"En betalingsbekreftelse finnes for denne saken, men status er ikke 'betalt'. " +
			"Kontroller om kravet er innfridd."));
	}

	// No initial demand before collection
	const hasInitialDemand = docs.some((d) =>
		d.kind === "initial_demand" || d.kind === "reminder" ||
		d.kind === "betalingspaaminnelse" || d.kind === "inkassovarsel",
	);
	const hasCollection = docs.some((d) =>
		d.kind === "collection_demand" || d.kind === "collection_notice" ||
		d.kind === "betalingsoppfordring",
	);
	if (hasCollection && !hasInitialDemand) {
		results.push(finding(c.id, "MISSING_LEGAL_BASIS", "warning",
			"Betalingsoppfordring mottatt, men ingen opprinnelig faktura eller purring er registrert. " +
			"Be om dokumentasjon på det underliggende kravet."));
	}

	// Short deadline
	if (c.dueDate) {
		const days = daysUntil(c.dueDate);
		if (days >= 0 && days <= 3) {
			results.push(finding(c.id, "DEADLINE_SOON", "critical",
				`Betalingsfrist er om ${days} dag(er). Prioriter avklaring raskt.`));
		} else if (days < 0) {
			results.push(finding(c.id, "DEADLINE_SOON", "critical",
				`Betalingsfristen passerte for ${Math.abs(days)} dag(er) siden.`));
		}
	}

	// Missing creditor identity
	if (c.creditor === "Unknown creditor") {
		results.push(finding(c.id, "MISSING_SENDER_IDENTITY", "info",
			"Kreditor ble ikke identifisert fra e-postinnholdet. Manuell gjennomgang anbefales."));
	}

	// Legal escalation without collection notice
	const hasLegalNotice = docs.some((d) => d.kind === "legal_notice" || d.kind === "court_letter");
	const hasCollectionNotice = docs.some((d) =>
		d.kind === "collection_notice" || d.kind === "inkassovarsel" || d.kind === "betalingsoppfordring",
	);
	if (hasLegalNotice && !hasCollectionNotice) {
		results.push(finding(c.id, "LEGAL_ESCALATION_LANGUAGE", "critical",
			"Rettslig handling er varslet eller iverksatt, men ingen inkassovarsel er registrert i denne postkassen. " +
			"Be om dokumentasjon på forutgående varslingstrinn før du konkluderer med prosessbrudd."));
	}

	return results;
}
