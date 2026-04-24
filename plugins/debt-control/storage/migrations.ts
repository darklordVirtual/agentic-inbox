import type { Migration } from "../../../workers/durableObject/migrations";

/**
 * All DDL for the Debt Control plugin.
 * Applied once per mailbox DO via the core migration runner.
 */
export const debtControlMigrations: Migration[] = [
	{
		name: "debt_control_001_initial",
		sql: `
-- Plugin settings (one row per plugin instance)
CREATE TABLE IF NOT EXISTS dc_settings (
	id           TEXT PRIMARY KEY DEFAULT 'singleton',
	enabled      INTEGER NOT NULL DEFAULT 1,
	bank_provider TEXT NOT NULL DEFAULT 'none',
	auto_classify INTEGER NOT NULL DEFAULT 1,
	auto_reconcile INTEGER NOT NULL DEFAULT 1,
	updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Debt cases
CREATE TABLE IF NOT EXISTS dc_cases (
	id            TEXT PRIMARY KEY,
	mailbox_id    TEXT NOT NULL,
	creditor      TEXT NOT NULL,
	reference     TEXT,
	amount_due    REAL,
	currency      TEXT NOT NULL DEFAULT 'NOK',
	due_date      TEXT,
	status        TEXT NOT NULL DEFAULT 'open',
	priority      TEXT NOT NULL DEFAULT 'investigate_first',
	first_email_id TEXT,
	last_email_id  TEXT,
	created_at    TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dc_cases_mailbox ON dc_cases(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_dc_cases_status  ON dc_cases(status);

-- Documents linked to cases
CREATE TABLE IF NOT EXISTS dc_documents (
	id            TEXT PRIMARY KEY,
	case_id       TEXT NOT NULL REFERENCES dc_cases(id) ON DELETE CASCADE,
	email_id      TEXT NOT NULL,
	attachment_id TEXT,
	kind          TEXT NOT NULL DEFAULT 'unknown',
	extracted_text TEXT,
	analyzed_at   TEXT,
	created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dc_docs_case ON dc_documents(case_id);
CREATE INDEX IF NOT EXISTS idx_dc_docs_email ON dc_documents(email_id);

-- Legality / rule-engine findings
CREATE TABLE IF NOT EXISTS dc_findings (
	id          TEXT PRIMARY KEY,
	case_id     TEXT NOT NULL REFERENCES dc_cases(id) ON DELETE CASCADE,
	code        TEXT NOT NULL,
	severity    TEXT NOT NULL DEFAULT 'info',
	description TEXT NOT NULL,
	detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dc_findings_case ON dc_findings(case_id);

-- Suggested actions
CREATE TABLE IF NOT EXISTS dc_suggested_actions (
	id          TEXT PRIMARY KEY,
	case_id     TEXT NOT NULL REFERENCES dc_cases(id) ON DELETE CASCADE,
	action      TEXT NOT NULL,
	rationale   TEXT NOT NULL,
	confidence  REAL NOT NULL DEFAULT 0,
	created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dc_actions_case ON dc_suggested_actions(case_id);

-- Bank transactions imported via provider
CREATE TABLE IF NOT EXISTS dc_transactions (
	id           TEXT PRIMARY KEY,
	mailbox_id   TEXT NOT NULL,
	provider     TEXT NOT NULL,
	external_id  TEXT NOT NULL,
	amount       REAL NOT NULL,
	currency     TEXT NOT NULL DEFAULT 'NOK',
	date         TEXT NOT NULL,
	description  TEXT NOT NULL DEFAULT '',
	counterparty TEXT,
	reference    TEXT,
	raw_data     TEXT,
	imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE(provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_dc_txn_mailbox ON dc_transactions(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_dc_txn_date    ON dc_transactions(date);

-- Payment matches between transactions and cases
CREATE TABLE IF NOT EXISTS dc_payment_matches (
	id             TEXT PRIMARY KEY,
	case_id        TEXT NOT NULL REFERENCES dc_cases(id) ON DELETE CASCADE,
	transaction_id TEXT NOT NULL REFERENCES dc_transactions(id) ON DELETE CASCADE,
	confidence     TEXT NOT NULL DEFAULT 'low',
	match_score    INTEGER NOT NULL DEFAULT 0,
	match_reasons  TEXT NOT NULL DEFAULT '[]',
	confirmed_at   TEXT,
	created_at     TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE(case_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_dc_matches_case ON dc_payment_matches(case_id);
`,
	},
	{
		name: "debt_control_003_events_and_extended_case",
		sql: `
-- Extend dc_cases with new fields
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS external_case_no     TEXT;
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS amounts_json         TEXT;
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS invoices_json        TEXT NOT NULL DEFAULT '[]';
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS parent_case_no       TEXT;
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS merged_case_nos_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS first_seen_at        TEXT;
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS last_seen_at         TEXT;
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS objection_date       TEXT;
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS processing_limitation_requested_at TEXT;
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS closed_at            TEXT;
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS settlement_offer_amount    REAL;
ALTER TABLE dc_cases ADD COLUMN IF NOT EXISTS settlement_offer_deadline  TEXT;

CREATE INDEX IF NOT EXISTS idx_dc_cases_ext_no ON dc_cases(external_case_no);

-- Immutable event log for each document processed per case
CREATE TABLE IF NOT EXISTS dc_events (
	id                     TEXT PRIMARY KEY,
	case_id                TEXT NOT NULL REFERENCES dc_cases(id) ON DELETE CASCADE,
	date                   TEXT NOT NULL,
	source_email_id        TEXT NOT NULL,
	source_attachment_id   TEXT,
	source_file_name       TEXT,
	kind                   TEXT NOT NULL DEFAULT 'unknown',
	creditor               TEXT,
	external_case_no       TEXT,
	invoice_nos_json       TEXT NOT NULL DEFAULT '[]',
	amounts_json           TEXT NOT NULL DEFAULT '{}',
	deadline               TEXT,
	raw_text_hash          TEXT,
	extracted_text_preview TEXT,
	created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dc_events_case   ON dc_events(case_id);
CREATE INDEX IF NOT EXISTS idx_dc_events_date   ON dc_events(date);
CREATE INDEX IF NOT EXISTS idx_dc_events_source ON dc_events(source_email_id);
`,
	},
	{
		name: "debt_control_004_collector_profiles",
		sql: `
CREATE TABLE IF NOT EXISTS dc_collector_profiles (
	id                    TEXT PRIMARY KEY,
	mailbox_id            TEXT NOT NULL,
	name                  TEXT NOT NULL,
	org_no                TEXT,
	portal_domains_json   TEXT NOT NULL DEFAULT '[]',
	payment_accounts_json TEXT NOT NULL DEFAULT '[]',
	known_emails_json     TEXT NOT NULL DEFAULT '[]',
	fingerprints_json     TEXT NOT NULL DEFAULT '[]',
	strategy_notes_json   TEXT NOT NULL DEFAULT '[]',
	updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
	created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS dc_collector_profiles_name ON dc_collector_profiles(mailbox_id, name);
		`,
	},
	// NOTE: Each ADD COLUMN is a separate migration because:
	// 1. SQLite does not support "ALTER TABLE ... ADD COLUMN IF NOT EXISTS"
	// 2. The migration runner tracks by name, making each individually idempotent
	{
		name: "debt_control_002_add_auto_draft_objection",
		sql: `ALTER TABLE dc_settings ADD COLUMN auto_draft_objection INTEGER NOT NULL DEFAULT 0;`,
	},
	{
		name: "debt_control_002_add_auto_draft_info_request",
		sql: `ALTER TABLE dc_settings ADD COLUMN auto_draft_info_request INTEGER NOT NULL DEFAULT 0;`,
	},
	{
		name: "debt_control_002_add_enable_legality_check",
		sql: `ALTER TABLE dc_settings ADD COLUMN enable_legality_check INTEGER NOT NULL DEFAULT 1;`,
	},
	{
		name: "debt_control_002_add_short_deadline_days",
		sql: `ALTER TABLE dc_settings ADD COLUMN short_deadline_days INTEGER NOT NULL DEFAULT 7;`,
	},
	{
		name: "debt_control_002_add_high_value_threshold_nok",
		sql: `ALTER TABLE dc_settings ADD COLUMN high_value_threshold_nok INTEGER NOT NULL DEFAULT 10000;`,
	},
	{
		name: "debt_control_002_add_auto_escalate_court_letters",
		sql: `ALTER TABLE dc_settings ADD COLUMN auto_escalate_court_letters INTEGER NOT NULL DEFAULT 1;`,
	},
];
