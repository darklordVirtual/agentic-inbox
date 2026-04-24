# Gjeldskontroll

> **Beregnet for norske privatkunder.**
>
> Gjeldskontroll er en plugin for Agentic Inbox som hjelper privatpersoner med å håndtere
> innkommende inkassokrav og fakturaer på e-post — spesielt integrert med SpareBank 1 sitt
> Open API for automatisk betalingsavstемming og prioritering av utestående krav.

---

## Hva gjør plugin-en?

| Funksjon | Beskrivelse |
|---|---|
| **Automatisk klassifisering** | Klassifiserer innkommende e-post som inkassokrav, faktura, purring eller betalingsvarsel |
| **Sjekk om betalt** | Kobler kravet mot banktransaksjoner og markerer det som betalt dersom en matchende utbetaling finnes |
| **Prioritering etter saldo** | Rangerer ubetalte krav etter tilgjengelig banksaldo — høyest prioritet til krav med nærmest forfallsdato som saldoen dekker |
| **Innsigelsesmaler** | Ferdigskrevne norske svarmal for allerede betalt, manglende grunnlag, gebyrklage m.m. |
| **CSV-kontoutskrift** | Alternativ til direkte bankintegrasjon — last opp CSV-fil fra hvilken som helst norsk bank |

---

## Norsk regelverk

Plugin-en er utviklet med tanke på norsk lovgivning for privatkunder:

- **Inkassoloven (lov av 13. mai 1988 nr. 26)** — krav om saklig grunn, varslingsfrister og maksimalgebyr
- **Finansavtaleloven** — rettigheter ved gjeldspostering og klageadgang
- **Forsinkelsesrenteloven** — automatisk beregning av lovlig forsinkelsesrente (p.t. Norges Banks foliorente + 8 pp)
- **Personopplysningsloven / GDPR** — all data lagres lokalt i din Cloudflare Durable Object; ingen kredittsensitiv informasjon sendes til tredjepart

---

## SpareBank 1 Open API

Direkte bankintegrasjon bruker [SpareBank 1 sitt Open API](https://www.sparebank1.no/nb/bank/bedrift/open-api.html).

### Slik skaffer du API-nøkler

1. Gå til **[sparebank1.no → Bedrift → Open Banking API](https://www.sparebank1.no/nb/bank/bedrift/open-api.html)**
2. Logg inn med BankID
3. Opprett en ny applikasjon
4. Velg scope: `personal.transaction.read` og `personal.account.read`
5. Kopier **Client ID** og generer et **Access Token**

> **Merk:** Selv om siden er merket "bedrift", utstedes nøkler også til privatpersoner som ønsker
> programmatisk tilgang til egne kontoer.

### Konfigurere nøklene

Nøklene lagres som Cloudflare Worker secrets — de lagres **aldri** i databasen eller eksponeres
til nettleseren.

```bash
wrangler secret put SB1_CLIENT_ID
wrangler secret put SB1_ACCESS_TOKEN
```

### API-endepunkter som brukes

| Endepunkt | Formål |
|---|---|
| `GET /personal/banking/accounts` | Liste kontoer og hente tilgjengelig saldo |
| `GET /personal/banking/accounts/{id}` | Kontodetajer inkl. saldo |
| `GET /personal/banking/transactions` | Hente transaksjoner for betalingsavstемming |
| `GET /personal/banking/transactions/classified` | Klassifiserte transaksjoner (kategori fra SB1) |

Alle kall går via Workers-backend og bruker HTTPS. Ingen nøkler sendes til klienten.

---

## Alternativ: CSV-kontoutskrift

Dersom du ikke ønsker direkte bankintegrasjon kan du laste opp en kontoutskrift som CSV-fil.
Dette fungerer med alle norske banker (DNB, Nordea, Handelsbanken, Sbanken osv.) — formater
varierer, men følgende kolonner støttes:

```
dato;beskrivelse;beløp;valuta;referanse
date;description;amount;currency;reference
```

Datoformat `DD.MM.YYYY` og norsk desimalformat (`1.234,56`) støttes automatisk.
Duplikattransaksjoner filtreres bort ved re-opplasting.

---

## Oppsett

### 1. Installer plugin-en

Plugin-en er inkludert i Agentic Inbox. Aktiver den under **Innstillinger → Plugins → Gjeldskontroll**.

### 2. Velg banktilkobling

Gå til **Gjeldskontroll → Bankinnstillinger** og velg én av:

- **SpareBank 1 API** — krever API-nøkler (se over)
- **CSV-opplasting** — last opp kontoutskrift manuelt
- **Ingen** — manuell saksbehandling uten bankdata

### 3. Test tilkoblingen

Trykk «Test tilkobling» for å verifisere at nøklene fungerer og at kontoer hentes korrekt.

### 4. Synkroniser transaksjoner

Trykk «Synk nå» for å hente siste transaksjoner. Automatisk synk kjøres også ved mottak av
ny e-post som klassifiseres som krav (konfigurerbart).

---

## Personvern og datasikkerhet

- **Ingen data forlater din instans** — all prosessering skjer i din Cloudflare Workers-instans
- **API-nøkler** lagres kryptert som Worker secrets (Cloudflare KMS)
- **Banktransaksjoner** lagres i din Durable Object (SQLite) — ikke i noen ekstern tjeneste
- **AI-klassifisering** bruker kun e-postemne og avsender for klassifisering — e-postinnhold
  sendes ikke til LLM uten eksplisitt brukerhandling

---

## Sakstyper og maler

Følgende innsigelsesmaler er tilgjengelige (norsk tekst, klar til sending):

| Mal | Brukstilfelle |
|---|---|
| `objection-already-paid` | Kravet er allerede betalt |
| `objection-missing-basis` | Manglende fakturagrunnlag / ukjent krav |
| `objection-fees` | Ulovlig høye inkassogebyr |
| `objection-fragmentation` | Ulovlig oppsplitting av krav |
| `request-more-info` | Be om mer dokumentasjon før svar |

Malene er i `plugins/debt-control/recipes/` og kan redigeres fritt.
