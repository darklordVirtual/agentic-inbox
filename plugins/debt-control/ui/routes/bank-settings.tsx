import { Badge, Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import {
	BankIcon,
	ArrowsClockwiseIcon,
	CheckCircleIcon,
	WarningCircleIcon,
	SpinnerGapIcon,
	LockIcon,
	InfoIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import {
	useBankStatus,
	useTestBankConnection,
	useTriggerSync,
	useDebtSettings,
	useUpdateDebtSettings,
} from "../queries";

const STATUS_META: Record<string, { label: string; variant: "success" | "error" | "secondary" | "warning" }> = {
	ok:             { label: "Tilkoblet",        variant: "success" },
	configured:     { label: "Konfigurert",      variant: "secondary" },
	failed:         { label: "Feil",             variant: "error" },
	not_configured: { label: "Ikke konfigurert", variant: "secondary" },
};

export default function BankSettings() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager   = useKumoToastManager();
	const { data: status, refetch } = useBankStatus(mailboxId);
	const { data: settings }        = useDebtSettings(mailboxId);
	const updateSettings = useUpdateDebtSettings(mailboxId!);
	const testConn       = useTestBankConnection(mailboxId!);
	const syncNow        = useTriggerSync(mailboxId!);

	const [accountId, setAccountId] = useState(
		(status as any)?.accountId ?? ""
	);

	const statusMeta = status ? STATUS_META[status.status] ?? STATUS_META.not_configured : null;
	const isSparebank1 = settings?.bankProvider === "sparebank1";
	const isCsv        = settings?.bankProvider === "csv";
	const isNone       = !settings?.bankProvider || settings.bankProvider === "none";

	const handleSaveAccountId = () => {
		updateSettings.mutate({ bankProvider: "sparebank1" } as any, {
			onSuccess: async () => {
				await refetch();
				toastManager.add({ title: "Konto-ID lagret" });
			},
		});
	};

	const handleTest = async () => {
		try {
			await testConn.mutateAsync();
			toastManager.add({ title: testConn.data?.status === "ok" ? "Tilkobling OK" : "Test fullført" });
		} catch {
			toastManager.add({ title: "Tilkoblingstest feilet", variant: "error" });
		}
	};

	const handleSync = async () => {
		try {
			const result = await syncNow.mutateAsync();
			toastManager.add({ title: `Synk fullført: ${result.imported} nye transaksjoner` });
		} catch {
			toastManager.add({ title: "Synkronisering feilet", variant: "error" });
		}
	};

	return (
		<div className="max-w-2xl mx-auto py-10 px-6 space-y-8">
			<div>
				<h1 className="text-2xl font-bold text-kumo-default flex items-center gap-2">
					<BankIcon size={24} />
					Bankinnstillinger
				</h1>
				<p className="text-sm text-kumo-subtle mt-1">
					Administrer bankintegrasjon og synkronisering av transaksjoner.
				</p>
			</div>

			{/* Status card */}
			<div className="border border-kumo-line rounded-lg overflow-hidden">
				<div className="px-4 py-3 bg-kumo-tint border-b border-kumo-line">
					<span className="text-sm font-medium text-kumo-default">Tilkoblingsstatus</span>
				</div>
				<div className="divide-y divide-kumo-line">
					<div className="flex items-center justify-between px-4 py-3 bg-kumo-surface">
						<span className="text-sm text-kumo-subtle">Provider</span>
						<span className="text-sm font-medium text-kumo-default capitalize">
							{status?.provider ?? "—"}
						</span>
					</div>
					<div className="flex items-center justify-between px-4 py-3 bg-kumo-surface">
						<span className="text-sm text-kumo-subtle">Status</span>
						{statusMeta ? (
							<Badge variant={statusMeta.variant} className="text-xs">{statusMeta.label}</Badge>
						) : (
							<span className="text-kumo-subtle text-sm">—</span>
						)}
					</div>
					{status?.lastSync && (
						<div className="flex items-center justify-between px-4 py-3 bg-kumo-surface">
							<span className="text-sm text-kumo-subtle">Sist synkronisert</span>
							<span className="text-sm text-kumo-default">
								{new Date(status.lastSync).toLocaleString("nb-NO")}
							</span>
						</div>
					)}
					{status?.message && (
						<div className="px-4 py-3 bg-kumo-surface">
							<p className="text-xs text-kumo-subtle">{status.message}</p>
						</div>
					)}
				</div>
			</div>

			{/* SpareBank 1 configuration */}
			{isSparebank1 && (
				<div className="border border-kumo-line rounded-lg overflow-hidden">
					<div className="px-4 py-3 bg-kumo-tint border-b border-kumo-line flex items-center gap-2">
						<span className="text-sm font-medium text-kumo-default">SpareBank 1 — Konfigurasjon</span>
					</div>
					<div className="px-4 py-5 bg-kumo-surface space-y-4">
						{/* Account ID */}
						<div>
							<label className="text-sm font-medium text-kumo-default block mb-1">Konto-ID</label>
							<p className="text-xs text-kumo-subtle mb-2">
								Din SpareBank 1-konto-ID for transaksjonsoppslag (f.eks. <code className="font-mono bg-kumo-fill px-1 rounded">12345678901</code>).
							</p>
							<div className="flex gap-2">
								<Input
									value={accountId}
									onChange={(e) => setAccountId(e.target.value)}
									placeholder="Kontonummer (11 siffer)"
									className="font-mono"
								/>
								<Button
									variant="primary"
									size="sm"
									onClick={handleSaveAccountId}
									disabled={!accountId.trim() || updateSettings.isPending}
								>
									Lagre
								</Button>
							</div>
						</div>

						{/* Secrets info */}
						<div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
							<p className="font-medium flex items-center gap-1.5 mb-2">
								<LockIcon size={14} />
								API-hemmeligheter (Worker Secrets)
							</p>
							<p className="text-xs leading-relaxed mb-2">
								Banknøkler lagres som Cloudflare Worker secrets og eksponeres aldri til frontend.
								Sett dem med disse kommandoene:
							</p>
							<div className="space-y-1">
								<code className="block bg-amber-100 px-2 py-1 rounded font-mono text-xs">
									wrangler secret put SB1_CLIENT_ID
								</code>
								<code className="block bg-amber-100 px-2 py-1 rounded font-mono text-xs">
									wrangler secret put SB1_ACCESS_TOKEN
								</code>
							</div>
							<p className="text-xs mt-2">
								Se <em>deployment-recipes/sparebank1-setup.md</em> for full oppsettguide.
							</p>
						</div>
					</div>
				</div>
			)}

			{/* CSV info */}
			{isCsv && (
				<div className="rounded-lg border border-kumo-line bg-kumo-tint p-4">
					<p className="text-sm font-medium text-kumo-default flex items-center gap-1.5 mb-2">
						<InfoIcon size={14} />
						CSV-import
					</p>
					<p className="text-xs text-kumo-subtle leading-relaxed">
						Last opp CSV-filer via synkroniseringsknappen nedenfor. Forventet format:
						<code className="block font-mono bg-kumo-fill px-2 py-1 rounded mt-2 text-kumo-default">
							date,description,amount,balance,reference
						</code>
					</p>
				</div>
			)}

			{/* Not configured */}
			{isNone && (
				<div className="rounded-lg border border-kumo-line bg-kumo-tint p-4 text-sm text-kumo-subtle text-center">
					Ingen bankprovider konfigurert. Velg en provider under <em>Innstillinger</em>-fanen.
				</div>
			)}

			{/* Actions */}
			{!isNone && (
				<div className="flex gap-3">
					<Button
						variant="secondary"
						className="flex-1"
						icon={testConn.isPending ? <SpinnerGapIcon size={14} className="animate-spin" /> : <CheckCircleIcon size={14} />}
						onClick={handleTest}
						disabled={testConn.isPending}
					>
						{testConn.isPending ? "Tester…" : "Test tilkobling"}
					</Button>
					<Button
						variant="primary"
						className="flex-1"
						icon={syncNow.isPending ? <SpinnerGapIcon size={14} className="animate-spin" /> : <ArrowsClockwiseIcon size={14} />}
						onClick={handleSync}
						disabled={syncNow.isPending || isCsv}
					>
						{syncNow.isPending ? "Synkroniserer…" : "Synk nå"}
					</Button>
				</div>
			)}

			{/* Inline result feedback */}
			{testConn.data && (
				<div className={`flex items-center gap-1.5 text-sm ${testConn.data.status === "ok" ? "text-emerald-700" : "text-red-600"}`}>
					{testConn.data.status === "ok" ? <CheckCircleIcon size={14} /> : <WarningCircleIcon size={14} />}
					{testConn.data.message ?? testConn.data.status}
				</div>
			)}
		</div>
	);
}

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
