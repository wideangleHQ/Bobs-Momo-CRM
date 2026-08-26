// CSV is built in the browser from the rows already on screen rather than
// through POST /analytics/export. The export endpoint streams text/csv, which
// the shared apiPost cannot return, and a plain download link cannot carry the
// bearer token. Same columns, same conventions as chapter 31.
//
// ponytail: swap to the server export if a report ever outgrows one page of
// rows, since only the server can page through the full result set.

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.join(','), ...rows.map((row) => row.map(escapeCell).join(','))];
  // Excel on Windows needs the byte order mark to read Odia and Hindi names.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function csvFilename(
  report: string,
  outletCodeOrAll: string,
  from: string,
  to: string,
): string {
  return `bobsmomo_${report}_${outletCodeOrAll}_${from}_${to}.csv`;
}

export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
