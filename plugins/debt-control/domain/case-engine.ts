/**
 * Case engine.
 *
 * Responsible for creating/finding the right DebtCase for an incoming email,
 * attaching a document, creating an immutable DebtEvent, and advancing the
 * case state machine.
 */

import type { ClassificationResult, DebtCase, DebtDocument, CasePriority, CaseStatus, DebtAmountBreakdown } from "../types";
import type { RichClassificationResult } from "./classification-engine";
import { casesRepo } from "../storage/repos/cases.repo";
import { documentsRepo } from "../storage/repos/documents.repo";
import { eventsRepo } from "../storage/repos/events.repo";
import { determinePriority } from "./prioritization-engine";

export interface CaseEngineResult {
	case: DebtCase;
	document: DebtDocument;
	isNew: boolean;
}

interface ProcessEmailInput {
	emailId: string;
	mailboxId: string;
	classification: ClassificationResult | RichClassificationResult;
	bodyText: string;
	attachmentTexts?: string[];
	attachmentIds?: string[];
	attachmentFileNames?: string[];
	emailDate?: string;
}

// ── State machine ──────────────────────────────────────────────────

/**
 * Map a document kind to the next case status.
 * Never downgrades a closed/paid case.
 */
function nextStatus(current: CaseStatus, kind: string): CaseStatus | null {
	// Closed/paid states are sticky — require explicit action to re-open
	const stickyStates: CaseStatus[] = ["closed", "paid"];
	if (stickyStates.includes(current)) return null;

	switch (kind) {
		case "inkassovarsel":
		case "collection_notice":
			return "notice_received";
		case "betalingsoppfordring":
		case "collection_demand":
			return "collection_demand";
		case "betalingspaaminnelse":
		case "reminder":
			return current === "collection_demand" ? null : "reminder";
		case "restbeloep":
			return "fee_increase_warning";
		case "langtidsoppfoelging":
			return "long_term_monitoring";
		case "sammenslaaing":
			return "consolidated";
		case "redusert_oppgjoer":
			return "settlement_offer";
		case "betalingsbekreftelse":
		case "payment_confirmation":
		case "avslutningsbrev":
			return "closed";
		case "court_letter":
		case "legal_notice":
			// Keep as disputed if already, otherwise mark consolidated with legal note
			return current === "disputed" ? null : "disputed";
		default:
			return null;
	}
}

/**
 * Hash text for privacy-safe logging (djb2 — fast, not crypto).
 */
function hashText(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h) ^ s.charCodeAt(i);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

// ── Helpers ────────────────────────────────────────────────────────

const PRIORITY_ORDER: CasePriority[] = [
	"low",
	"already_paid_possible",
	"waiting_response",
	"investigate_first",
	"object_now",
	"pay_now",
];

function isMoreUrgent(a: CasePriority, b: CasePriority): boolean {
	return PRIORITY_ORDER.indexOf(a) > PRIORITY_ORDER.indexOf(b);
}

/**
 * Find or create a DebtCase for the incoming email.
 * Creates an immutable DebtEvent for audit trail.
 */
export function processEmail(
	sql: SqlStorage,
	input: ProcessEmailInput,
): CaseEngineResult {
	const { emailId, mailboxId, classification } = input;
	const rich       = classification as RichClassificationResult;
	const creditor   = classification.creditor ?? "Unknown creditor";
	const reference  = classification.reference ?? null;
	const caseNo     = rich.externalCaseNo ?? null;
	const now        = new Date().toISOString();
	const emailDate  = input.emailDate ?? now;

	// 1. Try to find by external case number first (most reliable)
	let existingCase: DebtCase | null = null;
	if (caseNo) {
		existingCase = casesRepo.findByExternalCaseNo(sql, mailboxId, caseNo);
	}
	if (!existingCase) {
		existingCase = casesRepo.findByCreditorRef(
			sql, mailboxId, creditor, reference,
			classification.amountDue, classification.dueDate,
		);
	}

	let isNew = false;
	const amounts: DebtAmountBreakdown = rich.amounts ?? {
		principal:   null, interest: null, fee: null, reminderFee: null,
		legalCosts:  null, paid: null, outstanding: null,
		amountToPay: classification.amountDue,
		currency:    "NOK",
	};

	if (!existingCase) {
		// 2. Create new case
		const priority: CasePriority = determinePriority({
			kind:     classification.kind,
			amountDue: classification.amountDue,
			dueDate:   classification.dueDate,
			amounts,
		});

		const initialStatus: CaseStatus = nextStatus("unknown" as CaseStatus, classification.kind) ?? "open";

		existingCase = casesRepo.create(sql, {
			mailboxId,
			creditor,
			reference,
			externalCaseNo:  caseNo,
			amountDue:       classification.amountDue,
			currency:        classification.currency,
			dueDate:         classification.dueDate,
			amounts,
			invoices:        rich.invoices ?? [],
			parentCaseNo:    null,
			mergedCaseNos:   [],
			status:          initialStatus,
			priority,
			firstEmailId:    emailId,
			lastEmailId:     emailId,
			firstSeenAt:     emailDate,
			lastSeenAt:      emailDate,
			objectionDate:   null,
			processingLimitationRequestedAt: null,
			closedAt:        initialStatus === "closed" ? now : null,
			settlementOfferAmount:   rich.signals?.isSettlementOffer ? classification.amountDue : null,
			settlementOfferDeadline: classification.dueDate,
		});
		isNew = true;
	} else {
		// 3. Update existing case
		const updates: Partial<DebtCase> = {
			lastEmailId: emailId,
			lastSeenAt:  emailDate,
		};

		// Advance status (never downgrade closed/paid)
		const newStatus = nextStatus(existingCase.status, classification.kind);
		if (newStatus) updates.status = newStatus;

		// Auto-close when confirmation received
		if (rich.signals?.isClosed) {
			updates.status  = "closed";
			updates.closedAt = now;
		}

		// Mark consolidated
		if (rich.signals?.isConsolidated && existingCase.status !== "consolidated") {
			updates.status = "consolidated";
		}

		// Settlement offer
		if (rich.signals?.isSettlementOffer && !existingCase.settlementOfferAmount) {
			updates.settlementOfferAmount   = classification.amountDue;
			updates.settlementOfferDeadline = classification.dueDate;
			updates.status = "settlement_offer";
		}

		// Update amounts if richer data available
		if (amounts.principal ?? amounts.amountToPay ?? amounts.outstanding) {
			updates.amounts  = amounts;
			updates.amountDue = amounts.amountToPay ?? amounts.outstanding ?? classification.amountDue;
		}

		// Extend invoice list
		if (rich.invoices?.length) {
			const existing = existingCase.invoices ?? [];
			const existingNos = new Set(existing.map((i) => i.invoiceNo));
			const newInvoices = rich.invoices.filter((i) => !existingNos.has(i.invoiceNo));
			if (newInvoices.length > 0) {
				updates.invoices = [...existing, ...newInvoices];
			}
		}

		// Upgrade priority
		const newPriority = determinePriority({
			kind: classification.kind,
			amountDue: classification.amountDue ?? existingCase.amountDue,
			dueDate: classification.dueDate ?? existingCase.dueDate,
			amounts,
			isFeeIncreaseWarning: rich.signals?.isFeeIncreaseWarning,
		});
		if (isMoreUrgent(newPriority, existingCase.priority)) {
			updates.priority = newPriority;
		}

		if (classification.dueDate && !existingCase.dueDate) {
			updates.dueDate = classification.dueDate;
		}
		if (caseNo && !existingCase.externalCaseNo) {
			updates.externalCaseNo = caseNo;
		}

		casesRepo.update(sql, existingCase.id, updates);
		existingCase = casesRepo.findById(sql, existingCase.id)!;
	}

	// 4. Create document record
	const document = documentsRepo.create(sql, {
		caseId:        existingCase.id,
		emailId,
		attachmentId:  null,
		kind:          classification.kind,
		extractedText: input.bodyText,
		analyzedAt:    now,
	});

	// 5. Create document records for PDF attachments
	const attachmentTexts     = input.attachmentTexts ?? [];
	const attachmentIds       = input.attachmentIds   ?? [];
	const attachmentFileNames = input.attachmentFileNames ?? [];
	for (let i = 0; i < attachmentTexts.length; i++) {
		documentsRepo.create(sql, {
			caseId:        existingCase.id,
			emailId,
			attachmentId:  attachmentIds[i] ?? null,
			kind:          classification.kind,
			extractedText: attachmentTexts[i],
			analyzedAt:    now,
		});
	}

	// 6. Create immutable event record (privacy-safe: hash + preview only)
	const fullText = [input.bodyText, ...attachmentTexts].join("\n");
	eventsRepo.create(sql, {
		caseId:               existingCase.id,
		date:                 emailDate,
		sourceEmailId:        emailId,
		sourceAttachmentId:   attachmentIds[0] ?? null,
		sourceFileName:       attachmentFileNames[0] ?? null,
		kind:                 classification.kind,
		creditor,
		externalCaseNo:       caseNo,
		invoiceNos:           (rich.invoices ?? []).map((i) => i.invoiceNo),
		amounts,
		deadline:             classification.dueDate,
		rawTextHash:          fullText ? hashText(fullText) : null,
		extractedTextPreview: fullText.slice(0, 200) || null,
	});

	return { case: existingCase, document, isNew };
}
