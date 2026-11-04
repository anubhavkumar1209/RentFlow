"use client";

import { buttonClass, cn } from "@rentflow/ui";
import { Check, Copy, ImageUp, LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { uploadScreenshotAction, type UploadState } from "./actions";

export function CopyButton({ value, label, copied }: { value: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          // Clipboard blocked (old browser / insecure context): the value is on screen to copy by hand.
        }
      }}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-input)] px-3 text-sm font-semibold text-primary hover:bg-primary-soft"
      aria-label={`${label}: ${value}`}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      {done ? copied : label}
    </button>
  );
}

export interface UploadText {
  title: string;
  hint: string;
  choose: string;
  send: string;
  sending: string;
  saved: string;
  duplicate: string;
  invalid: string;
  missing: string;
  tooBig: string;
  error: string;
}

export function ScreenshotUpload({ token, text }: { token: string; text: UploadText }) {
  const [state, run, pending] = useActionState<UploadState, FormData>(uploadScreenshotAction.bind(null, token), {});
  const [name, setName] = useState("");
  const message = state.result
    ? { saved: text.saved, duplicate: text.duplicate, invalid: text.invalid, missing: text.missing, too_big: text.tooBig, error: text.error }[state.result]
    : null;
  return (
    <form action={run} className="space-y-3">
      <div>
        <p className="font-semibold text-ink">{text.title}</p>
        <p className="text-sm text-ink-2">{text.hint}</p>
      </div>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-input)] border border-dashed border-line bg-page px-4 text-sm text-ink-2 hover:border-primary">
        <ImageUp className="size-5 shrink-0 text-primary" />
        <span className="truncate">{name || text.choose}</span>
        <input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setName(e.target.files?.[0]?.name ?? "")} />
      </label>
      {message ? (
        <p role="status" className={cn("rounded-[var(--radius-input)] px-3 py-2 text-sm", state.result === "saved" ? "bg-primary-soft text-primary" : "bg-warning-soft text-warning")}>
          {message}
        </p>
      ) : null}
      <button disabled={pending} className={buttonClass("secondary", "lg", "w-full")}>
        {pending ? <LoaderCircle className="animate-spin" /> : null}
        {pending ? text.sending : text.send}
      </button>
    </form>
  );
}
