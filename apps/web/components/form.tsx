'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call, type CallResult } from '@/lib/client-api';
import { Notice } from './ui';

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : null}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] rounded-lg border border-line p-0 shadow-xl backdrop:bg-black/40 ${wide ? 'max-w-3xl' : 'max-w-md'}`}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="p-4">{open ? children : null}</div>
    </dialog>
  );
}

/** Runs a mutation, shows the API's message on failure and refreshes the page data on success. */
export function useMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function run<T>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options: { headers?: Record<string, string>; refresh?: boolean } = {},
  ): Promise<CallResult<T>> {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const result = await call<T>(method, path, body, options.headers);
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? 'Something went wrong');
      setFieldErrors(result.fieldErrors ?? {});
    } else if (options.refresh !== false) {
      router.refresh();
    }
    return result;
  }
  return { busy, error, fieldErrors, run, reset: () => setError(null) };
}

/** A button that asks for a reason in a small dialog before doing something that is hard to undo. */
export function ReasonButton({
  label,
  title,
  path,
  danger,
  field = 'reason',
  required = true,
  confirmLabel,
  disabled,
}: {
  label: string;
  title: string;
  path: string;
  danger?: boolean;
  field?: string;
  required?: boolean;
  confirmLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const m = useMutation();
  return (
    <>
      <button
        type="button"
        className={`btn ${danger ? 'text-bad' : ''}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await m.run('POST', path, reason.trim() ? { [field]: reason.trim() } : {});
            if (r.ok) {
              setOpen(false);
              setReason('');
            }
          }}
        >
          <Field label={required ? 'Reason' : 'Note (optional)'} error={m.fieldErrors[field]}>
            <textarea
              className="input min-h-20 py-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required={required}
              minLength={required ? 3 : undefined}
              maxLength={500}
            />
          </Field>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
              disabled={m.busy}
            >
              {confirmLabel ?? label}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** A single-click action with no extra input (approve, receive, cancel). */
export function ActionButton({
  label,
  path,
  body,
  danger,
  primary,
  confirm,
  method = 'POST',
}: {
  label: string;
  path: string;
  method?: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  danger?: boolean;
  primary?: boolean;
  confirm?: string;
}) {
  const m = useMutation();
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={`btn ${primary ? 'btn-primary' : ''} ${danger ? 'text-bad' : ''}`}
        disabled={m.busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          await m.run(method, path, method === 'DELETE' ? undefined : (body ?? {}));
        }}
      >
        {label}
      </button>
      {m.error ? <span className="mt-1 max-w-56 text-xs text-bad">{m.error}</span> : null}
    </span>
  );
}
