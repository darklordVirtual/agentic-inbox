import { Badge, Button, useKumoToastManager } from "@cloudflare/kumo";
import {
ArrowsClockwiseIcon,
BankIcon,
CheckCircleIcon,
FileCsvIcon,
LockIcon,
SpinnerGapIcon,
UploadSimpleIcon,
WarningCircleIcon,
XCircleIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import {
useBankAccounts,
useBankStatus,
useDebtSettings,
useTestBankConnection,
useTriggerSync,
useUpdateDebtSettings,
useUploadCsvStatement,
} from "../queries";

// ── SpareBank 1 logo ─────────────────────────────────────────────
// SVG inline to avoid any image-hosting dependency.
function SB1Logo({ size = 28 }: { size?: number }) {
return (
<svg width={size * 2.8} height={size} viewBox="0 0 112 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="SpareBank 1">
{/* Red square badge */}
<rect width="40" height="40" rx="6" fill="#E3001B" />
{/* "1" numeral */}
<text x="20" y="30" textAnchor="middle" fontSize="24" fontWeight="700" fill="white" fontFamily="system-ui,sans-serif">1</text>
{/* Wordmark */}
<text x="48" y="14" fontSize="9" fontWeight="700" fill="#1a1a1a" fontFamily="system-ui,sans-serif">SpareBank</text>
<text x="48" y="28" fontSize="11" fontWeight="400" fill="#555" fontFamily="system-ui,sans-serif">integrasjon</text>
</svg>
);
}

// ── Provider option card ─────────────────────────────────────────
type ProviderValue = "sparebank1" | "csv" | "none";

function ProviderCard({
value,
current,
icon,
title,
description,
badge,
onSelect,
}: {
value: ProviderValue;
current: ProviderValue;
icon: React.ReactNode;
title: React.ReactNode;
description: string;
badge?: React.ReactNode;
onSelect: (v: ProviderValue) => void;
}) {
const selected = value === current;
return (
<button
type="button"
onClick={() => onSelect(value)}
className={`w-full text-left rounded-xl border-2 px-4 py-4 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand ${
selected
? "border-kumo-brand bg-kumo-brand/5"
: "border-kumo-line bg-kumo-surface hover:border-kumo-brand/40"
}`}
>
<div className="flex items-start gap-3">
<div className="mt-0.5 shrink-0">{icon}</div>
<div className="flex-1 min-w-0">
<div className="flex items-center gap-2">
<span className="text-sm font-semibold text-kumo-default">{title}</span>
{badge}
{selected && (
<span className="ml-auto shrink-0">
<CheckCircleIcon size={16} weight="fill" className="text-kumo-brand" />
</span>
)}
</div>
<p className="text-xs text-kumo-subtle mt-0.5 leading-relaxed">{description}</p>
</div>
</div>
</button>
);
}

// ── SB1 config panel ─────────────────────────────────────────────
function SpareBank1Config({ mailboxId }: { mailboxId: string }) {
const toastManager  = useKumoToastManager();
const { data: status, refetch } = useBankStatus(mailboxId);
const { data: accounts, isLoading: accountsLoading, refetch: refetchAccounts } = useBankAccounts(mailboxId);
const testConn  = useTestBankConnection(mailboxId);
const syncNow   = useTriggerSync(mailboxId);
const updateSettings = useUpdateDebtSettings(mailboxId);

const [selectedAccount, setSelectedAccount] = useState<string>("");

const handleTest = async () => {
try {
const result = await testConn.mutateAsync();
if (result.status === "ok") {
toastManager.add({ title: "Tilkobling vellykket!" });
refetchAccounts();
} else {
toastManager.add({ title: result.message ?? "Test mislyktes", variant: "error" });
}
} catch {
toastManager.add({ title: "Tilkoblingstest feilet", variant: "error" });
}
};

const handleSync = async () => {
try {
const result = await syncNow.mutateAsync();
toastManager.add({ title: `Synk fullført: ${result.imported} nye transaksjoner` });
refetch();
} catch {
toastManager.add({ title: "Synkronisering feilet", variant: "error" });
}
};

const handleSelectAccount = () => {
if (!selectedAccount) return;
updateSettings.mutate({ bankProvider: "sparebank1" } as any, {
onSuccess: () => toastManager.add({ title: "Konto valgt" }),
});
};

const secretsOk = status?.status === "ok" || status?.status === "configured";

return (
<div className="space-y-5">
{/* Brand header */}
<div className="flex items-center justify-between">
<SB1Logo size={26} />
{status?.status && (
<Badge
variant={status.status === "ok" ? "success" : status.status === "failed" ? "destructive" : "secondary"}
className="text-xs"
>
{status.status === "ok" ? "Tilkoblet" : status.status === "failed" ? "Feil" : "Konfigurert"}
</Badge>
)}
</div>

{/* Secrets setup box */}
<div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
<p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
<LockIcon size={13} weight="fill" />
API-hemmeligheter (Worker Secrets)
</p>
<p className="text-xs text-amber-800 leading-relaxed">
SpareBank 1-nøklene lagres som Cloudflare Worker secrets — aldri i databasen
eller eksponert til frontend. Sett dem én gang med:
</p>
<div className="space-y-1">
<code className="block bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg font-mono text-[11px] text-amber-900">
wrangler secret put SB1_CLIENT_ID
</code>
<code className="block bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg font-mono text-[11px] text-amber-900">
wrangler secret put SB1_ACCESS_TOKEN
</code>
</div>
<p className="text-[11px] text-amber-700">
Hent Client ID og Access Token fra{" "}
<a
href="https://developer.sparebank1.no"
target="_blank"
rel="noopener noreferrer"
className="underline font-medium"
>
developer.sparebank1.no
</a>
{" "}→ Opprett applikasjon → scope: <code className="font-mono bg-amber-100 px-1 rounded">personal.transaction.read</code>
</p>
</div>

{/* Test connection */}
<Button
variant="secondary"
size="sm"
icon={testConn.isPending
? <SpinnerGapIcon size={14} className="animate-spin" />
: status?.status === "ok" ? <CheckCircleIcon size={14} className="text-emerald-600" /> : undefined}
onClick={handleTest}
disabled={testConn.isPending}
className="w-full"
>
{testConn.isPending ? "Tester tilkobling…" : "Test tilkobling"}
</Button>

{testConn.data && (
<div className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-2 ${
testConn.data.status === "ok"
? "bg-emerald-50 text-emerald-800 border border-emerald-200"
: "bg-red-50 text-red-800 border border-red-200"
}`}>
{testConn.data.status === "ok"
? <CheckCircleIcon size={13} weight="fill" />
: <XCircleIcon size={13} weight="fill" />}
{testConn.data.message ?? (testConn.data.status === "ok" ? "Tilkobling OK" : "Tilkobling feilet")}
</div>
)}

{/* Account picker */}
{secretsOk && (
<div className="space-y-2">
<label className="text-xs font-semibold text-kumo-default block">Velg konto å synkronisere</label>
{accountsLoading ? (
<div className="flex items-center gap-1.5 text-xs text-kumo-subtle py-2">
<SpinnerGapIcon size={12} className="animate-spin" />
Henter kontoer…
</div>
) : accounts?.accounts?.length ? (
<div className="space-y-1.5">
<div className="rounded-lg border border-kumo-line divide-y divide-kumo-line overflow-hidden">
{accounts.accounts.map((acc) => (
<label
key={acc.accountId}
className={`flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
selectedAccount === acc.accountId ? "bg-kumo-brand/5" : "bg-kumo-surface hover:bg-kumo-tint"
}`}
>
<div className="flex items-center gap-2.5">
<input
type="radio"
name="account"
value={acc.accountId}
checked={selectedAccount === acc.accountId}
onChange={() => setSelectedAccount(acc.accountId)}
className="accent-[#E3001B]"
/>
<div>
<p className="text-xs font-medium text-kumo-default">{acc.name}</p>
{acc.accountNumber && (
<p className="text-[11px] text-kumo-subtle font-mono">{acc.accountNumber}</p>
)}
</div>
</div>
{acc.balance !== undefined && (
<span className="text-xs font-medium text-kumo-default shrink-0">
{acc.balance.toLocaleString("nb-NO")} {acc.currency}
</span>
)}
</label>
))}
</div>
<Button
variant="primary"
size="sm"
onClick={handleSelectAccount}
disabled={!selectedAccount || updateSettings.isPending}
className="w-full"
>
Bruk valgt konto
</Button>
</div>
) : (
<p className="text-xs text-kumo-subtle">
Ingen kontoer funnet. Test tilkoblingen ovenfor for å hente kontoer.
</p>
)}
</div>
)}

{/* Sync button */}
{secretsOk && (
<>
<div className="border-t border-kumo-line" />
<Button
variant="primary"
icon={syncNow.isPending
? <SpinnerGapIcon size={14} className="animate-spin" />
: <ArrowsClockwiseIcon size={14} />}
onClick={handleSync}
disabled={syncNow.isPending}
className="w-full"
style={{ backgroundColor: "#E3001B", borderColor: "#E3001B" }}
>
{syncNow.isPending ? "Synkroniserer…" : "Synk transaksjoner nå"}
</Button>
{status?.lastSync && (
<p className="text-[11px] text-kumo-subtle text-center">
Sist synkronisert: {new Date(status.lastSync).toLocaleString("nb-NO")}
</p>
)}
</>
)}
</div>
);
}

// ── CSV upload panel ─────────────────────────────────────────────
function CsvUploadPanel({ mailboxId }: { mailboxId: string }) {
const toastManager = useKumoToastManager();
const uploadCsv    = useUploadCsvStatement(mailboxId);
const fileRef      = useRef<HTMLInputElement>(null);
const [dragOver, setDragOver]   = useState(false);
const [lastFile, setLastFile]   = useState<string | null>(null);

const handleFile = async (file: File) => {
if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
toastManager.add({ title: "Kun CSV-filer støttes", variant: "error" });
return;
}
setLastFile(file.name);
try {
const result = await uploadCsv.mutateAsync(file);
toastManager.add({ title: `Lastet opp: ${result.imported} nye transaksjoner (${result.total} totalt)` });
} catch {
toastManager.add({ title: "Opplasting feilet — sjekk filformat", variant: "error" });
}
};

return (
<div className="space-y-4">
<p className="text-xs text-kumo-subtle leading-relaxed">
Last opp en kontoutskrift fra din bank som CSV-fil. Transaksjoner importeres og
kobles automatisk mot gjeldssaker. Du kan laste opp på nytt når som helst — duplikater
filtreres bort automatisk.
</p>

{/* Drop zone */}
<div
onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
onDragLeave={() => setDragOver(false)}
onDrop={(e) => {
e.preventDefault();
setDragOver(false);
const file = e.dataTransfer.files[0];
if (file) handleFile(file);
}}
onClick={() => fileRef.current?.click()}
className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors ${
dragOver
? "border-kumo-brand bg-kumo-brand/5"
: "border-kumo-line bg-kumo-recessed hover:border-kumo-brand/50 hover:bg-kumo-tint"
}`}
>
<input
ref={fileRef}
type="file"
accept=".csv,text/csv"
className="hidden"
onChange={(e) => {
const file = e.target.files?.[0];
if (file) handleFile(file);
e.target.value = "";
}}
/>
{uploadCsv.isPending ? (
<SpinnerGapIcon size={28} className="animate-spin text-kumo-brand" />
) : (
<UploadSimpleIcon size={28} className="text-kumo-subtle" />
)}
<div className="text-center">
<p className="text-sm font-medium text-kumo-default">
{uploadCsv.isPending ? "Laster opp…" : "Slipp CSV-fil her"}
</p>
<p className="text-xs text-kumo-subtle mt-0.5">
eller <span className="text-kumo-brand underline">velg fil</span>
</p>
</div>
</div>

{/* Last upload result */}
{lastFile && uploadCsv.isSuccess && (
<div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
<FileCsvIcon size={14} className="text-emerald-600 shrink-0" />
<div className="min-w-0 flex-1">
<p className="text-xs font-medium text-emerald-800 truncate">{lastFile}</p>
<p className="text-[11px] text-emerald-700">
{uploadCsv.data.imported} nye · {uploadCsv.data.total} totalt
</p>
</div>
<CheckCircleIcon size={14} weight="fill" className="text-emerald-600 shrink-0" />
</div>
)}

{uploadCsv.isError && (
<div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
<WarningCircleIcon size={14} weight="fill" className="text-red-500 shrink-0" />
<p className="text-xs text-red-800">
{(uploadCsv.error as Error)?.message ?? "Opplasting feilet. Sjekk filformat."}
</p>
</div>
)}

{/* Format hint */}
<div className="rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-3 space-y-1">
<p className="text-[11px] font-semibold text-kumo-default mb-1.5">Støttede CSV-kolonner</p>
<code className="block font-mono text-[10px] text-kumo-subtle leading-relaxed">
dato;beskrivelse;beløp;valuta;referanse
</code>
<code className="block font-mono text-[10px] text-kumo-subtle leading-relaxed">
date;description;amount;currency;reference
</code>
<p className="text-[11px] text-kumo-subtle mt-1.5">
Norsk desimalformat (1.234,56) og datoformat DD.MM.YYYY støttes.
Kolonnenavn er ikke case-sensitive.
</p>
</div>
</div>
);
}

// ── Main page ────────────────────────────────────────────────────
export default function BankSettings() {
const { mailboxId } = useParams<{ mailboxId: string }>();
const toastManager  = useKumoToastManager();
const { data: settings } = useDebtSettings(mailboxId);
const updateSettings     = useUpdateDebtSettings(mailboxId!);

const provider = (settings?.bankProvider ?? "none") as ProviderValue;

const handleSelectProvider = (value: ProviderValue) => {
updateSettings.mutate({ bankProvider: value } as any, {
onSuccess: () => {
if (value !== "none") {
toastManager.add({ title: `Byttet til ${value === "sparebank1" ? "SpareBank 1" : "CSV-import"}` });
}
},
});
};

return (
<div className="h-full overflow-y-auto">
<div className="max-w-2xl mx-auto py-10 px-6 space-y-8">

{/* Header */}
<div>
<h1 className="text-2xl font-bold text-kumo-default flex items-center gap-2">
<BankIcon size={22} />
Bankintegrasjon
</h1>
<p className="text-sm text-kumo-subtle mt-1">
Koble til banken din for automatisk betalingsavstемming — valgfritt. Du kan også bruke CSV-kontoutskrift eller hoppe over dette steget helt.
</p>
</div>

{/* Provider selector */}
<section className="space-y-3">
<h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
Velg transaksjonskilde
</h2>
<div className="space-y-2.5">
<ProviderCard
value="sparebank1"
current={provider}
icon={
<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E3001B]/10">
<span className="text-sm font-bold text-[#E3001B]">SB1</span>
</div>
}
title={<span className="flex items-center gap-1.5">SpareBank 1 <span className="font-normal text-kumo-subtle text-xs">API</span></span>}
description="Koble direkte til SpareBank 1 via API. Transaksjoner synkroniseres automatisk."
badge={<Badge variant="success" className="text-[10px]">Anbefalt</Badge>}
onSelect={handleSelectProvider}
/>
<ProviderCard
value="csv"
current={provider}
icon={
<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-kumo-tint border border-kumo-line">
<FileCsvIcon size={18} className="text-kumo-subtle" />
</div>
}
title="Kontoutskrift (CSV)"
description="Last opp CSV-fil fra hvilken som helst bank. Ingen API-nøkler nødvendig."
onSelect={handleSelectProvider}
/>
<ProviderCard
value="none"
current={provider}
icon={
<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-kumo-tint border border-kumo-line">
<XCircleIcon size={18} className="text-kumo-subtle" />
</div>
}
title="Ingen bankintegrasjon"
description="Hopp over bankkobling. Du kan fortsatt opprette og behandle gjeldssaker manuelt."
onSelect={handleSelectProvider}
/>
</div>
</section>

{/* Provider-specific config */}
{provider === "sparebank1" && mailboxId && (
<section className="space-y-3">
<h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
SpareBank 1 — oppsett
</h2>
<div className="rounded-xl border-2 border-[#E3001B]/20 bg-kumo-surface p-5">
<SpareBank1Config mailboxId={mailboxId} />
</div>
</section>
)}

{provider === "csv" && mailboxId && (
<section className="space-y-3">
<h2 className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
Last opp kontoutskrift
</h2>
<div className="rounded-xl border border-kumo-line bg-kumo-surface p-5">
<CsvUploadPanel mailboxId={mailboxId} />
</div>
</section>
)}

{provider === "none" && (
<div className="rounded-xl border border-dashed border-kumo-line bg-kumo-recessed px-5 py-8 text-center space-y-1.5">
<p className="text-sm font-medium text-kumo-default">Ingen bankintegrasjon aktiv</p>
<p className="text-xs text-kumo-subtle">
Velg SpareBank 1 eller CSV-import ovenfor for å aktivere automatisk betalingsavstемming.
</p>
</div>
)}

</div>
</div>
);
}
