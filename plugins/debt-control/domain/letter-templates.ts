/**
 * Letter template generators.
 *
 * Produces Norwegian draft letters for the user to review and send manually.
 * No automatic sending occurs — all output is for human review only.
 */

import type { DebtCase, LetterDraft, LetterKind } from "../types";

interface LetterContext {
	caseNo: string;
	creditor: string;
	principal: string;
	paid?: string;
	name?: string;
}

function ctx(debtCase: DebtCase): LetterContext {
	const amounts  = debtCase.amounts;
	const caseNo   = debtCase.externalCaseNo ?? debtCase.reference ?? "[SAKSNUMMER]";
	const creditor = debtCase.creditor ?? "[KREDITOR]";
	const principal = amounts?.principal != null
		? `kr ${amounts.principal.toFixed(2)}`
		: "[HOVEDSTOL]";
	const paid = amounts?.paid != null
		? `kr ${amounts.paid.toFixed(2)}`
		: "[BETALT BELØP]";
	return { caseNo, creditor, principal, paid };
}

// ── A. Innsigelse på salær/restbeløp ─────────────────────────────

export function generateFeeObjectionLetter(debtCase: DebtCase, recipientName?: string): LetterDraft {
	const { caseNo, creditor, principal } = ctx(debtCase);
	const name = recipientName ?? "[NAVN]";
	const body = `Hei,

Jeg viser til sak ${caseNo}${creditor !== "[KREDITOR]" ? ` hos ${creditor}` : ""}.

Kravet bestrides for så vidt gjelder salær, renter og omkostninger. Slik saken fremstår er hovedstol ${principal}, og restbeløpet består i det vesentlige av salær og/eller renter.

Jeg ber om:
1. Full kravspesifikasjon med oversikt over alle poster
2. Kopi av opprinnelig faktura og eventuelle purringer
3. Dokumentasjon på betalingsfrist og varsling
4. Redegjørelse for beregning av salær og renter
5. Skriftlig bekreftelse på at videre inndrivelse og kostnadsakkumulering stanses mens denne innsigelsen behandles

Jeg forbeholder meg retten til å fremsette ytterligere innsigelser etter å ha mottatt etterspurt dokumentasjon.

Mvh
${name}`;

	return {
		kind: "objection_on_fees",
		subject: `Innsigelse – sak ${caseNo}`,
		body,
	};
}

// ── B. Hovedstol som endelig oppgjør ─────────────────────────────

export function generatePrincipalSettlementLetter(debtCase: DebtCase, recipientName?: string): LetterDraft {
	const { caseNo, creditor, principal } = ctx(debtCase);
	const name = recipientName ?? "[NAVN]";
	const offerAmt = debtCase.settlementOfferAmount != null
		? `kr ${debtCase.settlementOfferAmount.toFixed(2)}`
		: principal;
	const body = `Hei,

Jeg viser til sak ${caseNo}${creditor !== "[KREDITOR]" ? ` hos ${creditor}` : ""}.

For å løse saken på en prosessøkonomisk måte tilbyr jeg betaling av dokumentert hovedstol ${offerAmt} som fullt og endelig oppgjør.

Jeg ber om skriftlig bekreftelse på at:
1. Saken avsluttes ved slik betaling
2. Eventuelle salær, renter og andre omkostninger frafalles i sin helhet
3. Ingen ytterligere krav vil bli fremsatt i forbindelse med denne saken

Tilbudet er gyldig frem til [DATO]. Etter aksept vil betaling overføres til avtalt konto innen [ANTALL] virkedager.

Mvh
${name}`;

	return {
		kind: "principal_as_settlement",
		subject: `Tilbud om endelig oppgjør – sak ${caseNo}`,
		body,
	};
}

// ── C. Krav om status etter betaling ─────────────────────────────

export function generatePaymentStatusRequestLetter(debtCase: DebtCase, recipientName?: string): LetterDraft {
	const { caseNo, creditor, paid } = ctx(debtCase);
	const name = recipientName ?? "[NAVN]";
	const body = `Hei,

Jeg viser til sak ${caseNo}${creditor !== "[KREDITOR]" ? ` hos ${creditor}` : ""}.

Jeg har betalt ${paid} og ber om skriftlig bekreftelse på:
1. Om betalingen er mottatt og korrekt kreditert
2. Om saken er avsluttet i sin helhet
3. Dersom det gjenstår et beløp: en spesifikasjon av om dette gjelder hovedstol, renter, salær eller andre omkostninger

Vennligst svar skriftlig innen [ANTALL] virkedager.

Mvh
${name}`;

	return {
		kind: "payment_status_request",
		subject: `Forespørsel om betalingsstatus – sak ${caseNo}`,
		body,
	};
}

// ── D. Stans/avklaring ved innsigelse ────────────────────────────

export function generateProcessingLimitationLetter(debtCase: DebtCase, recipientName?: string): LetterDraft {
	const { caseNo, creditor } = ctx(debtCase);
	const name = recipientName ?? "[NAVN]";
	const objectionDate = debtCase.objectionDate ?? "[DATO FOR INNSIGELSE]";
	const body = `Hei,

Jeg viser til tidligere innsigelse i sak ${caseNo}${creditor !== "[KREDITOR]" ? ` hos ${creditor}` : ""}, innsendt ${objectionDate}.

Jeg ber om at:
1. Saken settes i bero mens innsigelsen behandles
2. Videre rente-, salær- og gebyrberegning stanses inntil grunnlaget for kravet er avklart
3. Jeg mottar skriftlig bekreftelse på at innsigelsen er registrert og at behandling er satt på vent

Dersom inkassoselskapet fastholder kravet uten å ha besvart innsigelsen, forbeholder jeg meg retten til å bringe saken inn for relevante tilsynsmyndigheter.

Mvh
${name}`;

	return {
		kind: "processing_limitation_request",
		subject: `Begjæring om stans i behandling – sak ${caseNo}`,
		body,
	};
}

// ── E. Unngå salærøkning (Phase 2) ────────────────────────────────

export function generatePreventFeeIncreaseLetter(debtCase: DebtCase, recipientName?: string): LetterDraft {
	const { caseNo, creditor } = ctx(debtCase);
	const name = recipientName ?? "[NAVN]";
	const body = `Hei,

Jeg viser til sak ${caseNo}${creditor !== "[KREDITOR]" ? ` hos ${creditor}` : ""}.

For å unngå unødvendig kostnadsøkning ber jeg om en oppdatert kravspesifikasjon og bekreftelse på hva som må betales for å avslutte saken.

Dersom kravet ikke er korrekt, eller dersom salær/renter bestrides, ber jeg om at videre kostnadsakkumulering stilles i bero mens forholdet avklares.

Mvh
${name}`;

	return {
		kind: "prevent_fee_increase",
		subject: `Forespørsel om kravspesifikasjon og stans – sak ${caseNo}`,
		body,
	};
}

// ── F. Innsigelse etter fortsatt inkasso (Phase 2) ─────────────────

export function generateObjectionAfterContinuedCollectionLetter(debtCase: DebtCase, recipientName?: string): LetterDraft {
	const { caseNo, creditor } = ctx(debtCase);
	const name = recipientName ?? "[NAVN]";
	const objectionDate = debtCase.objectionDate ?? "[DATO FOR FØRSTE INNSIGELSE]";
	const body = `Hei,

Jeg viser til tidligere innsigelse i sak ${caseNo}${creditor !== "[KREDITOR]" ? ` hos ${creditor}` : ""}, registrert ${objectionDate}.

Jeg registrerer at det fortsatt er sendt krav/påminnelser eller beregnet ytterligere beløp etter at saken ble bestridt. Jeg ber derfor om skriftlig redegjørelse for:
1. hvilken status saken har
2. om innsigelsen er registrert
3. om videre inndrivelse er stanset
4. hvordan eventuelle nye renter/salærer er beregnet
5. hvilket beløp som eventuelt gjelder dokumentert hovedstol

Mvh
${name}`;

	return {
		kind: "objection_after_continued_collection",
		subject: `Innsigelse – fortsatt inkasso etter bestridelse – sak ${caseNo}`,
		body,
	};
}

// ── G. Kun-hovedstol prosessøkonomi tilbud (Phase 2) ───────────────

export function generatePrincipalOnlyProcessEconomyLetter(debtCase: DebtCase, recipientName?: string): LetterDraft {
	const { caseNo, creditor, principal } = ctx(debtCase);
	const name = recipientName ?? "[NAVN]";
	const body = `Hei,

Jeg viser til sak ${caseNo}${creditor !== "[KREDITOR]" ? ` hos ${creditor}` : ""}.

For å løse saken effektivt og uten ytterligere ressursbruk tilbyr jeg betaling av dokumentert hovedstol ${principal} som fullt og endelig oppgjør.

Tilbudet gis uten erkjennelse av ansvar for salær, renter eller øvrige omkostninger. Jeg ber om skriftlig bekreftelse før betaling på at saken avsluttes ved dette oppgjøret.

Mvh
${name}`;

	return {
		kind: "principal_only_settlement_process_economy",
		subject: `Tilbud om oppgjør – kun hovedstol – sak ${caseNo}`,
		body,
	};
}

// ── Main dispatch ─────────────────────────────────────────────────

export function generateLetter(kind: LetterKind, debtCase: DebtCase, recipientName?: string): LetterDraft {
	switch (kind) {
		case "objection_on_fees":
			return generateFeeObjectionLetter(debtCase, recipientName);
		case "principal_as_settlement":
			return generatePrincipalSettlementLetter(debtCase, recipientName);
		case "payment_status_request":
			return generatePaymentStatusRequestLetter(debtCase, recipientName);
		case "processing_limitation_request":
			return generateProcessingLimitationLetter(debtCase, recipientName);
		case "prevent_fee_increase":
			return generatePreventFeeIncreaseLetter(debtCase, recipientName);
		case "objection_after_continued_collection":
			return generateObjectionAfterContinuedCollectionLetter(debtCase, recipientName);
		case "principal_only_settlement_process_economy":
			return generatePrincipalOnlyProcessEconomyLetter(debtCase, recipientName);
	}
}

export function generateAllLetters(debtCase: DebtCase, recipientName?: string): LetterDraft[] {
	const kinds: LetterKind[] = [
		"objection_on_fees",
		"principal_as_settlement",
		"payment_status_request",
		"processing_limitation_request",
		"prevent_fee_increase",
		"objection_after_continued_collection",
		"principal_only_settlement_process_economy",
	];
	return kinds.map((k) => generateLetter(k, debtCase, recipientName));
}
