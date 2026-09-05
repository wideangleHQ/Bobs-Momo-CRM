'use client';

import { useEffect, useRef, useState } from 'react';

// Charts are hand drawn SVG. No charting library is installed and the four
// shapes this app needs are a few dozen lines each.
//
// ponytail: bar geometry uses Number() on the decimal strings. That is pixel
// maths, not money maths. Every figure a human reads is formatted through
// lib/format by the caller and passed in as `formatValue`.

export const SERIES_COLORS = ['#dc2626', '#18181b', '#ca8a04', '#52525b', '#991b1b'] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? '#dc2626';
}


/** Container width in CSS pixels, so text stays the same size at every width. */
export function useMeasuredWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export interface ChartSeries {
  key: string;
  label: string;
}

export interface ChartRow {
  label: string;
  values: Record<string, number>;
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function Legend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: seriesColor(i) }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

interface BarChartProps {
  rows: ChartRow[];
  series: ChartSeries[];
  /** Renders the y axis ticks and the accessible summary. */
  formatValue: (value: number) => string;
  stacked?: boolean;
  height?: number;
  title: string;
}

/** Vertical bars, grouped or stacked. Used for sales by day and payment mix. */
export function BarChart({
  rows,
  series,
  formatValue,
  stacked = false,
  height = 220,
  title,
}: BarChartProps) {
  const [ref, width] = useMeasuredWidth();

  const padLeft = 56;
  const padRight = 8;
  const padTop = 8;
  const padBottom = 28;
  const plotW = Math.max(0, width - padLeft - padRight);
  const plotH = height - padTop - padBottom;

  const peak = rows.reduce((max, row) => {
    const total = stacked
      ? series.reduce((sum, s) => sum + (row.values[s.key] ?? 0), 0)
      : series.reduce((m, s) => Math.max(m, row.values[s.key] ?? 0), 0);
    return Math.max(max, total);
  }, 0);
  const top = niceCeil(peak);

  const slot = rows.length > 0 ? plotW / rows.length : 0;
  const barGap = Math.min(6, slot * 0.15);
  const groupW = Math.max(2, slot - barGap);
  const barW = stacked ? groupW : Math.max(2, groupW / series.length);

  // A 360px phone fits about ten date labels. Thin them rather than overlap.
  const labelEvery = slot > 0 ? Math.max(1, Math.ceil(34 / slot)) : 1;

  return (
    <div ref={ref} className="w-full">
      {width > 0 && rows.length > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. Highest value ${formatValue(peak)}.`}
          className="overflow-visible text-text-muted"
        >
          <title>{title}</title>
          {[0, 0.5, 1].map((fraction) => {
            const y = padTop + plotH - plotH * fraction;
            return (
              <g key={fraction}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth={1}
                  opacity={0.35}
                />
                <text
                  x={padLeft - 6}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="currentColor"
                  className="text-text-muted"
                >
                  {formatValue(top * fraction)}
                </text>
              </g>
            );
          })}

          {rows.map((row, rowIndex) => {
            const x0 = padLeft + rowIndex * slot;
            let stackBase = 0;
            return (
              <g key={`${row.label}-${rowIndex}`}>
                {series.map((s, seriesIndex) => {
                  const raw = row.values[s.key] ?? 0;
                  const h = top > 0 ? (raw / top) * plotH : 0;
                  const x = stacked ? x0 + barGap / 2 : x0 + barGap / 2 + seriesIndex * barW;
                  const y = stacked
                    ? padTop + plotH - stackBase - h
                    : padTop + plotH - h;
                  stackBase += h;
                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={y}
                      width={Math.max(1, barW - (stacked ? 0 : 1))}
                      height={Math.max(raw > 0 ? 1 : 0, h)}
                      fill={seriesColor(seriesIndex)}
                      rx={1}
                    >
                      <title>{`${row.label} ${s.label}: ${formatValue(raw)}`}</title>
                    </rect>
                  );
                })}
                {rowIndex % labelEvery === 0 ? (
                  <text
                    x={x0 + slot / 2}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize={11}
                    fill="currentColor"
                    className="text-text-muted"
                  >
                    {row.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} aria-hidden="true" />
      )}
      <Legend series={series} />
    </div>
  );
}

interface HBarChartProps {
  rows: Array<{ label: string; value: number; sublabel?: string }>;
  formatValue: (value: number) => string;
  title: string;
}

/** Horizontal bars with the label above each bar so long item names survive 360px. */
export function HBarChart({ rows, formatValue, title }: HBarChartProps) {
  const peak = rows.reduce((max, row) => Math.max(max, row.value), 0);
  const top = niceCeil(peak);

  return (
    <ul className="space-y-2" aria-label={title}>
      {rows.map((row, index) => (
        <li key={`${row.label}-${index}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-text">{row.label}</span>
            <span className="shrink-0 tabular-nums text-text">
              {formatValue(row.value)}
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-border">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${top > 0 ? Math.max(1, (row.value / top) * 100) : 0}%`,
                background: seriesColor(0),
              }}
            />
          </div>
          {row.sublabel ? (
            <p className="mt-0.5 text-xs text-text-muted">{row.sublabel}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface LineChartProps {
  rows: ChartRow[];
  series: ChartSeries[];
  formatValue: (value: number) => string;
  height?: number;
  title: string;
}

/** One line per series over an ordered x axis. Gaps in a series break the line. */
export function LineChart({ rows, series, formatValue, height = 220, title }: LineChartProps) {
  const [ref, width] = useMeasuredWidth();

  const padLeft = 56;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 28;
  const plotW = Math.max(0, width - padLeft - padRight);
  const plotH = height - padTop - padBottom;

  const present = rows.flatMap((row) =>
    series.map((s) => row.values[s.key]).filter((v): v is number => typeof v === 'number'),
  );
  const rawMax = present.length > 0 ? Math.max(...present) : 0;
  const rawMin = present.length > 0 ? Math.min(...present) : 0;
  const top = niceCeil(rawMax);
  // A price line that never approaches zero is unreadable on a zero baseline.
  const base = rawMin > 0 && rawMin > top * 0.4 ? Math.floor(rawMin * 0.9) : 0;
  const span = Math.max(1, top - base);

  const stepX = rows.length > 1 ? plotW / (rows.length - 1) : 0;
  const pointX = (i: number) => padLeft + (rows.length > 1 ? i * stepX : plotW / 2);
  const pointY = (v: number) => padTop + plotH - ((v - base) / span) * plotH;
  const labelEvery = stepX > 0 ? Math.max(1, Math.ceil(46 / stepX)) : 1;

  return (
    <div ref={ref} className="w-full">
      {width > 0 && rows.length > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. Range ${formatValue(rawMin)} to ${formatValue(rawMax)}.`}
          className="overflow-visible text-text-muted"
        >
          <title>{title}</title>
          {[0, 0.5, 1].map((fraction) => {
            const y = padTop + plotH - plotH * fraction;
            return (
              <g key={fraction}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth={1}
                  opacity={0.35}
                />
                <text
                  x={padLeft - 6}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="currentColor"
                  className="text-text-muted"
                >
                  {formatValue(base + span * fraction)}
                </text>
              </g>
            );
          })}

          {series.map((s, seriesIndex) => {
            const segments: string[] = [];
            let current: string[] = [];
            rows.forEach((row, i) => {
              const v = row.values[s.key];
              if (typeof v !== 'number') {
                if (current.length > 0) segments.push(current.join(' '));
                current = [];
                return;
              }
              current.push(`${current.length === 0 ? 'M' : 'L'}${pointX(i)},${pointY(v)}`);
            });
            if (current.length > 0) segments.push(current.join(' '));

            return (
              <g key={s.key}>
                {segments.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={seriesColor(seriesIndex)}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
                {rows.map((row, i) => {
                  const v = row.values[s.key];
                  if (typeof v !== 'number') return null;
                  return (
                    <circle
                      key={`${s.key}-${i}`}
                      cx={pointX(i)}
                      cy={pointY(v)}
                      r={2.5}
                      fill={seriesColor(seriesIndex)}
                    >
                      <title>{`${row.label} ${s.label}: ${formatValue(v)}`}</title>
                    </circle>
                  );
                })}
              </g>
            );
          })}

          {rows.map((row, i) =>
            i % labelEvery === 0 ? (
              <text
                key={`x-${i}`}
                x={pointX(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
                className="text-text-muted"
              >
                {row.label}
              </text>
            ) : null,
          )}
        </svg>
      ) : (
        <div style={{ height }} aria-hidden="true" />
      )}
      <Legend series={series} />
    </div>
  );
}
