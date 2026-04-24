/**
 * Debt Control — shared domain types.
 * These types flow through the entire plugin (domain, storage, API, UI).
 */

// ── Classification ──────────────────────────────────────────────────

export type DocumentKind =
	// Norwegian debt lifecycle
	| "inkassovarsel"           // Inkassovarsel (første purring etter varsel, §9-2 inkassoloven)
	| "betalingsoppfordring"    // Betalingsoppfordring (formelt krav fra inkassoselskap)
	| "betalingspaaminnelse"    // Betalingspåminnelse (vennlig påminnelse)
	| "restbeloep"              // Brev om restbeløp ("fortsatt ikke betalt")
	| "informasjon_om_krav"     // Informasjonsbrev om krav / videre prosess
	| "langtidsoppfoelging"     // Langtidsoppfølging / overvåkning
	| "sammenslaaing"           // Sammenslåing - flere faktura under ett saksnummer
	| "betalingsbekreftelse"    // Bekreftelse på betaling / kvittering
	| "avslutningsbrev"         // Brev om at saken er avsluttet
	| "redusert_oppgjoer"       // Tilbud om redusert oppgjør / avslag på salær
	| "innsigelse_besvart"      // Inkassoselskapets svar på innsigelse
	| "kravspesifikasjon"       // Detaljert kravspesifikasjon
	| "ticket_timeline"         // Systemlogg / Puzzel Contact Centre / ticket
	// Legacy kinds (kept for backward compatibility)
	| "initial_demand"          // Første kravbrev (legacy alias)
	| "reminder"                // Purring (legacy)
	| "collection_notice"       // Inkassovarsel (legacy)
	| "collection_demand"       // Inkassokrav (legacy)
	| "legal_notice"            // Rettslig varsel
	| "court_letter"            // Stevning / forliksklage
	| "debt_settlement"         // Gjeldsforlik / nedbetalingsavtale
	| "payment_confirmation"    // Kvittering / betalingsbekreftelse (legacy)
	| "unknown";

export type CaseStatus =
	| "notice_received"                     // Inkassovarsel mottatt
	| "collection_demand"                   // Betalingsoppfordring
	| "reminder"                            // Påminnelse
	| "fee_increase_warning"                // Varsel om salærøkning
	| "long_term_monitoring"                // Langtidsovervåkning
	| "settlement_offer"                    // Tilbud om redusert oppgjør
	| "objection_registered"                // Innsigelse registrert
	| "processing_limitation_requested"     // Krav om stans i behandling
	| "principal_only_settlement"           // Tilbud om hovedstol som oppgjør
	| "principal_paid_fees_remain"          // Hovedstol betalt, salær gjenstår
	| "paid"                                // Betalt
	| "closed"                              // Avsluttet
	| "disputed"                            // Bestridt
	| "consolidated"                        // Sammenslått sak
	// Legacy aliases
	| "open"
	| "waiting_response"
	| "archived"
	| "unknown";

export type CasePriority =
	| "pay_now"
	| "investigate_first"
	| "object_now"
	| "waiting_response"
	| "already_paid_possible"
	| "low";

// ── Core domain objects ──────────────────────────────────────────────

/** Detailed breakdown of amounts on a debt case */
export interface DebtAmountBreakdown {
	principal: number | null;       // Hovedstol
	interest: number | null;        // Renter
	fee: number | null;             // Gebyr (purregebyr, forsinkelsesrente m.m.)
	reminderFee: number | null;     // Purregebyr spesifikt
	legalCosts: number | null;      // Salær / inndrivingskostnader
	paid: number | null;            // Bekreftet betalt
	outstanding: number | null;     // Utestående (beløp å betale)
	amountToPay: number | null;     // «Beløp å betale» fra brev
	currency: string;
}

/** Single invoice/krav linked to a case (relevant for consolidation) */
export interface DebtInvoice {
	invoiceNo: string;
	originalAmount: number | null;
	dueDate: string | null;
	vehicleReg: string | null;      // Regnr hvis aktuelt (parkering, bompenger)
	paidAmount: number | null;
}

/** Immutable audit event — one per email/attachment that produced data */
export interface DebtEvent {
	id: string;
	caseId: string;
	date: string;                   // ISO date of the document (not ingestion time)
	sourceEmailId: string;
	sourceAttachmentId: string | null;
	sourceFileName: string | null;
	kind: DocumentKind;
	creditor: string | null;
	externalCaseNo: string | null;
	invoiceNos: string[];           // JSON array
	amounts: DebtAmountBreakdown;
	deadline: string | null;        // betalingsfrist
	rawTextHash: string | null;     // sha256 hex of full extracted text (not the text itself)
	extractedTextPreview: string | null; // First 200 chars only
	createdAt: string;
}

export interface DebtCase {
	id: string;
	mailboxId: string;
	creditor: string;
	reference: string | null;           // Legacy field (KID / ref); prefer externalCaseNo
	externalCaseNo: string | null;      // Inkassoselskapets saksnummer
	// ── Amount ───────────────────────────────────────────────────
	amountDue: number | null;           // Total utestående (legacy / quick access)
	currency: string;
	dueDate: string | null;
	amounts: DebtAmountBreakdown | null;
	// ── Invoices ─────────────────────────────────────────────────
	invoices: DebtInvoice[];            // Alle fakturaer (kan være flere ved sammenslåing)
	// ── Consolidation ─────────────────────────────────────────────
	parentCaseNo: string | null;        // Satt hvis denne er innlemmet i en annen sak
	mergedCaseNos: string[];            // Saksnumre som er slått inn i dette
	// ── State ─────────────────────────────────────────────────────
	status: CaseStatus;
	priority: CasePriority;
	// ── Email references ──────────────────────────────────────────
	firstEmailId: string | null;
	lastEmailId: string | null;
	// ── Key dates ─────────────────────────────────────────────────
	firstSeenAt: string | null;
	lastSeenAt: string | null;
	objectionDate: string | null;       // Dato innsigelse ble registrert
	processingLimitationRequestedAt: string | null; // Begjæring om stans
	closedAt: string | null;
	// ── Settlement ────────────────────────────────────────────────
	settlementOfferAmount: number | null;
	settlementOfferDeadline: string | null;
	// ── Timestamps ────────────────────────────────────────────────
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
	severity: "info" | "warning" | "critical" | "opportunity";
	description: string;
	detectedAt: string;
}

export type FindingCode =
	// Phase 2 — algorithmic risk findings
	| "STANDARD_DEADLINE_PATTERN"
	| "PREDICTABLE_FEE_ESCALATION"
	| "SMALL_CLAIMS_SEPARATE_ESCALATION"
	| "CONSOLIDATION_AFTER_FEES"
	| "MANUAL_OVERRIDE_AFTER_OBJECTION"
	| "PRINCIPAL_ONLY_ACCEPTED_PATTERN"
	| "SETTLEMENT_DISCOUNT_PATTERN"
	| "CONTINUED_AUTOMATION_AFTER_DISPUTE"
	| "NEXT_FEE_INCREASE_PREDICTED"
	| "NEXT_COLLECTION_STEP_PREDICTED"
	// Phase 1 — comprehensive codes
	| "HIGH_FEE_RATIO"
	| "PRINCIPAL_PAID_FEES_REMAIN"
	| "FEE_INCREASE_IMMINENT"
	| "DOUBLE_FEE_APPLIED"
	| "CASE_CONSOLIDATED"
	| "SETTLEMENT_OFFER_AVAILABLE"
	| "OBJECTION_REGISTERED"
	| "PROCESSING_LIMITATION_REQUESTED"
	| "COLLECTION_CONTINUED_AFTER_OBJECTION"
	| "PAYMENT_CONFIRMED_CLOSED"
	| "CLAIM_SPEC_SHOWS_ZERO_FEES"
	| "POSSIBLE_DUPLICATE_CASE"
	| "ONLY_PRINCIPAL_RECOMMENDED"
	| "LOW_PRINCIPAL_HIGH_COLLECTION_COST"
	| "DEADLINE_SOON"
	| "LEGAL_ESCALATION_LANGUAGE"
	| "MISSING_ORIGINAL_INVOICE"
	| "HUMAN_REVIEW_RECOMMENDED"
	// Legacy codes (kept for backward compat)
	| "POSSIBLE_ALREADY_PAID"
	| "MISSING_LEGAL_BASIS"
	| "FRAGMENTATION_SUSPECTED"
	| "EXCESSIVE_FEES"
	| "SHORT_DEADLINE"
	| "DEBT_EXPIRED"
	| "AMOUNT_MISMATCH"
	| "DUPLICATE_DEMAND"
	| "MISSING_SENDER_IDENTITY"
	| "REVIEW_REQUIRED";

// ── Recommended action ───────────────────────────────────────────────

export type RecommendedActionKind =
	| "PAY_PRINCIPAL_BEFORE_FEES"
	| "REQUEST_DOCUMENTATION"
	| "FILE_OBJECTION"
	| "REQUEST_PROCESSING_LIMITATION"
	| "OFFER_PRINCIPAL_AS_FINAL_SETTLEMENT"
	| "VERIFY_PAYMENT"
	| "MARK_CLOSED"
	| "EXPORT_EVIDENCE_PACK"
	| "HUMAN_REVIEW";

export interface RecommendedAction {
	kind: RecommendedActionKind;
	summary: string;
	rationale: string;
	urgency: "immediate" | "soon" | "when_convenient";
}

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

// ── Letter templates ──────────────────────────────────────────────────

export type LetterKind =
	| "objection_on_fees"
	| "principal_as_settlement"
	| "payment_status_request"
	| "processing_limitation_request"
	// Phase 2 letter kinds
	| "prevent_fee_increase"
	| "objection_after_continued_collection"
	| "principal_only_settlement_process_economy";

export interface LetterDraft {
	kind: LetterKind;
	subject: string;
	body: string;
}

// ── Evidence pack ─────────────────────────────────────────────────────

export interface DebtEvidencePack {
	generatedAt: string;
	caseSummary: string;
	creditor: string;
	externalCaseNo: string | null;
	invoices: DebtInvoice[];
	timeline: DebtEvent[];
	amountEvolution: Array<{ date: string; amountToPay: number | null; source: string }>;
	payments: Array<{ date: string; amount: number; source: string }>;
	findings: Finding[];
	recommendedAction: RecommendedAction | null;
	letterDrafts: LetterDraft[];
	sourceDocumentRefs: Array<{ emailId: string; attachmentId: string | null; kind: DocumentKind; date: string }>;
}

// ── Phase 2: Collection Algorithm Fingerprint ───────────────────────

export interface ObservedStage {
	kind: DocumentKind;
	averageDaysAfterPrevious: number | null;
	typicalDeadlineDays: number | null;
	count: number;
}

export interface FingerprintEvidence {
	caseId: string;
	eventId: string;
	date: string;
	observation: string;
}

export interface CollectionAlgorithmFingerprint {
	collectorName: string;
	creditorName: string | undefined;
	observedStages: ObservedStage[];
	standardDeadlineDays: number | undefined;
	feeIncreaseAfterDays: number | undefined;
	knownFeeSteps: number[];
	knownInterestRates: number[];
	consolidationDetected: boolean;
	settlementOffersDetected: boolean;
	manualReviewTriggeredByObjection: boolean;
	paymentClosesCasePattern: boolean;
	principalOnlySettlementObserved: boolean;
	confidence: number;     // 0–1
	evidence: FingerprintEvidence[];
}

export interface CollectorProfile {
	name: string;
	orgNo: string | undefined;
	portalDomains: string[];
	paymentAccountNumbers: string[];
	knownEmailAddresses: string[];
	observedFingerprints: CollectionAlgorithmFingerprint[];
	strategyNotes: string[];
}

// ── Phase 2: Next Collection Step Prediction ─────────────────────────

export interface NextCollectionStepPrediction {
	predictedNextStatus: CaseStatus;
	predictedNextDocumentKind: DocumentKind | undefined;
	estimatedDate: string | undefined;
	riskLevel: "low" | "medium" | "high" | "critical";
	costRiskAmount: number | undefined;
	reasoning: string[];
	recommendedPreventiveAction: RecommendedAction | undefined;
}

// ── Phase 2: Tactical Response ───────────────────────────────────────

export type TacticalObjective =
	| "avoid_fee_increase"
	| "settle_principal_only"
	| "request_documentation"
	| "stop_continued_collection"
	| "verify_closure"
	| "prepare_complaint"
	| "human_review";

export interface TacticalResponse {
	objective: TacticalObjective;
	urgency: "low" | "medium" | "high" | "critical";
	summary: string;
	recommendedAction: RecommendedAction;
	draftTemplateId: LetterKind | undefined;
	checklist: string[];
}

// ── Phase 2: Timeline Insights ───────────────────────────────────────

export interface TimelineInsight {
	date: string;
	label: string;
	importance: "info" | "warning" | "critical" | "positive";
	description: string;
}

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
