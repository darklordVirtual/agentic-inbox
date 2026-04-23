import { useParams } from "react-router";
import { useDebtSettings, useUpdateDebtSettings } from "../queries";
import type { PluginSettings } from "../../types";

export default function DebtSettings() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { data: settings, isLoading } = useDebtSettings(mailboxId);
	const update = useUpdateDebtSettings(mailboxId!);

	if (isLoading || !settings) {
		return <div className="p-6 text-sm text-gray-500">Laster innstillinger…</div>;
	}

	function toggle(key: keyof PluginSettings) {
		if (typeof settings![key] !== "boolean") return;
		update.mutate({ [key]: !settings![key] });
	}

	return (
		<div className="p-6 max-w-xl mx-auto space-y-6">
			<h1 className="text-xl font-semibold text-gray-900">Debt Control — innstillinger</h1>

			<Section title="Generelt">
				<Toggle
					label="Aktiver Debt Control"
					checked={settings.enabled}
					onChange={() => toggle("enabled")}
				/>
				<Toggle
					label="Klassifiser innkommende e-poster automatisk"
					checked={settings.autoClassify}
					onChange={() => toggle("autoClassify")}
				/>
				<Toggle
					label="Avstem automatisk etter banksynk"
					checked={settings.autoReconcile}
					onChange={() => toggle("autoReconcile")}
				/>
			</Section>

			<Section title="Bankintegrasjon">
				<div className="space-y-2">
					<label className="text-sm font-medium text-gray-700">Bankprovider</label>
					<select
						value={settings.bankProvider}
						onChange={(e) =>
							update.mutate({ bankProvider: e.target.value as PluginSettings["bankProvider"] })
						}
						className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					>
						<option value="none">Ingen</option>
						<option value="sparebank1">SpareBank 1</option>
						<option value="csv">CSV-import</option>
					</select>
					{settings.bankProvider !== "none" && (
						<p className="text-xs text-gray-400">
							Konfigurer API-nøkler under{" "}
							<a href="#bank" className="text-blue-600 hover:underline">
								Bankinnstillinger
							</a>
							.
						</p>
					)}
				</div>
			</Section>
		</div>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="bg-white border rounded-xl p-5 space-y-4">
			<h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
			{children}
		</div>
	);
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
	return (
		<label className="flex items-center justify-between gap-4 cursor-pointer">
			<span className="text-sm text-gray-700">{label}</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				onClick={onChange}
				className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
					checked ? "bg-blue-600" : "bg-gray-200"
				}`}
			>
				<span
					className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
						checked ? "translate-x-6" : "translate-x-1"
					}`}
				/>
			</button>
		</label>
	);
}
