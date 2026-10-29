import type { ReactNode } from 'react';
import { barSlots, extent, lineRuns, niceCeil, scaleLinear, toPath } from '@/lib/chart';

/**
 * Small inline SVG charts. They draw only numbers they are handed, carry a text alternative
 * (role="img", aria-label and a <desc>) and sit next to a table of the same figures on every page.
 */

const W = 640;
const H = 180;
const L = 64;
const R = 8;
const T = 10;
const B = 22;
const PW = W - L - R;
const PH = H - T - B;

type Fill = 'fill-brand' | 'fill-good' | 'fill-bad' | 'fill-muted';
type Stroke = 'stroke-brand' | 'stroke-good' | 'stroke-bad';

function Frame({
  ariaLabel,
  desc,
  children,
}: {
  ariaLabel: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      className="h-auto w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{ariaLabel}</title>
      <desc>{desc}</desc>
      {children}
    </svg>
  );
}

function YLabel({ y, text }: { y: number; text: string }) {
  return (
    <text x={L - 6} y={y + 3} textAnchor="end" className="fill-muted" fontSize="10">
      {text}
    </text>
  );
}

function XLabels({ first, last }: { first?: string; last?: string }) {
  return (
    <>
      {first ? (
        <text x={L} y={H - 6} textAnchor="start" className="fill-muted" fontSize="10">
          {first}
        </text>
      ) : null}
      {last ? (
        <text x={W - R} y={H - 6} textAnchor="end" className="fill-muted" fontSize="10">
          {last}
        </text>
      ) : null}
    </>
  );
}

/** Vertical bars, one per label, from zero up to a tidy maximum. */
export function BarChart({
  data,
  ariaLabel,
  format = String,
  fill = 'fill-brand',
}: {
  data: { label: string; value: number }[];
  ariaLabel: string;
  format?: (value: number) => string;
  fill?: Fill;
}) {
  const max = niceCeil(Math.max(0, ...data.map((d) => d.value)));
  const y = scaleLinear(0, max, PH, 0);
  const slots = barSlots(data.length, PW, 0.2);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Frame
      ariaLabel={ariaLabel}
      desc={`${data.length} values, total ${format(total)}, highest ${format(Math.max(0, ...data.map((d) => d.value)))}.`}
    >
      <g transform={`translate(${L} ${T})`}>
        <line x1={0} x2={PW} y1={PH} y2={PH} className="stroke-line" />
        <line x1={0} x2={PW} y1={0} y2={0} className="stroke-line" strokeDasharray="3 3" />
        {data.map((d, i) => {
          const slot = slots[i];
          if (!slot) return null;
          const h = PH - y(d.value);
          return (
            <rect
              key={`${d.label}-${i}`}
              x={slot.x}
              y={y(d.value)}
              width={slot.w}
              height={Math.max(h, d.value > 0 ? 1 : 0)}
              className={fill}
            >
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </g>
      <YLabel y={T} text={format(max)} />
      <YLabel y={T + PH} text={format(0)} />
      <XLabels first={data[0]?.label} last={data.length > 1 ? data[data.length - 1]?.label : ''} />
    </Frame>
  );
}

/** Two bars per label side by side (for example money in and money out). */
export function GroupedBars({
  data,
  ariaLabel,
  format = String,
  aFill = 'fill-good',
  bFill = 'fill-bad',
  aName,
  bName,
}: {
  data: { label: string; a: number; b: number }[];
  ariaLabel: string;
  format?: (value: number) => string;
  aFill?: Fill;
  bFill?: Fill;
  aName: string;
  bName: string;
}) {
  const max = niceCeil(Math.max(0, ...data.flatMap((d) => [d.a, d.b])));
  const y = scaleLinear(0, max, PH, 0);
  const slots = barSlots(data.length, PW, 0.2);
  return (
    <Frame
      ariaLabel={ariaLabel}
      desc={`${data.length} periods, each with ${aName} and ${bName}. The table below has every figure.`}
    >
      <g transform={`translate(${L} ${T})`}>
        <line x1={0} x2={PW} y1={PH} y2={PH} className="stroke-line" />
        <line x1={0} x2={PW} y1={0} y2={0} className="stroke-line" strokeDasharray="3 3" />
        {data.map((d, i) => {
          const slot = slots[i];
          if (!slot) return null;
          const half = slot.w / 2;
          return (
            <g key={`${d.label}-${i}`}>
              <rect
                x={slot.x}
                y={y(d.a)}
                width={half}
                height={Math.max(PH - y(d.a), d.a > 0 ? 1 : 0)}
                className={aFill}
              >
                <title>{`${d.label}, ${aName}: ${format(d.a)}`}</title>
              </rect>
              <rect
                x={slot.x + half}
                y={y(d.b)}
                width={half}
                height={Math.max(PH - y(d.b), d.b > 0 ? 1 : 0)}
                className={bFill}
              >
                <title>{`${d.label}, ${bName}: ${format(d.b)}`}</title>
              </rect>
            </g>
          );
        })}
      </g>
      <YLabel y={T} text={format(max)} />
      <YLabel y={T + PH} text={format(0)} />
      <XLabels first={data[0]?.label} last={data.length > 1 ? data[data.length - 1]?.label : ''} />
    </Frame>
  );
}

/** One line over labelled points; a null value leaves a gap, a negative value dips below the zero line. */
export function LineChart({
  labels,
  values,
  ariaLabel,
  format = String,
  stroke = 'stroke-brand',
  fill = 'fill-brand',
}: {
  labels: string[];
  values: (number | null)[];
  ariaLabel: string;
  format?: (value: number) => string;
  stroke?: Stroke;
  fill?: Fill;
}) {
  const [min, max] = extent(values);
  const runs = lineRuns(values, { width: PW, height: PH, min, max });
  const zeroY = scaleLinear(min, max, PH, 0)(0);
  const known = values.filter((v): v is number => v !== null);
  const last = known[known.length - 1];
  return (
    <Frame
      ariaLabel={ariaLabel}
      desc={`${values.length} points from ${labels[0] ?? ''} to ${labels[labels.length - 1] ?? ''}, lowest ${format(min)}, highest ${format(max)}${last === undefined ? '' : `, latest ${format(last)}`}.`}
    >
      <g transform={`translate(${L} ${T})`}>
        <line x1={0} x2={PW} y1={PH} y2={PH} className="stroke-line" />
        {min < 0 ? (
          <line
            x1={0}
            x2={PW}
            y1={zeroY}
            y2={zeroY}
            className="stroke-muted"
            strokeDasharray="3 3"
          />
        ) : null}
        {runs.map((run) => (
          <path
            key={run[0]?.index ?? 0}
            d={toPath(run)}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            className={stroke}
          />
        ))}
        {runs.flat().map((p) => (
          <circle key={p.index} cx={p.x} cy={p.y} r={3} className={fill}>
            <title>{`${labels[p.index] ?? ''}: ${format(p.value)}`}</title>
          </circle>
        ))}
      </g>
      <YLabel y={T} text={format(max)} />
      <YLabel y={T + PH} text={format(min)} />
      <XLabels first={labels[0]} last={labels.length > 1 ? labels[labels.length - 1] : ''} />
    </Frame>
  );
}

/** Horizontal bars, one row per label, for a handful of buckets such as stock ageing. */
export function HBars({
  rows,
  ariaLabel,
  format = String,
  fill = 'fill-brand',
}: {
  rows: { label: string; value: number; note?: string }[];
  ariaLabel: string;
  format?: (value: number) => string;
  fill?: Fill;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={ariaLabel} className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[5rem_1fr_9rem] items-center gap-3 text-sm">
          <span className="text-muted">{r.label}</span>
          <svg
            viewBox="0 0 100 8"
            preserveAspectRatio="none"
            className="h-3 w-full"
            role="img"
            aria-label={`${r.label}: ${format(r.value)}${r.note ? `, ${r.note}` : ''}`}
          >
            <rect x={0} y={0} width={100} height={8} className="fill-surface" />
            <rect
              x={0}
              y={0}
              width={(Math.max(r.value, 0) / max) * 100}
              height={8}
              className={fill}
            />
          </svg>
          <span className="text-right tabular-nums">
            {format(r.value)}
            {r.note ? <span className="ml-1 text-xs text-muted">{r.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Average cost against price: two bars on one scale, so the gap between them is the margin. */
export function CostPriceBar({
  costMinor,
  priceMinor,
  format,
}: {
  costMinor: number;
  priceMinor: number;
  format: (minor: number) => string;
}) {
  const max = Math.max(costMinor, priceMinor, 1);
  const below = costMinor > priceMinor;
  const rows: { label: string; value: number; fill: Fill }[] = [
    { label: 'Average cost', value: costMinor, fill: below ? 'fill-bad' : 'fill-muted' },
    { label: 'Selling price', value: priceMinor, fill: 'fill-brand' },
  ];
  return (
    <div>
      <ul
        aria-label={`Average cost ${format(costMinor)} against selling price ${format(priceMinor)}`}
        className="space-y-2"
      >
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[6.5rem_1fr_6rem] items-center gap-3 text-sm">
            <span className="text-muted">{r.label}</span>
            <svg
              viewBox="0 0 100 8"
              preserveAspectRatio="none"
              className="h-3 w-full"
              role="img"
              aria-label={`${r.label}: ${format(r.value)}`}
            >
              <rect x={0} y={0} width={100} height={8} className="fill-surface" />
              <rect x={0} y={0} width={(r.value / max) * 100} height={8} className={r.fill} />
            </svg>
            <span className="text-right tabular-nums">{format(r.value)}</span>
          </li>
        ))}
      </ul>
      {below ? <p className="mt-2 text-xs text-bad">Selling below cost.</p> : null}
    </div>
  );
}
