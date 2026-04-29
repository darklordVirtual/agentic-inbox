PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legal_sources (
  source_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_weight INTEGER NOT NULL,
  js_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_weight INTEGER NOT NULL,
  effective_date TEXT,
  legal_area TEXT,
  citation_keys TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  raw_r2_key TEXT NOT NULL,
  normalized_r2_key TEXT NOT NULL,
  methodology_trace TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES legal_sources(source_id)
);

CREATE INDEX IF NOT EXISTS idx_source_documents_source_id ON source_documents(source_id);
CREATE INDEX IF NOT EXISTS idx_source_documents_hash ON source_documents(document_hash);
CREATE INDEX IF NOT EXISTS idx_source_documents_source_type ON source_documents(source_type);

CREATE TABLE IF NOT EXISTS authority_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_document_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_key TEXT,
  event_date TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_document_id) REFERENCES source_documents(id)
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source_status ON ingestion_jobs(source_id, status);
