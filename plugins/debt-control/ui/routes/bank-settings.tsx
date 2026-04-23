import { useParams } from "react-router";
import { useBankStatus, useTestBankConnection, useTriggerSync } from "../queries";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
	ok:             { label: "Tilkoblet",         color: "text-green-700 bg-green-50" },
	configured:     { label: "Konfigurert",       color: "text-blue-600 bg-blue-50" },
	failed:         { label: "Feil",              color: "text-red-600 bg-red-50" },
	not_configured: { label: "Ikke konfigurert",  color: "text-gray-500 bg-gray-50" },
};

export default function BankSettings() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { data: status } = useBankStatus(mailboxId);
	const testConn = useTestBankConnection(mailboxId!);
	const syncNow  = useTriggerSync(mailboxId!);

	const badge = status ? STATUS_LABELS[status.status] : null;

	return (
		<div className="p-6 max-w-xl mx-auto space-y-6">
			<h1 className="text-xl font-semibold text-gray-900">Bankinnstillinger</h1>

			<div className="bg-white border rounded-xl p-5 space-y-4">
				<div className="flex items-center justify-between">
					<span className="text-sm text-gray-700">Provider</span>
					<span className="text-sm font-medium capitalize">{status?.provider ?? "—"}</span>
				</div>
				<div className="flex items-center justify-between">
					<span className="text-sm text-gray-700">Status</span>
					{badge && (
						<span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.color}`}>
							{badge.label}
						</span>
					)}
				</div>
				{status?.lastSync && (
					<div className="flex items-center justify-between">
						<span className="text-sm text-gray-400">Sist synkronisert</span>
						<span className="text-sm text-gray-700">
							{new Date(status.lastSync).toLocaleString("nb-NO")}
						</span>
					</div>
				)}
				{status?.message && (
					<p className="text-xs text-gray-400 border-t pt-3">{status.message}</p>
				)}
			</div>

			{/* Secrets info */}
			<div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
				<p className="font-medium mb-1">API-nøkler</p>
				<p className="text-xs leading-relaxed">
					Banknøkler (SB1_CLIENT_ID, SB1_ACCESS_TOKEN) lagres som Cloudflare Worker secrets.
					De settes via <code className="font-mono bg-yellow-100 px-1 rounded">wrangler secret put</code> og
					eksponeres aldri til frontend eller lokal lagring.
				</p>
			</div>

			<div className="flex gap-3">
				<button
					type="button"
					disabled={testConn.isPending}
					onClick={() => testConn.mutate()}
					className="flex-1 rounded-lg bg-white border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
				>
					{testConn.isPending ? "Tester…" : "Test tilkobling"}
				</button>
				<button
					type="button"
					disabled={syncNow.isPending || status?.provider === "none" || !status?.provider}
					onClick={() => syncNow.mutate()}
					className="flex-1 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
				>
					{syncNow.isPending ? "Synkroniserer…" : "Synk nå"}
				</button>
			</div>

			{testConn.data && (
				<p className={`text-sm ${testConn.data.status === "ok" ? "text-green-700" : "text-red-600"}`}>
					{testConn.data.message ?? testConn.data.status}
				</p>
			)}
			{syncNow.data && (
				<p className="text-sm text-green-700">
					Synk fullført: {syncNow.data.imported} nye transaksjoner importert.
				</p>
			)}
		</div>
	);
}
