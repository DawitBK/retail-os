'use client';

/** Opens the browser's print dialog; the print stylesheet hides the menus, so "Save as PDF" is clean. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn" onClick={() => window.print()}>
      {label}
    </button>
  );
}
