'use client';

import { useState } from 'react';
import { parseMoney, toInput } from '@/lib/format';
import { Field, Modal, useMutation } from './form';
import { Notice } from './ui';

export interface FieldDef {
  key: string;
  label: string;
  kind?: 'text' | 'email' | 'number' | 'money' | 'select' | 'textarea' | 'date' | 'password';
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  maxLength?: number;
  min?: number;
  /** Only sent when creating (it cannot be changed afterwards). */
  createOnly?: boolean;
  /** When editing, an empty value means "leave as is" rather than "clear". */
  keepIfEmpty?: boolean;
  /** A select whose "true"/"false" values are sent as booleans. */
  boolean?: boolean;
  /** Initial value for a new record. */
  initial?: string;
}

type Raw = Record<string, unknown>;

function initialValue(f: FieldDef, record: Raw | undefined): string {
  if (!record) return f.initial ?? (f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '');
  const v = record[f.key];
  if (v === null || v === undefined)
    return f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '';
  return f.kind === 'money' ? toInput(Number(v)) : String(v);
}

/**
 * One modal form for the many small records (customers, suppliers, categories, expenses, staff).
 * The server validates everything again; this only turns what was typed into the right JSON types.
 */
export function EntityForm({
  fields,
  record,
  createPath,
  updatePath,
  extra,
  title,
  submitLabel,
  onDone,
}: {
  fields: FieldDef[];
  record?: Raw & { version?: number };
  createPath: string;
  updatePath?: string;
  extra?: Raw;
  title?: string;
  submitLabel?: string;
  onDone: () => void;
}) {
  const editing = Boolean(record);
  const shown = fields.filter((f) => !(editing && f.createOnly));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(shown.map((f) => [f.key, initialValue(f, record)])),
  );
  const [local, setLocal] = useState<string | null>(null);
  const m = useMutation();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocal(null);
    const body: Raw = { ...(extra ?? {}) };
    for (const f of shown) {
      const raw = (values[f.key] ?? '').trim();
      if (raw === '') {
        if (editing && !f.required && !f.keepIfEmpty) body[f.key] = null;
        continue;
      }
      if (f.kind === 'money') {
        const minor = parseMoney(raw);
        if (minor === null) return setLocal(`${f.label}: enter an amount like 12.50`);
        body[f.key] = minor;
      } else if (f.boolean) {
        body[f.key] = raw === 'true';
      } else if (f.kind === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) return setLocal(`${f.label} must be a number`);
        body[f.key] = n;
      } else {
        body[f.key] = f.kind === 'password' ? values[f.key] : raw;
      }
    }
    if (editing) body['version'] = record?.version;
    const r =
      editing && updatePath
        ? await m.run('PATCH', updatePath, body)
        : await m.run('POST', createPath, body);
    if (r.ok) onDone();
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((f) => {
          const common = {
            className: 'input',
            value: values[f.key] ?? '',
            required: f.required,
            maxLength: f.maxLength,
            onChange: (e: { target: { value: string } }) =>
              setValues({ ...values, [f.key]: e.target.value }),
          };
          return (
            <div key={f.key} className={f.kind === 'textarea' ? 'sm:col-span-2' : ''}>
              <Field label={f.label} hint={f.hint} error={m.fieldErrors[f.key]}>
                {f.kind === 'select' ? (
                  <select {...common}>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.kind === 'textarea' ? (
                  <textarea {...common} className="input min-h-16 py-2" />
                ) : (
                  <input
                    {...common}
                    type={
                      f.kind === 'number'
                        ? 'number'
                        : (f.kind ?? 'text') === 'money'
                          ? 'text'
                          : (f.kind ?? 'text')
                    }
                    inputMode={f.kind === 'money' ? 'decimal' : undefined}
                    min={f.min}
                    autoComplete={f.kind === 'password' ? 'new-password' : 'off'}
                  />
                )}
              </Field>
            </div>
          );
        })}
      </div>
      {local ? <Notice tone="bad">{local}</Notice> : null}
      {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={m.busy} aria-label={title}>
          {submitLabel ?? (editing ? 'Save changes' : 'Create')}
        </button>
      </div>
    </form>
  );
}

/** A button that opens an EntityForm in a dialog. */
export function EntityButton({
  label,
  title,
  primary,
  ...form
}: {
  label: string;
  title: string;
  primary?: boolean;
} & Omit<React.ComponentProps<typeof EntityForm>, 'onDone' | 'title'>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`btn ${primary ? 'btn-primary' : ''}`}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} wide>
        <EntityForm {...form} title={title} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
