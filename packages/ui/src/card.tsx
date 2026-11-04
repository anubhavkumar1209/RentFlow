import type { ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)] md:p-6", className)}>{children}</div>;
}

/** A card with a heading row (title, description, actions on the right). */
export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)] md:p-6", className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-ink-2">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A clickable metric (CLAUDE.md H5: every metric links to its detail list). */
export function StatTile({
  label,
  value,
  hint,
  tone,
  icon,
  href,
  LinkComponent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "success" | "danger" | "warning";
  icon?: ReactNode;
  href?: string;
  LinkComponent?: (props: { href: string; className: string; children: ReactNode }) => ReactNode;
}) {
  const color = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-2">{label}</p>
        {icon ? <span className="text-muted [&_svg]:size-5">{icon}</span> : null}
      </div>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", color)}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-2">{hint}</p> : null}
    </>
  );
  const cls = "block rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)]";
  if (href && LinkComponent) return <LinkComponent href={href} className={cn(cls, "transition hover:border-primary/40")}>{body}</LinkComponent>;
  return <div className={cls}>{body}</div>;
}
