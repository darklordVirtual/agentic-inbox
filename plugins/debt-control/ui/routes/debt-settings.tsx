import { Badge, Button, Select, Switch, useKumoToastManager } from "@cloudflare/kumo";
import {
	BankIcon,
	ToggleLeftIcon,
	SpinnerGapIcon,
} from "@phosphor-icons/react";
import { useParams } from "react-router";
import { useDebtSettings, useUpdateDebtSettings } from "../queries";
import type { PluginSettings } from "../../types";

export default function DebtSettings() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: settings, isLoading } = useDebtSettings(mailboxId);
	const update = useUpdateDebtSettings(mailboxId!);

	if (isLoading || !settings) {
		return (
			<div className="flex items-center gap-2 p-6 text-sm text-kumo-subtle">
				<SpinnerGapIcon size={16} className="animate-spin" />
				Laster innstillinger…
			</div>
		);
	}

	function toggle(key: keyof PluginSettings) {
		if (typeof settings![key] !== "boolean") return;
		update.mutate({ [key]: !settings![key] });
	}

	return (
		<div className="max-w-2xl mx-auto py-10 px-6 space-y-8">
			<div>
				<h1 className="text-2xl font-bold text-kumo-default flex items-center gap-2">
					<BankIcon size={24} />
					Debt Control — Innstillinger
				</h1>
				<p className="text-sm text-kumo-subtle mt-1">
					Konfigurer automatisert gjeldsbehandling og bankintegrasjon.
				</p>
			</div>

			{/* Generelt */}
			<section>
				<h2 className="text-base font-semibold text-kumo-default mb-4 flex items-center gap-2">
					<ToggleLeftIcon size={18} />
					Generelt
				</h2>
				<div className="divide-y divide-kumo-line border border-kumo-line rounded-lg overflow-hidden">
					<SettingRow
						label="Aktiver Debt Control"
						description="Slå av for å deaktivere all automatisk behandling."
						checked={settings.enabled}
						onChange={() => toggle("enabled")}
						disabled={update.isPending}
					/>
					<SettingRow
						label="Klassifiser innkommende e-poster automatisk"
						description="Kjør klassifiseringsmotor automatisk når en ny e-post ankommer."
						checked={settings.autoClassify}
						onChange={() => toggle("autoClassify")}
						disabled={update.isPending}
					/>
					<SettingRow
						label="Avstem automatisk etter banksynk"
						description="Match transaksjoner mot åpne saker etter en synkronisering."
						checked={settings.autoReconcile}
						onChange={() => toggle("autoReconcile")}
						disabled={update.isPending}
					/>
				</div>
			</section>

			{/* Bankintegrasjon */}
			<section>
				<h2 className="text-base font-semibold text-kumo-default mb-4 flex items-center gap-2">
					<BankIcon size={18} />
					Bankintegrasjon
				</h2>
				<div className="border border-kumo-line rounded-lg overflow-hidden">
					<div className="px-4 py-4 bg-kumo-surface">
						<label className="text-sm font-medium text-kumo-default block mb-2">Bankprovider</label>
						<Select
							value={settings.bankProvider}
							onValueChange={(v) => {
								if (v) update.mutate({ bankProvider: v as PluginSettings["bankProvider"] });
							}}
						>
							<Select.Option value="none">Ingen</Select.Option>
							<Select.Option value="sparebank1">SpareBank 1</Select.Option>
							<Select.Option value="csv">CSV-import</Select.Option>
						</Select>
						{settings.bankProvider === "sparebank1" && (
							<div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 space-y-1">
								<p className="font-medium">SpareBank 1 API-oppsett</p>
								<p>Konfigurer <strong>Konto-ID</strong> og tilkoblingstest under <em>Bankinnstillinger</em>-fanen.</p>
								<p>API-hemmeligheter (<code className="bg-blue-100 px-1 rounded">SB1_CLIENT_ID</code>, <code className="bg-blue-100 px-1 rounded">SB1_ACCESS_TOKEN</code>) settes via Cloudflare Worker secrets:</p>
								<code className="block bg-blue-100 px-2 py-1 rounded font-mono mt-1">
									wrangler secret put SB1_CLIENT_ID
								</code>
							</div>
						)}
						{settings.bankProvider === "csv" && (
							<div className="mt-3 rounded-lg bg-kumo-tint border border-kumo-line p-3 text-xs text-kumo-subtle">
								<p className="font-medium text-kumo-default">CSV-import</p>
								<p className="mt-1">Last opp CSV-filer med transaksjoner via bank-synkroniseringsfunksjonen. Kolonner: <code className="font-mono">date,description,amount,balance,reference</code></p>
							</div>
						)}
					</div>
				</div>
			</section>

			{update.isPending && (
				<div className="text-xs text-kumo-subtle flex items-center gap-1">
					<SpinnerGapIcon size={12} className="animate-spin" />
					Lagrer…
				</div>
			)}
		</div>
	);
}

function SettingRow({
	label,
	description,
	checked,
	onChange,
	disabled,
}: {
	label: string;
	description: string;
	checked: boolean;
	onChange: () => void;
	disabled?: boolean;
}) {
	return (
		<div className="flex items-center justify-between px-4 py-4 bg-kumo-surface gap-4">
			<div className="flex-1">
				<div className="text-sm font-medium text-kumo-default">{label}</div>
				<div className="text-xs text-kumo-subtle mt-0.5">{description}</div>
			</div>
			<Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
		</div>
	);
}
