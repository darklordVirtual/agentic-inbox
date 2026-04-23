import type { PaymentMatch } from "../../types";

const CONFIDENCE: Record<string, { label: string; color: string }> = {
	high:   { label: "Høy",    color: "text-green-700 bg-green-50" },
	medium: { label: "Middels", color: "text-yellow-700 bg-yellow-50" },
	low:    { label: "Lav",    color: "text-gray-600 bg-gray-100" },
	none:   { label: "Ingen",  color: "text-gray-400 bg-gray-50" },
};

interface Props {
	matches: PaymentMatch[];
}

export function PaymentMatches({ matches }: Props) {
	if (matches.length === 0) return null;

	return (
		<div>
			<h2 className="text-sm font-semibold text-gray-700 mb-2">Betalingsmatcher</h2>
			<ul className="space-y-2">
				{matches.map((m) => {
					const conf = CONFIDENCE[m.confidence] ?? CONFIDENCE.none;
					const reasons: string[] = (() => {
						try { return JSON.parse(m.matchReasons); }
						catch { return []; }
					})();

					return (
						<li key={m.id} className="rounded-lg border bg-white px-4 py-3 text-sm">
							<div className="flex items-center justify-between">
								<span className={`text-xs font-medium px-2 py-0.5 rounded-full ${conf.color}`}>
									{conf.label} ({m.matchScore}/100)
								</span>
								{m.confirmedAt ? (
									<span className="text-xs text-green-600">✓ Bekreftet</span>
								) : (
									<span className="text-xs text-gray-400">Ikke bekreftet</span>
								)}
							</div>
							{reasons.length > 0 && (
								<p className="text-xs text-gray-400 mt-1">{reasons.join(" · ")}</p>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
