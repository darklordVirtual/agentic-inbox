import { useParams, Link } from "react-router";
import {
	useDebtCase,
	useReconcileCase,
	useDraftObjection,
	useRequestMoreInfo,
} from "../queries";
import { LegalityFindings } from "../components/LegalityFindings";
import { PaymentMatches } from "../components/PaymentMatches";
import { SuggestedActions } from "../components/SuggestedActions";

const STATUS_LABELS: Record<string, string> = {
	open:             "Åpen",
	waiting_response: "Venter svar",
	disputed:         "Bestridt",
	paid:             "Betalt",
	closed:           "Lukket",
	archived:         "Arkivert",
};

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
	pay_now:               { label: "Betal nå",       color: "text-red-600 bg-red-50" },
	object_now:            { label: "Bestrid nå",     color: "text-orange-600 bg-orange-50" },
	investigate_first:     { label: "Undersøk",       color: "text-yellow-700 bg-yellow-50" },
	waiting_response:      { label: "Venter svar",    color: "text-blue-600 bg-blue-50" },
	already_paid_possible: { label: "Mulig betalt",   color: "text-green-700 bg-green-50" },
	low:                   { label: "Lav prioritet",  color: "text-gray-600 bg-gray-50" },
};

export default function DebtCase() {
	const { mailboxId, caseId } = useParams<{ mailboxId: string; caseId: string }>();
	const { data, isLoading, error } = useDebtCase(mailboxId, caseId);
	const reconcile     = useReconcileCase(mailboxId!, caseId!);
	const draftObjection = useDraftObjection(mailboxId!, caseId!);
	const requestInfo   = useRequestMoreInfo(mailboxId!, caseId!);

	if (isLoading) return <div className="p-6 text-sm text-gray-500">Laster…</div>;
	if (error || !data) return <div className="p-6 text-sm text-red-500">Sak ikke funnet.</div>;

	const { case: c, documents, findings, paymentMatches } = data;
	const priority = PRIORITY_LABELS[c.priority] ?? { label: c.priority, color: "text-gray-600 bg-gray-50" };

	return (
		<div className="p-6 max-w-3xl mx-auto space-y-6">
			{/* Header */}
			<div className="flex items-start justify-between">
				<div>
					<Link to={`/mailbox/${mailboxId}/debt`} className="text-sm text-gray-400 hover:text-gray-600">
						← Tilbake
					</Link>
					<h1 className="text-xl font-semibold text-gray-900 mt-1">{c.creditor}</h1>
					{c.reference && (
						<p className="text-sm text-gray-400 font-mono">{c.reference}</p>
					)}
				</div>
				<span className={`text-xs font-medium px-3 py-1 rounded-full ${priority.color}`}>
					{priority.label}
				</span>
			</div>

			{/* Key facts */}
			<dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 bg-white border rounded-xl p-4 text-sm">
				<Fact label="Beløp" value={c.amountDue != null ? `${c.amountDue.toLocaleString("nb-NO")} ${c.currency}` : "Ukjent"} />
				<Fact label="Forfall" value={c.dueDate ? new Date(c.dueDate).toLocaleDateString("nb-NO") : "Ukjent"} />
				<Fact label="Status" value={STATUS_LABELS[c.status] ?? c.status} />
				<Fact label="Dokumenter" value={String(documents.length)} />
			</dl>

			{/* Findings */}
			<LegalityFindings findings={findings} />

			{/* Payment matches */}
			<PaymentMatches matches={paymentMatches} />

			{/* Suggested actions */}
			<SuggestedActions
				casePriority={c.priority}
				onReconcile={() => reconcile.mutate()}
				onDraftObjection={() => draftObjection.mutate({})}
				onRequestInfo={() => requestInfo.mutate({})}
				draft={draftObjection.data ?? requestInfo.data ?? null}
				isPending={draftObjection.isPending || requestInfo.isPending || reconcile.isPending}
			/>
		</div>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="text-xs text-gray-400 uppercase tracking-wide">{label}</dt>
			<dd className="font-medium text-gray-900 mt-0.5">{value}</dd>
		</div>
	);
}
