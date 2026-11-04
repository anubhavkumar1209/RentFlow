// App-level building blocks on top of @rentflow/ui (the design system). Server-component friendly.
import { formatINR } from "@rentflow/core";
import { buttonClass, Cell, Chip, DataTable, EmptyState, statusTone, StatTile, type Tone } from "@rentflow/ui";
import { Inbox } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export { Check, Field, Section, Select } from "@rentflow/ui";

/** Page header + content column. */
export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink md:text-2xl">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

export function Money({ paise, className = "" }: { paise: number; className?: string }) {
  return (
    <span data-money className={`tabular-nums ${paise < 0 ? "text-success" : ""} ${className}`}>
      {formatINR(paise)}
    </span>
  );
}

/** Balance with meaning: due (danger), nothing due, or advance (success). */
export function Balance({ paise }: { paise: number }) {
  if (paise > 0) return <span className="font-medium tabular-nums text-danger">{formatINR(paise)} due</span>;
  if (paise < 0) return <span className="font-medium tabular-nums text-success">{formatINR(-paise)} advance</span>;
  return <span className="text-ink-2">Nothing due</span>;
}

const LEGACY_TONE: Record<string, Tone> = { green: "success", amber: "warning", red: "danger", blue: "info", gray: "neutral" };

export function Badge({ tone = "gray", children }: { tone?: "green" | "amber" | "red" | "blue" | "gray"; children: ReactNode }) {
  return <Chip tone={LEGACY_TONE[tone]}>{children}</Chip>;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  sent: "Sent",
  partially_paid: "Partially paid",
  paid: "Paid",
  active: "Active",
  notice: "Notice period",
  closed: "Closed",
  vacant: "Vacant",
  occupied: "Occupied",
  blocked: "Unavailable",
  unmatched: "Unmatched",
  matched: "Matched",
  ignored: "Ignored",
  setting_up: "Setting up",
  paused: "Paused",
};

/** Status chip with the colour from CLAUDE.md H4. */
export function StatusBadge({ status }: { status: string }) {
  return <Chip tone={statusTone(status)}>{STATUS_LABEL[status] ?? status}</Chip>;
}

export function Stat({ label, value, hint, tone, href, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "green"; href?: string; icon?: ReactNode }) {
  return (
    <StatTile
      label={label}
      value={value}
      hint={hint}
      icon={icon}
      tone={tone === "red" ? "danger" : tone === "green" ? "success" : undefined}
      href={href}
      LinkComponent={({ href: to, className, children }) => (
        <Link href={to} className={className}>
          {children}
        </Link>
      )}
    />
  );
}

export function LinkButton({ href, children, variant = "primary", icon }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; icon?: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant)}>
      {icon}
      {children}
    </Link>
  );
}

export function Empty({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return <EmptyState icon={icon ?? <Inbox />} title={typeof children === "string" ? children : ""} description={typeof children === "string" ? undefined : children} action={action} />;
}

/** Table on desktop, stacked cards on phones. */
export const Table = DataTable;
export const Td = Cell;
