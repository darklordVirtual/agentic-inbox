# Legal Ingestion TODO / Status

## P1 - stabile kilder + metodevekting
- [x] Kilder definert:
  - `https://www.domstol.no/no/hoyesterett/avgjorelser/`
  - `https://lovdata.no/register/loverNye`
  - `https://lovdata.no/register/forskrifterNye`
  - `https://publisering.finkn.no/areas/78`
- [x] Lagring i R2:
  - rå HTML (`legal-intel/raw/...`)
  - normalisert tekst (`legal-intel/normalized/...`)
- [x] Metadata til D1:
  - `source_type`, `source_weight`, `effective_date`, `legal_area`, `citation_keys`, `document_hash`

## P2 - juridisk metode i motoren
- [x] Fast kildevekting (100/100/90/80) i resolver (`sourceWeight`)
- [x] Consensus-regel:
  - lex superior (weight)
  - lex specialis (`specialis_score`)
  - lex posterior (`effective_date`)
- [x] Gating:
  - blokkerer `asserted_breach` dersom toppkilde < terskel eller `review_required=true`

## P3 - orchestrering + cache
- [x] Scheduled trigger hver 6. time
- [x] Queue-produsent/konsument (`LEGAL_INGEST_QUEUE`)
- [x] Cache-first analyse via R2-normalized docs
- [x] Delta-ingestion via SHA-256 hash sammenligning
- [ ] Browser Rendering for JS-kilder (FinKN/CURIA) - neste iterasjon

## Kritisk tillegg
- [x] Lovdata lisensnotat i `methodology_trace`
- [x] `methodology_trace` lagres per claim/document i D1

## Testbare MCP-verktøy
- `legal_ingestion_status`
- `legal_ingestion_queue_sources`
- `legal_ingestion_run_job`
- `dce_methodology_consensus`
