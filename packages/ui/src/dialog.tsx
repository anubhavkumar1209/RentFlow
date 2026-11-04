"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./cn";

const OVERLAY = "fixed inset-0 z-40 bg-ink/40";

/** Centred modal (radius 16, CLAUDE.md H2). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY} />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-modal)] bg-card p-6 shadow-xl outline-none">
          <RadixDialog.Title className="pr-8 text-lg font-semibold text-ink">{title}</RadixDialog.Title>
          {description ? <RadixDialog.Description className="mt-1 text-sm text-ink-2">{description}</RadixDialog.Description> : <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>}
          {children ? <div className="mt-4">{children}</div> : null}
          {footer ? <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div> : null}
          <RadixDialog.Close aria-label="Close" className="absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-[var(--radius-input)] text-ink-2 hover:bg-page">
            <X className="size-5" />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** "Are you sure?" before sensitive actions (approve, settle, void, delete, move-out). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            type="button"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/** Side panel: from the right on desktop, from the bottom on phones. */
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY} />
        <RadixDialog.Content
          className={cn(
            "fixed z-50 flex flex-col bg-card shadow-xl outline-none",
            "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[var(--radius-modal)]",
            "md:inset-y-0 md:left-auto md:right-0 md:h-dvh md:max-h-none md:w-[420px] md:rounded-none",
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <RadixDialog.Title className="text-base font-semibold text-ink">{title}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            <RadixDialog.Close aria-label="Close" className="inline-flex size-10 items-center justify-center rounded-[var(--radius-input)] text-ink-2 hover:bg-page">
              <X className="size-5" />
            </RadixDialog.Close>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
