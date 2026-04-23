/**
 * Case engine.
 *
 * Responsible for creating or finding the right DebtCase for an
 * incoming email, then attaching a document record to it.
 */

import type { ClassificationResult, DebtCase, DebtDocument, CasePriority } from "../types";
import { casesRepo } from "../storage/repos/cases.repo";
import { documentsRepo } from "../storage/repos/documents.repo";
import { determinePriority } from "./prioritization-engine";

export interface CaseEngineResult {
	case: DebtCase;
	document: DebtDocument;
	isNew: boolean;
}

interface ProcessEmailInput {
	emailId: string;
	mailboxId: string;
	classification: ClassificationResult;
	bodyText: string;
}

/**
 * Find or create a DebtCase for the given classification result,
 * then record a DebtDocument for the email.
 */
export function processEmail(
	sql: SqlStorage,
	input: ProcessEmailInput,
): CaseEngineResult {
	const { emailId, mailboxId, classification } = input;
	const creditor = classification.creditor ?? "Unknown creditor";
	const reference = classification.reference ?? null;

	// 1. Try to find an existing case
	let existingCase = casesRepo.findByCreditorRef(sql, mailboxId, creditor, reference);
	let isNew = false;

	if (!existingCase) {
		// 2. Create a new case
		const priority: CasePriority = determinePriority({
			kind: classification.kind,
			amountDue: classification.amountDue,
			dueDate: classification.dueDate,
		});

		existingCase = casesRepo.create(sql, {
			mailboxId,
			creditor,
			reference,
			amountDue: classification.amountDue,
			currency: classification.currency,
			dueDate: classification.dueDate,
			status: "open",
			priority,
			firstEmailId: emailId,
			lastEmailId: emailId,
		});
		isNew = true;
	} else {
		// 3. Update the existing case with newer information
		const updates: Partial<DebtCase> = { lastEmailId: emailId };

		// Upgrade priority if the new document is more serious
		const newPriority = determinePriority({
			kind: classification.kind,
			amountDue: classification.amountDue ?? existingCase.amountDue,
			dueDate: classification.dueDate ?? existingCase.dueDate,
		});
		if (isMoreUrgent(newPriority, existingCase.priority)) {
			updates.priority = newPriority;
		}
		if (classification.amountDue && !existingCase.amountDue) {
			updates.amountDue = classification.amountDue;
		}
		if (classification.dueDate && !existingCase.dueDate) {
			updates.dueDate = classification.dueDate;
		}

		casesRepo.update(sql, existingCase.id, updates);
		existingCase = casesRepo.findById(sql, existingCase.id)!;
	}

	// 4. Create document record
	const document = documentsRepo.create(sql, {
		caseId: existingCase.id,
		emailId,
		attachmentId: null,
		kind: classification.kind,
		extractedText: input.bodyText,
		analyzedAt: new Date().toISOString(),
	});

	return { case: existingCase, document, isNew };
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
