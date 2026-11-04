import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * A table on tablets/desktops that becomes a stack of cards on phones
 * (CLAUDE.md H5: no horizontal scroll). Each row's cells get the column
 * heading as a label on mobile; the first cell is the card's title.
 */
export function DataTable({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  const labels = head.map((h) => (typeof h === "string" ? h : ""));
  const rows = Children.map(children, (row) => {
    if (!isValidElement<{ children?: ReactNode; className?: string }>(row)) return row;
    let i = 0;
    const cells = Children.map(row.props.children, (cell) => {
      if (!isValidElement(cell)) return cell;
      const label = i === 0 ? "" : (labels[i] ?? "");
      i += 1;
      return cloneElement(cell as ReactElement<{ "data-label"?: string }>, { "data-label": label });
    });
    return cloneElement(row, { className: cn(ROW, row.props.className) }, cells);
  });
  return (
    <table className={cn("w-full text-sm max-md:block", className)}>
      <thead className="max-md:hidden">
        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
          {head.map((h, i) => (
            <th key={i} className="px-3 py-2 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line max-md:block max-md:space-y-2 max-md:divide-y-0">{rows}</tbody>
    </table>
  );
}

const ROW = "max-md:block max-md:rounded-[var(--radius-card)] max-md:border max-md:border-line max-md:p-3";

/** A row; on phones it's a bordered card. Plain <tr> children of DataTable get the same styling. */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn(ROW, className)}>{children}</tr>;
}

export function Cell({ children, className, ...rest }: { children?: ReactNode; className?: string; "data-label"?: string }) {
  const label = rest["data-label"];
  return (
    <td
      data-label={label}
      className={cn(
        "px-3 py-2.5 align-top",
        "max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-3 max-md:px-0 max-md:py-1",
        label ? "max-md:before:shrink-0 max-md:before:text-xs max-md:before:text-ink-2 max-md:before:content-[attr(data-label)]" : "max-md:font-medium",
        className,
      )}
    >
      {label ? <span className="max-md:text-right">{children}</span> : children}
    </td>
  );
}
