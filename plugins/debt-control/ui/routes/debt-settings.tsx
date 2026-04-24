import { Select, Switch, useKumoToastManager } from "@cloudflare/kumo";
import {
BankIcon,
GavelIcon,
ToggleLeftIcon,
RobotIcon,
BellIcon,
SpinnerGapIcon,
} from "@phosphor-icons/react";
import { useParams } from "react-router";
import { useDebtSettings, useUpdateDebtSettings } from "../queries";
import type { PluginSettings } from "../../types";

export default function DebtSettings() {
const { mailboxId } = useParams<{ mailboxId: string }>();
const toastManager = useKumoToastManager();
const { data: settings, isLoading } = useDebtSettings(mailboxId);
const update = useUpdateDebtSettings(mailboxId!, {
		onSuccess: () => toastManager.add({ title: "Innstillinger lagret" }),
		onError: (err: Error) =>
			toastManager.add({ title: "Feil ved lagring", description: err.message, variant: "error" }),
	});

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

function setNumber(key: keyof PluginSettings, value: number) {
if (Number.isNaN(value)) return;
update.mutate({ [key]: value });
}

const disabled = update.isPending;

return (
<div className="h-full overflow-y-auto">
<div className="max-w-2xl mx-auto py-10 px-6 space-y-8">
<div>
<h1 className="text-2xl font-bold text-kumo-default">Debt Control — Innstillinger</h1>
<p className="text-sm text-kumo-subtle mt-1">
Konfigurer automatisert gjeldsbehandling. Disse innstillingene fungerer uavhengig av
bankintegrasjon.
</p>
</div>

{/* Generelt */}
<section>
<SectionHeader icon={<ToggleLeftIcon size={18} />} title="Generelt" />
<div className="divide-y divide-kumo-line border border-kumo-line rounded-lg overflow-hidden">
<SettingRow
label="Aktiver Debt Control"
description="Slå av for å deaktivere all automatisk behandling i denne postboksen."
checked={settings.enabled}
onChange={() => toggle("enabled")}
disabled={disabled}
/>
</div>
</section>

{/* Automatisk behandling */}
<section>
<SectionHeader icon={<RobotIcon size={18} />} title="Automatisk behandling" />
<div className="divide-y divide-kumo-line border border-kumo-line rounded-lg overflow-hidden">
<SettingRow
label="Klassifiser e-poster automatisk"
description="Kjør klassifiseringsmotor automatisk når en ny e-post ankommer."
checked={settings.autoClassify}
onChange={() => toggle("autoClassify")}
disabled={disabled}
/>
<SettingRow
label="Avstem automatisk etter banksynk"
description="Match transaksjoner mot åpne saker etter banksynkronisering."
checked={settings.autoReconcile}
onChange={() => toggle("autoReconcile")}
disabled={disabled}
/>
<SettingRow
label="Generer innsigelse automatisk"
description="Lag et utkast til innsigelse automatisk når klassifiseringen er høysikker."
checked={settings.autoDraftObjection}
onChange={() => toggle("autoDraftObjection")}
disabled={disabled}
/>
<SettingRow
label="Generer informasjonsforespørsel automatisk"
description="Lag et utkast til forespørsel om manglende opplysninger når felter mangler."
checked={settings.autoDraftInfoRequest}
onChange={() => toggle("autoDraftInfoRequest")}
disabled={disabled}
/>
</div>
</section>

{/* Legalitetskontroll */}
<section>
<SectionHeader icon={<GavelIcon size={18} />} title="Legalitetskontroll" />
<div className="divide-y divide-kumo-line border border-kumo-line rounded-lg overflow-hidden">
<SettingRow
label="Kjør legalitetskontroll"
description="Analyser hvert klassifisert dokument for potensielle lovbrudd (foreldelse, inkassoregler m.m.)."
checked={settings.enableLegalityCheck}
onChange={() => toggle("enableLegalityCheck")}
disabled={disabled}
/>
<NumberRow
label="Kort frist — varselsgrense (dager)"
description="Dokumenter med forfallsdato kortere enn dette antall dager flagges som hastedokument."
value={settings.shortDeadlineDays}
min={1}
max={90}
onChange={(v) => setNumber("shortDeadlineDays", v)}
disabled={disabled}
/>
</div>
</section>

{/* Prioritering & varsler */}
<section>
<SectionHeader icon={<BellIcon size={18} />} title="Prioritering og varsler" />
<div className="divide-y divide-kumo-line border border-kumo-line rounded-lg overflow-hidden">
<NumberRow
label="Høy-verdi grense (NOK)"
description="Saker over dette beløpet flyttes automatisk til prioritet «betal nå»."
value={settings.highValueThresholdNok}
min={0}
onChange={(v) => setNumber("highValueThresholdNok", v)}
disabled={disabled}
/>
<SettingRow
label="Eskalér rettslige brev automatisk"
description="Gi rettslige brev (forliksråd, namsmann m.m.) høy prioritet automatisk."
checked={settings.autoEscalateCourtLetters}
onChange={() => toggle("autoEscalateCourtLetters")}
disabled={disabled}
/>
</div>
</section>

{/* Bankintegrasjon */}
<section>
<SectionHeader icon={<BankIcon size={18} />} title="Bankintegrasjon (valgfritt)" />
<p className="text-xs text-kumo-subtle mb-3">
Bankinnstillinger er valgfrie og påvirker ikke de øvrige innstillingene ovenfor.
Detaljert tilkoblingskonfigurasjon finner du under{" "}
<strong>Bankinnstillinger</strong>-fanen.
</p>
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
</div>
);
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
return (
<h2 className="text-base font-semibold text-kumo-default mb-3 flex items-center gap-2">
{icon}
{title}
</h2>
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

function NumberRow({
label,
description,
value,
min,
max,
onChange,
disabled,
}: {
label: string;
description: string;
value: number;
min?: number;
max?: number;
onChange: (v: number) => void;
disabled?: boolean;
}) {
return (
<div className="flex items-center justify-between px-4 py-4 bg-kumo-surface gap-4">
<div className="flex-1">
<div className="text-sm font-medium text-kumo-default">{label}</div>
<div className="text-xs text-kumo-subtle mt-0.5">{description}</div>
</div>
<input
type="number"
className="w-24 rounded border border-kumo-line bg-kumo-bg px-2 py-1 text-sm text-kumo-default text-right focus:outline-none focus:ring-1 focus:ring-kumo-accent disabled:opacity-50"
value={value}
min={min}
max={max}
disabled={disabled}
onChange={(e) => onChange(Number(e.target.value))}
/>
</div>
);
}
