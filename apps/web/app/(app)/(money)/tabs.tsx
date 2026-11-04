"use client";

import { cn } from "@rentflow/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MoneyTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Bills & Payments" className="border-b border-line bg-card px-4 md:px-6">
      {/* Wraps on narrow phones instead of scrolling sideways. */}
      <ul className="flex flex-wrap gap-x-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium",
                  active ? "border-primary text-primary" : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
