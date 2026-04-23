import type { Finding } from "../../types";

const SEVERITY: Record<string, { icon: string; color: string }> = {
	critical: { icon: "⚠️", color: "border-red-200 bg-red-50 text-red-800" },
	warning:  { icon: "⚡", color: "border-yellow-200 bg-yellow-50 text-yellow-800" },
	info:     { icon: "ℹ️",  color: "border-blue-200 bg-blue-50 text-blue-800" },
};

interface Props {
	findings: Finding[];
}

export function LegalityFindings({ findings }: Props) {
	if (findings.length === 0) return null;

	return (
		<div>
			<h2 className="text-sm font-semibold text-gray-700 mb-2">Juridiske funn</h2>
			<ul className="space-y-2">
				{findings.map((f) => {
					const style = SEVERITY[f.severity] ?? SEVERITY.info;
					return (
						<li key={f.id} className={`rounded-lg border px-4 py-3 text-sm ${style.color}`}>
							<span className="mr-2">{style.icon}</span>
							<span className="font-mono text-xs mr-2 opacity-70">{f.code}</span>
							{f.description}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
