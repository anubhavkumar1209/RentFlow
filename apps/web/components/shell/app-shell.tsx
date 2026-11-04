"use client";

import { LANGUAGE_CODES, type Language } from "@rentflow/core";
import { languageLabel } from "@/components/language-options";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { cn, Drawer } from "@rentflow/ui";
import {
  BarChart3,
  BedDouble,
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  FlaskConical,
  Gauge,
  Banknote,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  MessageCircle,
  Receipt,
  Search,
  Settings,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { setLanguageAction, setPropertyAction } from "@/app/(app)/shell-actions";
import { Logo } from "@/components/brand/logo";

export interface ShellProps {
  role: "owner" | "manager" | "billing_staff" | "maintenance_staff";
  demo: boolean;
  orgName: string;
  userName: string | null;
  phone: string;
  locale: Language;
  properties: { id: string; name: string; occupied: number; beds: number }[];
  selectedPropertyId: string | null;
  attention: { key: string; count: number; href: string | null }[];
  children: ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that count as this item being active. */
  also?: string[];
}

function useNav(role: ShellProps["role"], demo: boolean) {
  const t = useTranslations("nav");
  const tp = useTranslations("profile");
  const owner = role === "owner";
  const money = { href: "/billing", label: t("billsPayments"), icon: Receipt, also: ["/readings", "/payments", "/cash"] };
  // TODO(M8): Complaints. TODO(M12): Expenses.
  const sidebar: NavItem[] = owner
    ? [
        { href: "/dashboard", label: t("overview"), icon: LayoutDashboard },
        { href: "/properties", label: t("myPgs"), icon: Building2 },
        { href: "/rooms", label: t("rooms"), icon: BedDouble },
        { href: "/tenants", label: t("tenants"), icon: Users },
        money,
        { href: "/automation", label: t("whatsapp"), icon: MessageCircle },
        { href: "/reports", label: t("reports"), icon: BarChart3 },
        { href: "/settings", label: t("settings"), icon: Settings, also: ["/staff", "/profile"] },
        ...(demo ? [{ href: "/demo", label: t("demo"), icon: FlaskConical }] : []),
      ]
    : [
        { href: "/dashboard", label: t("today"), icon: LayoutDashboard },
        { href: "/rooms", label: t("rooms"), icon: BedDouble },
        { href: "/tenants", label: t("tenants"), icon: Users },
        money,
        { href: "/profile", label: tp("menu"), icon: UserRound },
      ];
  // Mobile bottom tabs (CLAUDE.md H5). TODO(M8): Complaints replaces Bills for owners; Tickets for managers.
  const tabs: NavItem[] = owner
    ? [
        { href: "/dashboard", label: t("overview"), icon: LayoutDashboard },
        { href: "/tenants", label: t("tenants"), icon: Users },
        { href: "/payments", label: t("payments"), icon: Wallet },
        { href: "/billing", label: t("bills"), icon: Receipt, also: ["/readings", "/cash"] },
      ]
    : [
        { href: "/dashboard", label: t("today"), icon: LayoutDashboard },
        { href: "/readings", label: t("readings"), icon: Gauge },
        { href: "/tenants", label: t("tenants"), icon: Users },
        { href: "/cash", label: t("cash"), icon: Banknote },
      ];
  const tabHrefs = new Set(tabs.map((i) => i.href));
  const more = sidebar.filter((i) => !tabHrefs.has(i.href));
  return { sidebar, tabs, more };
}

function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`));
}

const COLLAPSE_KEY = "rf.sidebar.collapsed";
const collapseListeners = new Set<() => void>();

/** The desktop sidebar's collapsed state, remembered per browser (falls back to expanded). */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    // Storage unavailable (private mode): the toggle still works for this page view.
  }
  collapseListeners.forEach((l) => l());
}

function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  return () => collapseListeners.delete(listener);
}

export function AppShell(props: ShellProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { sidebar, tabs, more } = useNav(props.role, props.demo);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [moreOpen, setMoreOpen] = useState(false);
  const toggle = () => writeCollapsed(!collapsed);

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar: icons only on tablets, 240px on desktop (collapsible). */}
      <aside
        data-collapsed={collapsed}
        className="group sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-card md:flex md:w-[72px] lg:w-[240px] lg:data-[collapsed=true]:w-[72px]"
      >
        <div className="flex h-16 items-center gap-1 px-4 lg:group-data-[collapsed=true]:flex-col lg:group-data-[collapsed=true]:justify-center lg:group-data-[collapsed=true]:px-2">
          <Link href="/dashboard" className="rf-logo-trigger flex min-w-0 flex-1 items-center gap-2">
            <Logo size={32} />
            <span className="hidden truncate font-semibold text-ink lg:inline lg:group-data-[collapsed=true]:hidden">Rent<span className="text-primary">Flow</span></span>
          </Link>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? t("expand") : t("collapse")}
            title={collapsed ? t("expand") : t("collapse")}
            className="hidden size-8 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-ink-2 hover:bg-page lg:flex"
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Main">
          {sidebar.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-[var(--radius-input)] px-3 text-sm font-medium transition-colors",
                  active ? "bg-primary-soft text-primary" : "text-ink-2 hover:bg-page hover:text-ink",
                )}
              >
                <item.icon className="size-5 shrink-0" strokeWidth={1.75} />
                <span className="hidden truncate lg:inline lg:group-data-[collapsed=true]:hidden">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar {...props} />
        <main className="mx-auto w-full max-w-[1280px] flex-1 pb-24 md:pb-8">{props.children}</main>
      </div>

      {/* Phone bottom tabs + "More". */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {tabs.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-primary" : "text-ink-2")}>
              <item.icon className="size-5" strokeWidth={1.75} />
              <span className="max-w-full truncate px-1">{item.label}</span>
            </Link>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", more.some((i) => isActive(pathname, i)) ? "text-primary" : "text-ink-2")}>
          <Menu className="size-5" strokeWidth={1.75} />
          {t("more")}
        </button>
      </nav>
      <Drawer open={moreOpen} onOpenChange={setMoreOpen} title={t("more")}>
        <ul className="space-y-1">
          {more.map((item) => (
            <li key={item.href}>
              <Link href={item.href} onClick={() => setMoreOpen(false)} className={cn("flex h-12 items-center gap-3 rounded-[var(--radius-input)] px-3 text-base", isActive(pathname, item) ? "bg-primary-soft text-primary" : "text-ink hover:bg-page")}>
                <item.icon className="size-5" strokeWidth={1.75} />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Drawer>
    </div>
  );
}

function TopBar(props: ShellProps) {
  const t = useTranslations("topbar");
  const tn = useTranslations("nav");
  const tp = useTranslations("profile");
  const ta = useTranslations("attention");
  const [pending, start] = useTransition();
  // With a single PG, "all" and that PG are the same thing: show (and tick) the PG.
  const selected = props.properties.find((p) => p.id === props.selectedPropertyId) ?? (props.properties.length === 1 ? props.properties[0] : undefined);
  const total = props.attention.reduce((s, a) => s + a.count, 0);
  const roleLabel = props.role === "owner" ? t("owner") : props.role === "manager" ? t("manager") : t("staff");
  const item = "flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-input)] px-3 text-sm text-ink outline-none data-[highlighted]:bg-page";
  const panel = "z-50 min-w-56 rounded-[var(--radius-card)] border border-line bg-card p-1 shadow-lg";

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-card/95 px-4 backdrop-blur md:px-6">
      <Link href="/dashboard" className="rf-logo-trigger md:hidden" aria-label="RentFlow">
        <Logo size={32} />
      </Link>

      {/* Property switcher */}
      <Dropdown.Root>
        <Dropdown.Trigger className="flex h-10 min-w-0 items-center gap-1.5 rounded-[var(--radius-input)] px-2 text-sm font-semibold text-ink hover:bg-page" aria-label={t("switchProperty")} disabled={pending}>
          <Building2 className="size-4 shrink-0 text-ink-2" strokeWidth={1.75} />
          <span className="truncate">{selected?.name ?? (props.properties.length === 0 ? t("yourPgs") : t("allProperties"))}</span>
          <ChevronDown className="size-4 shrink-0 text-ink-2" />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="start" sideOffset={6} className={panel}>
            <Dropdown.Label className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-ink-2">{t("yourPgs")}</Dropdown.Label>
            {props.properties.length > 1 ? (
              <Dropdown.Item className={item} onSelect={() => start(() => setPropertyAction("all"))}>
                <Check className={cn("size-4 shrink-0", !selected ? "text-primary" : "invisible")} />
                <span className="truncate">{t("allProperties")}</span>
              </Dropdown.Item>
            ) : null}
            {props.properties.map((p) => (
              <Dropdown.Item key={p.id} className={item} onSelect={() => start(() => setPropertyAction(p.id))}>
                <Check className={cn("size-4 shrink-0", p.id === selected?.id ? "text-primary" : "invisible")} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-2">{t("beds", { occupied: p.occupied, beds: p.beds })}</span>
              </Dropdown.Item>
            ))}
            {props.properties.length === 0 ? <p className="px-3 py-2 text-sm text-ink-2">{t("noPgs")}</p> : null}
            {props.role === "owner" ? (
              <>
                <Dropdown.Separator className="my-1 h-px bg-line" />
                <Dropdown.Item asChild className={cn(item, "font-medium text-primary")}>
                  <Link href="/properties#add">
                    <Plus className="size-4 shrink-0" /> {t("addPg")}
                  </Link>
                </Dropdown.Item>
              </>
            ) : null}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>

      {/* Search (tenants) */}
      <form action="/tenants" method="get" className="ml-auto hidden max-w-sm flex-1 md:block" role="search">
        <label className="relative block">
          <span className="sr-only">{t("search")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input name="q" placeholder={t("search")} className="h-10 w-full rounded-[var(--radius-input)] border border-line bg-page pl-9 pr-3 text-sm outline-none focus:border-primary focus:bg-card" />
        </label>
      </form>
      <Link href="/tenants" className="ml-auto inline-flex size-10 items-center justify-center rounded-[var(--radius-input)] text-ink-2 hover:bg-page md:hidden" aria-label={t("search")}>
        <Search className="size-5" strokeWidth={1.75} />
      </Link>

      {/* Notifications */}
      <Dropdown.Root>
        <Dropdown.Trigger className="relative inline-flex size-10 items-center justify-center rounded-[var(--radius-input)] text-ink-2 hover:bg-page" aria-label={`${t("notifications")}${total ? ` (${total})` : ""}`}>
          <Bell className="size-5" strokeWidth={1.75} />
          {total > 0 ? <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">{total > 99 ? "99+" : total}</span> : null}
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="end" sideOffset={6} className={cn(panel, "w-80 max-w-[calc(100vw-2rem)]")}>
            <Dropdown.Label className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">{t("notifications")}</Dropdown.Label>
            {props.attention.length === 0 ? (
              <p className="px-3 py-3 text-sm text-ink-2">{t("nothingNeedsAttention")}</p>
            ) : (
              props.attention.map((a) =>
                a.href ? (
                  <Dropdown.Item key={a.key} asChild className={item}>
                    <Link href={a.href}>{ta(a.key, { count: a.count })}</Link>
                  </Dropdown.Item>
                ) : (
                  <p key={a.key} className="px-3 py-2 text-sm text-ink">
                    {ta(a.key, { count: a.count })}
                  </p>
                ),
              )
            )}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>

      {/* Profile */}
      <Dropdown.Root>
        <Dropdown.Trigger className="inline-flex size-10 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary" aria-label={t("profile")}>
          {(props.userName ?? props.phone).trim().charAt(0).toUpperCase() || "R"}
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="end" sideOffset={6} className={panel}>
            <Dropdown.Item asChild className="block cursor-pointer rounded-[var(--radius-input)] px-3 py-2 outline-none data-[highlighted]:bg-page">
              <Link href="/profile">
                <p className="text-sm font-semibold text-ink">{props.userName ?? props.phone}</p>
                <p className="text-xs text-ink-2">
                  {props.phone} · {roleLabel}
                </p>
              </Link>
            </Dropdown.Item>
            <Dropdown.Item asChild className={item}>
              <Link href="/profile">
                <UserRound className="size-4" /> {tp("menu")}
              </Link>
            </Dropdown.Item>
            <Dropdown.Separator className="my-1 h-px bg-line" />
            <Dropdown.Label className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-2">
              <Languages className="size-4" /> {t("language")}
            </Dropdown.Label>
            <div className="max-h-64 overflow-y-auto">
              {LANGUAGE_CODES.map((l) => (
                <Dropdown.Item key={l} lang={l} className={item} onSelect={() => start(() => setLanguageAction(l))}>
                  <Check className={cn("size-4", props.locale === l ? "text-primary" : "invisible")} />
                  {languageLabel(l)}
                </Dropdown.Item>
              ))}
            </div>
            <Dropdown.Separator className="my-1 h-px bg-line" />
            {props.role === "owner" ? (
              <Dropdown.Item asChild className={item}>
                <Link href="/settings">
                  <Settings className="size-4" /> {tn("settings")}
                </Link>
              </Dropdown.Item>
            ) : null}
            <form action="/auth/signout" method="post">
              <button className={cn(item, "w-full text-danger")}>
                <LogOut className="size-4" /> {t("logout")}
              </button>
            </form>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </header>
  );
}
