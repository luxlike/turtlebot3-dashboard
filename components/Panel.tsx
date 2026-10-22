import type { LucideIcon } from "lucide-react";

export function Panel({
  title, icon: Icon, right, children, className = "", bodyClass = "",
}: {
  title: string; icon: LucideIcon; right?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 ${className}`}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-ink-700 bg-ink-850 px-3">
        <Icon className="size-3.5 text-signal" strokeWidth={2.2} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">{title}</h2>
        <div className="ml-auto flex items-center gap-1.5">{right}</div>
      </header>
      <div className={`relative min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" | "bad" }) {
  const c = {
    muted: "border-ink-600 text-ink-300",
    ok: "border-signal-dim text-signal",
    warn: "border-amber/50 text-amber",
    bad: "border-alert/60 text-alert",
  }[tone];
  return <span className={`rounded border px-1.5 py-px font-mono text-[10px] ${c}`}>{children}</span>;
}

export function IconBtn({
  onClick, title, active, children,
}: { onClick: () => void; title: string; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`grid size-6 place-items-center rounded transition-colors ${
        active ? "bg-signal/15 text-signal" : "text-ink-400 hover:bg-ink-700 hover:text-ink-100"
      }`}
    >
      {children}
    </button>
  );
}

export function Readout({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`font-mono text-sm tabular-nums ${tone === "bad" ? "text-alert" : tone === "warn" ? "text-amber" : "text-ink-100"}`}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] text-ink-400">{unit}</span>}
      </div>
    </div>
  );
}
