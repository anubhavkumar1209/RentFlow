"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { importAction, type ImportState } from "./actions";

export function ImportForm({ properties }: { properties: { id: string; name: string }[] }) {
  const [state, run, pending] = useActionState(importAction, {} as ImportState);
  const [transitioning, start] = useTransition();
  const busy = pending || transitioning;
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(() => run(data));
  };

  if (state.imported) {
    return (
      <div className="space-y-3">
        <p className="rounded-[var(--radius-input)] bg-brand-50 px-4 py-3 text-brand-700">
          Imported {state.imported} tenant{state.imported === 1 ? "" : "s"}. Each one is getting a WhatsApp welcome.
        </p>
        <Link href="/tenants" className="inline-flex h-11 items-center rounded-[var(--radius-input)] bg-brand-600 px-4 font-semibold text-white">
          See tenants
        </Link>
      </div>
    );
  }

  const ready = state.preview && state.preview.length > 0 && state.errors?.length === 0;
  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Property</span>
          <select name="propertyId" className="h-11 w-full rounded-[var(--radius-input)] border border-line px-3" defaultValue={state.propertyId}>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">CSV or Excel file</span>
          <input name="file" type="file" accept=".csv,.xlsx,text/csv" className="block w-full text-sm file:mr-3 file:h-10 file:rounded-[var(--radius-input)] file:border-0 file:bg-page file:px-4" />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="depositReceived" defaultChecked className="size-5 accent-brand-600" /> Deposits already received
        </label>
        <button disabled={busy} className="h-11 rounded-[var(--radius-input)] border border-line bg-card px-4 font-semibold disabled:opacity-60">
          {busy ? "Checking…" : "Check file"}
        </button>
      </form>

      {state.error ? <p className="rounded-[var(--radius-input)] bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p> : null}

      {state.errors && state.errors.length > 0 ? (
        <div className="rounded-[var(--radius-input)] border border-danger bg-danger-soft p-3 text-sm">
          <p className="mb-2 font-semibold text-danger">Fix these rows and upload again — nothing has been imported:</p>
          <ul className="space-y-1 text-danger">
            {state.errors.map((e) => (
              <li key={e.row}>
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ready ? (
        <form onSubmit={submit} className="space-y-3 rounded-[var(--radius-input)] border border-line p-3">
          <p className="font-semibold">All {state.preview!.length} rows look good:</p>
          <ul className="max-h-64 overflow-auto text-sm">
            {state.preview!.map((r) => (
              <li key={r.row} className="flex justify-between border-b border-line py-1">
                <span>{r.name}</span>
                <span className="text-ink-2">
                  {r.phone} · {r.bed}
                </span>
              </li>
            ))}
          </ul>
          <input type="hidden" name="confirm" value="1" />
          <input type="hidden" name="rowsJson" value={state.rowsJson} />
          <input type="hidden" name="propertyId" value={state.propertyId} />
          {state.depositReceived ? <input type="hidden" name="depositReceived" value="on" /> : null}
          <button disabled={busy} className="h-11 rounded-[var(--radius-input)] bg-brand-600 px-4 font-semibold text-white disabled:opacity-60">
            {busy ? "Importing…" : `Import ${state.preview!.length} tenants`}
          </button>
        </form>
      ) : null}
    </div>
  );
}
