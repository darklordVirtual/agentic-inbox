import type { DraftResult } from "../api";
import type { CasePriority } from "../../types";

interface Props {
	casePriority: CasePriority;
	onReconcile: () => void;
	onDraftObjection: () => void;
	onRequestInfo: () => void;
	draft: DraftResult | null;
	isPending: boolean;
}

const ACTION_MAP: Partial<Record<CasePriority, { label: string; hint: string; color: string }>> = {
	pay_now:               { label: "Betal",           hint: "Kravet virker legitimt. Betal nå for å unngå eskalering.", color: "bg-red-600 text-white hover:bg-red-700" },
	object_now:            { label: "Bestrid kravet",  hint: "Det finnes grunnlag for å bestride kravet.",               color: "bg-orange-500 text-white hover:bg-orange-600" },
	investigate_first:     { label: "Undersøk",        hint: "Få mer informasjon før du beslutter.",                     color: "bg-yellow-500 text-white hover:bg-yellow-600" },
	already_paid_possible: { label: "Bekreft betaling", hint: "Det ser ut som kravet kan være betalt allerede.",         color: "bg-green-600 text-white hover:bg-green-700" },
};

export function SuggestedActions({ casePriority, onReconcile, onDraftObjection, onRequestInfo, draft, isPending }: Props) {
	const primary = ACTION_MAP[casePriority];

	return (
		<div className="bg-white border rounded-xl p-5 space-y-4">
			<h2 className="text-sm font-semibold text-gray-700">Foreslåtte handlinger</h2>

			{primary && (
				<div className="rounded-lg bg-gray-50 border px-4 py-3 text-sm text-gray-600">
					<span className="font-medium text-gray-800">{primary.label}:</span>{" "}
					{primary.hint}
				</div>
			)}

			<div className="flex flex-wrap gap-2">
				<ActionButton onClick={onDraftObjection} disabled={isPending} label="Lag innsigelse" />
				<ActionButton onClick={onRequestInfo} disabled={isPending} label="Be om dokumentasjon" />
				<ActionButton onClick={onReconcile} disabled={isPending} label="Avstem bank" subtle />
			</div>

			{draft && (
				<DraftPreview draft={draft} />
			)}
		</div>
	);
}

function ActionButton({ label, onClick, disabled, subtle }: { label: string; onClick: () => void; disabled: boolean; subtle?: boolean }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
				subtle
					? "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
					: "bg-blue-600 text-white hover:bg-blue-700"
			}`}
		>
			{label}
		</button>
	);
}

function DraftPreview({ draft }: { draft: DraftResult }) {
	function copyToClipboard() {
		navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`).catch(() => null);
	}

	return (
		<div className="rounded-lg border border-blue-100 bg-blue-50 p-4 space-y-2">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold text-blue-700">Utkast klar</p>
				<button
					type="button"
					onClick={copyToClipboard}
					className="text-xs text-blue-600 hover:underline"
				>
					Kopier
				</button>
			</div>
			<p className="text-sm font-medium text-gray-800">{draft.subject}</p>
			<pre className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed font-sans">
				{draft.body}
			</pre>
		</div>
	);
}
