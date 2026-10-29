/** Money is stored as integer minor units (cents); this is the only place it becomes text. */
const money = new Intl.NumberFormat('en-ET', {
  style: 'currency',
  currency: 'ETB',
  currencyDisplay: 'narrowSymbol',
});

export function formatMoney(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '–';
  return money.format(minor / 100);
}

/** "12.50" -> 1250. Returns null for anything that is not a plain non-negative amount. */
export function parseMoney(input: string): number | null {
  const t = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Minor units as an editable decimal string ("1250" -> "12.50"). */
export function toInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 100).toFixed(2);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthStart(): string {
  return `${today().slice(0, 8)}01`;
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '–' : `${value.toFixed(1)}%`;
}

export function label(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** Short money for chart axes: 50,000,000 minor units -> "500K". No currency symbol. */
export function formatMoneyCompact(minor: number): string {
  return compact.format(minor / 100);
}
