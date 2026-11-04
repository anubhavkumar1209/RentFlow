"use client";

import { formatHour, NOTE_MAX, renderTemplate, type AutomationKey, type TemplateName } from "@rentflow/core";
import { Chip, cn, Select, type Tone } from "@rentflow/ui";
import { BellRing, CalendarClock, CircleCheckBig, Clock, ReceiptText, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { saveAutomationAction } from "./actions";

export type Health = "active" | "off" | "paused" | "attention";

const ICONS: Record<AutomationKey, LucideIcon> = {
  bill: ReceiptText,
  reminder_before: CalendarClock,
  reminder_due: BellRing,
  reminder_overdue: TriangleAlert,
  payment_confirmation: CircleCheckBig,
};
const HEALTH: Record<Health, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  off: { label: "Off", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
  attention: { label: "Needs attention", tone: "danger" },
};
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM – 10 PM
const OVERDUE_DAYS = [1, 2, 3, 5, 7, 10, 15];

export interface CardProps {
  propertyId: string;
  automationKey: AutomationKey;
  title: string;
  description: string;
  enabled: boolean;
  note: string;
  schedule: Record<string, unknown>;
  health: Health;
  counts: { sent: number; delivered: number; read: number; failed: number };
  template: TemplateName;
  /** Example variables for the preview, without the note (always the last variable). */
  previewVars: string[];
  /** Short line under the title, e.g. "Next: 1 Feb, 6:00 PM". */
  next?: string;
}

function HourSelect({ value }: { value: number }) {
  return (
    <Select label="Time" name="hour" defaultValue={String(value)}>
      {HOURS.map((h) => (
        <option key={h} value={h}>
          {formatHour(h)}
        </option>
      ))}
    </Select>
  );
}

export function AutomationCard(props: CardProps) {
  const { automationKey: key, schedule: s } = props;
  const [enabled, setEnabled] = useState(props.enabled);
  const [note, setNote] = useState(props.note);
  const [mode, setMode] = useState(String(s.mode ?? "before_due"));
  const Icon = ICONS[key];
  const health = HEALTH[props.health];
  const preview = renderTemplate(props.template, "en", [...props.previewVars, note.trim() || "-"]);
  const total = props.counts.sent + props.counts.delivered + props.counts.read;

  return (
    <article className={cn("overflow-hidden rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)]", !enabled && "opacity-95")}>
      <ActionForm action={saveAutomationAction} submit="Save changes" className="pb-4 md:pb-6 [&>[role=alert]]:mx-4 [&>[role=alert]]:mb-3 md:[&>[role=alert]]:mx-6" submitClassName="ml-4 md:ml-6">
        <input type="hidden" name="propertyId" value={props.propertyId} />
        <input type="hidden" name="key" value={key} />
        <div className="mb-4 grid lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4 p-4 md:p-6">
          <header className="flex items-start gap-3">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", enabled ? "bg-primary-soft text-primary" : "bg-page text-ink-2")}>
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-ink">{props.title}</h3>
                <Chip tone={health.tone}>{health.label}</Chip>
              </div>
              <p className="mt-0.5 text-sm text-ink-2">{props.description}</p>
              {props.next && enabled ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Clock className="size-3.5" /> {props.next}
                </p>
              ) : null}
            </div>
            <label className="relative inline-flex shrink-0 cursor-pointer items-center" title={enabled ? "Turn off" : "Turn on"}>
              <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="peer sr-only" aria-label={`${props.title}: on or off`} />
              <span className="h-7 w-12 rounded-full bg-line transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40" />
              <span className="absolute left-1 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
            </label>
          </header>

          <fieldset disabled={!enabled} className="space-y-3 disabled:opacity-60">
            {key === "bill" ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="When bills go out">
                  {[
                    ["day", "On a fixed day of the month"],
                    ["before_due", "Some days before the due date"],
                  ].map(([value, label]) => (
                    <label key={value} className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-input)] border px-3 text-sm", mode === value ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-2")}>
                      <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value!)} className="accent-[var(--color-primary)]" />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {mode === "day" ? (
                    <Select label="Day of the month" name="day" defaultValue={String(s.day ?? 1)}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {d === 1 ? "1st" : d === 2 ? "2nd" : d === 3 ? "3rd" : `${d}th`} of every month
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Select label="How early" name="daysBefore" defaultValue={String(s.daysBefore ?? 7)}>
                      {[0, 1, 2, 3, 5, 7, 10, 15].map((d) => (
                        <option key={d} value={d}>
                          {d === 0 ? "On the due date" : `${d} day${d === 1 ? "" : "s"} before`}
                        </option>
                      ))}
                    </Select>
                  )}
                  {mode === "day" ? <input type="hidden" name="daysBefore" value={String(s.daysBefore ?? 7)} /> : <input type="hidden" name="day" value={String(s.day ?? 1)} />}
                  <HourSelect value={Number(s.hour ?? 9)} />
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-input)] bg-page p-3 text-sm">
                  <input type="checkbox" name="approveFirst" defaultChecked={s.approveFirst !== false} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
                  <span>
                    <span className="font-medium text-ink">Let me approve bills before they go out</span>
                    <span className="block text-ink-2">Recommended. Turned off, bills are sent automatically, except when a meter reading is missing or looks wrong.</span>
                  </span>
                </label>
              </>
            ) : null}

            {key === "reminder_before" ? (
              <div className="grid grid-cols-2 gap-3">
                <Select label="How early" name="daysBefore" defaultValue={String(s.daysBefore ?? 2)}>
                  {[1, 2, 3, 5, 7].map((d) => (
                    <option key={d} value={d}>
                      {d} day{d === 1 ? "" : "s"} before due
                    </option>
                  ))}
                </Select>
                <HourSelect value={Number(s.hour ?? 10)} />
              </div>
            ) : null}

            {key === "reminder_due" ? (
              <div className="grid grid-cols-2 gap-3">
                <HourSelect value={Number(s.hour ?? 10)} />
              </div>
            ) : null}

            {key === "reminder_overdue" ? (
              <>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink">Days after the due date</p>
                  <div className="flex flex-wrap gap-2">
                    {OVERDUE_DAYS.map((d) => (
                      <label key={d} className="cursor-pointer">
                        <input type="checkbox" name="daysAfter" value={d} defaultChecked={Array.isArray(s.daysAfter) && s.daysAfter.includes(d)} className="peer sr-only" />
                        <span className="inline-flex h-10 min-w-12 items-center justify-center rounded-[var(--radius-input)] border border-line px-3 text-sm text-ink-2 peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:font-semibold peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40">
                          +{d}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 items-end gap-3">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink">
                    <input type="checkbox" name="weekly" defaultChecked={s.weekly !== false} className="size-4 accent-[var(--color-primary)]" />
                    Then every week, until paid
                  </label>
                  <HourSelect value={Number(s.hour ?? 10)} />
                </div>
              </>
            ) : null}

            {key === "payment_confirmation" ? (
              <p className="rounded-[var(--radius-input)] bg-page p-3 text-sm text-ink-2">
                Sent with the PDF receipt as soon as a payment is confirmed: by your bank alert, by you or your manager, or by the tenant for cash. A screenshot alone never confirms a payment.
              </p>
            ) : null}

            <label className="block">
              <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-ink">
                Your note <span className="text-xs font-normal text-ink-2">{note.length}/{NOTE_MAX}</span>
              </span>
              <input
                name="note"
                value={note}
                maxLength={NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                placeholder="A short line added to the message"
                className="h-11 w-full rounded-[var(--radius-input)] border border-line bg-card px-3 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <span className="mt-1 block text-xs text-ink-2">WhatsApp only allows pre-approved messages, so you can change this line but not the rest.</span>
            </label>
          </fieldset>

          <p className="text-xs text-ink-2">
            Last 30 days: {total} sent{props.counts.read ? ` · ${props.counts.read} read` : ""}
            {props.counts.failed ? <span className="font-medium text-danger"> · {props.counts.failed} failed</span> : null}
          </p>
        </div>

        {/* Live preview, as the tenant sees it */}
        <div className="border-y border-line bg-[#efeae2] p-4 md:p-6 lg:border-l lg:border-t-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-2">Preview</p>
          <div className="max-w-sm rounded-lg rounded-tl-none bg-white p-3 text-[13px] leading-relaxed text-ink shadow-sm whitespace-pre-line break-words">
            {/* WhatsApp shows *text* in bold. */}
            {preview.split(/\*([^*\n]+)\*/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}
          </div>
          {props.template === "rf_bill" || props.template === "rf_reminder" ? (
            <div className="mt-1.5 grid max-w-sm gap-1.5" style={{ gridTemplateColumns: props.template === "rf_bill" ? "1fr 1fr" : "1fr" }}>
              {props.template === "rf_bill" ? <span className="rounded-lg bg-white py-2 text-center text-[13px] font-medium text-[#027eb5] shadow-sm">View details</span> : null}
              <span className="rounded-lg bg-white py-2 text-center text-[13px] font-medium text-[#027eb5] shadow-sm">Pay now ↗</span>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-ink-2">Example amounts. Each tenant gets their own bill, in their own language.</p>
        </div>
        </div>
      </ActionForm>
    </article>
  );
}
