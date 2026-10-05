import type { ReactNode } from "react";

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{children}</h1>
      {actions}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const color =
    tone === "good" ? "text-green-700" : tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-cafe-900";
  return (
    <div className="card">
      <p className="text-xs font-medium tracking-wide text-cafe-600 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-cafe-600">{hint}</p>}
    </div>
  );
}

export function PeriodTabs({ current, base }: { current: string; base: string }) {
  const periods = [
    ["hoy", "Hoy"],
    ["semana", "Semana"],
    ["mes", "Mes"],
    ["mes_pasado", "Mes pasado"],
    ["anio", "Año"],
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {periods.map(([k, l]) => (
        <a
          key={k}
          href={`${base}?periodo=${k}`}
          className={`rounded-full px-3 py-1 text-sm ${
            current === k ? "bg-cafe-800 text-white" : "bg-white text-cafe-800 ring-1 ring-cafe-200"
          }`}
        >
          {l}
        </a>
      ))}
    </div>
  );
}

/** Barras simples para ventas por día (sin librerías). */
export function Bars({ data }: { data: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="Ventas por día">
      {data.map((d) => (
        <div key={d.label} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
          <div
            className="rounded-t bg-cafe-500 transition group-hover:bg-cafe-700"
            style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
          />
          <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-cafe-900 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white group-hover:block">
            {d.label}: {d.display}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Field({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-cafe-500">{hint}</p>}
    </div>
  );
}
