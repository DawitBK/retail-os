'use client';

import { useState } from 'react';
import { Field } from '@/components/form';
import { Notice, Stat } from '@/components/ui';
import { call } from '@/lib/client-api';
import { formatMoney } from '@/lib/format';
import { importTextProblem } from '@/lib/import-template';
import type { ImportReport } from '@/lib/types';

type Outcome =
  | { kind: 'report'; report: ImportReport }
  | { kind: 'refused'; message: string; errors: { path: string; message: string }[] };

export function ImportForm() {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** The exact text that passed the last check; changing the text clears the right to import. */
  const [checkedText, setCheckedText] = useState<string | null>(null);

  const imported = outcome?.kind === 'report' && outcome.report.applied;
  const canImport = checkedText !== null && checkedText === text && !imported && busy === null;

  async function run(dryRun: boolean) {
    const problem = importTextProblem(text);
    if (problem) {
      setLocal(problem);
      return;
    }
    setLocal(null);
    setBusy(dryRun ? 'check' : 'import');
    const r = await call<ImportReport>('POST', '/import/inventory', { content: text, dryRun });
    setBusy(null);
    if (r.ok && r.data) {
      setOutcome({ kind: 'report', report: r.data });
      setCheckedText(dryRun ? text : null);
    } else {
      setOutcome({
        kind: 'refused',
        message: r.message ?? 'The import was refused',
        errors: r.errors ?? [],
      });
      setCheckedText(null);
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setLocal(null);
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      setOutcome(null);
      setCheckedText(null);
    } catch {
      setLocal('That file could not be read.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <Field
          label="Choose a CSV file"
          hint="It is read in your browser and sent only when you check it."
        >
          <input
            className="input py-1.5"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => void chooseFile(e.target.files?.[0])}
          />
        </Field>
        <Field label={fileName ? `Rows from ${fileName}` : 'Or paste the rows here'}>
          <textarea
            className="input min-h-48 py-2 font-mono text-xs"
            value={text}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              setOutcome(null);
              setCheckedText(null);
            }}
          />
        </Field>
        {local ? <Notice tone="bad">{local}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            disabled={busy !== null || text.trim() === ''}
            onClick={() => void run(true)}
          >
            {busy === 'check' ? 'Checking...' : 'Check the file'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canImport}
            onClick={() => void run(false)}
          >
            {busy === 'import' ? 'Importing...' : 'Import'}
          </button>
        </div>
        <p className="text-xs text-muted">
          Import unlocks after a clean check, and locks again if you change the text.
        </p>
      </div>

      {outcome?.kind === 'refused' ? <Refusal outcome={outcome} /> : null}
      {outcome?.kind === 'report' ? <Report report={outcome.report} /> : null}
    </div>
  );
}

function Refusal({ outcome }: { outcome: Extract<Outcome, { kind: 'refused' }> }) {
  return (
    <section aria-label="Problems found" className="space-y-2">
      <Notice tone="bad">{outcome.message}</Notice>
      {outcome.errors.length > 0 ? (
        <div className="card max-h-96 overflow-y-auto">
          <ul className="divide-y divide-line text-sm">
            {outcome.errors.map((e, i) => (
              <li key={`${e.path}-${i}`} className="px-3 py-2">
                {e.path ? <span className="font-medium">{e.path}: </span> : null}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Report({ report }: { report: ImportReport }) {
  return (
    <section aria-label="Import report" className="space-y-3">
      <Notice tone="good">
        {report.applied
          ? `Imported. ${report.productsCreated} products were created${report.entryNumber ? `, booked in journal entry ${report.entryNumber}` : ''}.`
          : 'The file is clean. Nothing has been changed yet: press Import to bring it in.'}
      </Notice>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Rows read" value={report.rows} />
        <Stat label="Products to create" value={report.productsCreated} />
        <Stat
          label="Stock coming in"
          value={report.stockUnits}
          hint={`Worth ${formatMoney(report.stockValueMinor)} at cost`}
        />
        <Stat
          label="Already in the system"
          value={report.skippedExisting.length}
          hint="Left as they are"
        />
        <Stat label="New categories" value={report.categoriesCreated} />
        <Stat label="New sub-categories" value={report.subCategoriesCreated} />
        <Stat label="New brands" value={report.brandsCreated} />
        {report.entryNumber ? <Stat label="Journal entry" value={report.entryNumber} /> : null}
      </div>
      {report.skippedExisting.length > 0 ? (
        <p className="text-sm text-muted">
          Skipped because the SKU already exists: {report.skippedExisting.join(', ')}.
        </p>
      ) : null}
    </section>
  );
}
