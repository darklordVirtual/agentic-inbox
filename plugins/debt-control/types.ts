/**
 * Debt Control — shared domain types.
 * These types flow through the entire plugin (domain, storage, API, UI).
 */

// ── Classification ──────────────────────────────────────────────────

export type DocumentKind =
	| "initial_demand"      // Første kravbrev
	| "reminder"            // Purring
	| "collection_notice"   // Inkassovarsel
	| "collection_demand"   // Inkassokrav
	| "legal_notice"        // Rettslig varsel
	| "court_letter"        // Stevning / forliksklage
	| "debt_settlement"     // Gjeldsforlik / nedbetalingsavtale
	| "payment_confirmation"// Kvittering / betalingsbekreftelse
	| "unknown";

export type CaseStatus =
	| "open"
	| "waiting_response"
	| "disputed"
	| "paid"
	| "closed"
	| "archived";

export type CasePriority =
	| "pay_now"
	| "investigate_first"
	| "object_now"
	| "waiting_response"
	| "already_paid_possible"
	| "low";

// ── Core domain objects ──────────────────────────────────────────────

export interface DebtCase {
	id: string;
	mailboxId: string;
	creditor: string;
	reference: string | null;
	amountDue: number | null;        // NOK (or original currency)
	currency: string;                // ISO 4217, default "NOK"
	dueDate: string | null;          // ISO date string
	status: CaseStatus;
	priority: CasePriority;
	firstEmailId: string | null;
	lastEmailId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface DebtDocument {
	id: string;
	caseId: string;
	emailId: string;
	attachmentId: string | null;
	kind: DocumentKind;
	extractedText: string | null;
	analyzedAt: string | null;
	createdAt: string;
}

export interface Finding {
	id: string;
	caseId: string;
	code: FindingCode;
	severity: "info" | "warning" | "critical";
	description: string;
	detectedAt: string;
}

export type FindingCode =
	| "POSSIBLE_ALREADY_PAID"
	| "MISSING_LEGAL_BASIS"
	| "FRAGMENTATION_SUSPECTED"
	| "EXCESSIVE_FEES"
	| "SHORT_DEADLINE"
	| "DEBT_EXPIRED"                 // Mulig foreldelse
	| "AMOUNT_MISMATCH"              // Beløp stemmer ikke med forrige varsel
	| "DUPLICATE_DEMAND"
	| "MISSING_SENDER_IDENTITY"
	| "REVIEW_REQUIRED";

export interface SuggestedAction {
	id: string;
	caseId: string;
	action: ActionKind;
	rationale: string;
	confidence: number;             // 0-1
	createdAt: string;
}

export type ActionKind =
	| "pay_now"
	| "investigate_first"
	| "object_now"
	| "request_documentation"
	| "already_paid_confirm";

// ── Bank reconciliation ──────────────────────────────────────────────

export interface BankTransaction {
	id: string;
	mailboxId: string;
	provider: string;
	externalId: string;
	amount: number;
	currency: string;
	date: string;
	description: string;
	counterparty: string | null;
	reference: string | null;
	rawData: string | null;       // JSON blob for provider-specific fields
	importedAt: string;
}

export type MatchConfidence = "high" | "medium" | "low" | "none";

export interface PaymentMatch {
	id: string;
	caseId: string;
	transactionId: string;
	confidence: MatchConfidence;
	matchScore: number;           // 0-100
	matchReasons: string;         // JSON array of reasons
	confirmedAt: string | null;   // null = not yet confirmed by user
	createdAt: string;
}

// ── Plugin configuration ─────────────────────────────────────────────

export interface PluginSettings {
	enabled: boolean;
	bankProvider: "sparebank1" | "csv" | "none";
	autoClassify: boolean;
	autoReconcile: boolean;
	// ── Draft & response behaviour ────────────────────────────────
	/** Automatically generate a draft objection when classification confidence ≥ threshold */
	autoDraftObjection: boolean;
	/** Automatically draft a request-for-more-info when required fields are missing */
	autoDraftInfoRequest: boolean;
	// ── Legality & validation ─────────────────────────────────────
	/** Run legality engine on every classified document */
	enableLegalityCheck: boolean;
	/** Flag documents with a deadline shorter than this many days */
	shortDeadlineDays: number;
	// ── Priority & alerts ─────────────────────────────────────────
	/** Move cases to pay_now priority when amount exceeds this threshold (NOK) */
	highValueThresholdNok: number;
	/** Create high-priority cases for court letters automatically */
	autoEscalateCourtLetters: boolean;
}

export interface SpareBank1Config {
	clientId: string;        // stored as secret in Worker env
	accessToken: string;     // stored as secret in Worker env
	accountId: string | null;
	lastSyncAt: string | null;
}

// ── Classification result (not persisted as-is, mapped to domain) ────

export interface ClassificationResult {
	kind: DocumentKind;
	creditor: string | null;
	reference: string | null;
	amountDue: number | null;
	currency: string;
	dueDate: string | null;
	confidence: number;
	reasoning: string;
}
