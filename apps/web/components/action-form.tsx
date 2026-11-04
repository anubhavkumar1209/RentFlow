"use client";

import { Alert, buttonClass, ConfirmDialog, toast } from "@rentflow/ui";
import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionState } from "@/lib/actions";

/**
 * A form wired to a server action (CLAUDE.md H5): success is a toast, errors
 * show inline, sensitive actions ask in a dialog first, and what was typed is
 * kept after an error (it submits without React's automatic form reset).
 */
export function ActionForm({
  action,
  children,
  submit,
  className = "space-y-3",
  resetOnSuccess = false,
  confirm,
  variant = "primary",
  inline = false,
  submitClassName,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submit: string;
  className?: string;
  resetOnSuccess?: boolean;
  /** Ask "Are you sure?" with this text before submitting. */
  confirm?: string;
  variant?: "primary" | "secondary" | "danger";
  inline?: boolean;
  /** Extra classes for the submit button (e.g. to place it inside a card). */
  submitClassName?: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  const [transitioning, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const pendingData = useRef<FormData | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  const busy = pending || transitioning;

  useEffect(() => {
    if (state.ok) {
      toast.success(state.ok);
      if (resetOnSuccess) ref.current?.reset();
    }
  }, [state, resetOnSuccess]);

  const send = (data: FormData) => startTransition(() => run(data));

  return (
    <form
      ref={ref}
      className={inline ? "inline-flex flex-col gap-1" : className}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        if (confirm) {
          pendingData.current = data;
          setAsking(true);
          return;
        }
        send(data);
      }}
    >
      {children}
      {state.error ? <Alert>{state.error}</Alert> : null}
      <button disabled={busy} className={buttonClass(variant, inline ? "sm" : "md", submitClassName)}>
        {busy ? "Saving…" : submit}
      </button>
      {confirm ? (
        <ConfirmDialog
          open={asking}
          onOpenChange={setAsking}
          title={submit}
          description={confirm}
          confirmLabel={submit}
          danger={variant === "danger"}
          onConfirm={() => {
            if (pendingData.current) send(pendingData.current);
          }}
        />
      ) : null}
    </form>
  );
}
