/**
 * WhatsApp menu builder (CLAUDE.md §10). Meta limits: a list message holds at
 * most 10 rows in total, row titles ≤ 24 chars, descriptions ≤ 72 chars; reply
 * buttons ≤ 3 with titles ≤ 20 chars.
 */
import { botText, type BotLanguage } from "./bot-text";

export const MAX_LIST_ROWS = 10;
export const MAX_BUTTONS = 3;

export interface MenuRow {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppMenu {
  header: string;
  body: string;
  button: string;
  sections: { title: string; rows: MenuRow[] }[];
}

export type CoreAction = "view_bill" | "pay_now" | "send_screenshot" | "my_receipts" | "talk_to_manager";
export const CORE_ACTIONS: CoreAction[] = ["view_bill", "pay_now", "send_screenshot", "my_receipts", "talk_to_manager"];

export interface MenuService {
  id: string;
  name: string;
  type: "fixed" | "metered" | "on_request" | "plan" | "complaint_category" | "info";
  active: boolean;
  menuOrder: number;
}

export interface MenuInput {
  propertyName: string;
  language: BotLanguage;
  services: MenuService[];
}

/** Service types that get a menu row. Fixed and metered charges only appear on the bill. */
const MENU_TYPES = new Set<MenuService["type"]>(["on_request", "plan", "complaint_category", "info"]);

export function buildMenu(input: MenuInput): WhatsAppMenu {
  const t = botText(input.language);
  const coreRows: MenuRow[] = CORE_ACTIONS.map((id) => ({ id: `menu:${id}`, title: t.menu[id].title, description: t.menu[id].description }));
  // TODO(phase-2): on_request / plan / complaint_category / info services become rows here.
  const serviceRows: MenuRow[] = input.services
    .filter((s) => s.active && MENU_TYPES.has(s.type))
    .sort((a, b) => a.menuOrder - b.menuOrder)
    .map((s) => ({ id: `service:${s.id}`, title: truncate(s.name, 24) }));

  const sections: WhatsAppMenu["sections"] = [{ title: t.menuSectionPayments, rows: coreRows }];
  const room = MAX_LIST_ROWS - coreRows.length;
  if (serviceRows.length > 0) {
    if (serviceRows.length <= room) {
      sections.push({ title: t.menuSectionServices, rows: serviceRows });
    } else {
      // Too many for one list: the last slot opens a sub-menu with the rest.
      sections.push({
        title: t.menuSectionServices,
        rows: [...serviceRows.slice(0, room - 1), { id: "menu:more_services", title: t.moreServices }],
      });
    }
  }
  return { header: truncate(input.propertyName, 60), body: t.menuBody, button: t.menuButton, sections };
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
