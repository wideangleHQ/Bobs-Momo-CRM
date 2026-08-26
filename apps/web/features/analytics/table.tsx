'use client';

import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';

// A column driven wrapper over the shared Table primitives. Six reports draw
// the same grid with different columns, so the shape lives here once.

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  cell: (row: T) => React.ReactNode;
}

interface ReportTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  caption: string;
}

export function ReportTable<T>({ columns, rows, rowKey, caption }: ReportTableProps<T>) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <THead>
        <TR>
          {columns.map((column) => (
            <TH
              key={column.key}
              scope="col"
              className={column.align === 'right' ? 'text-right' : 'text-left'}
            >
              {column.header}
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {rows.map((row, index) => (
          <TR key={rowKey(row, index)}>
            {columns.map((column) => (
              <TD key={column.key} numeric={column.align === 'right'}>
                {column.cell(row)}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** "no data" reads as "we have no figure", which is not the same as zero. */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'no data';
  return String(value);
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'no data';
  return `${(value * 100).toFixed(1)}%`;
}

export function signedPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'no data';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}
