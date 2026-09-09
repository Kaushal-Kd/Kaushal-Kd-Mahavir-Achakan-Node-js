/**
 * Lightweight CSV export.
 * Rows are array of objects; columns is an array of { key, header, get? }.
 */
export function downloadCsv(filename, columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = columns.map((c) => esc(c.header || c.key)).join(',');
  const body = (rows || [])
    .map((r) => columns.map((c) => esc(c.get ? c.get(r) : r[c.key])).join(','))
    .join('\n');
  const csv = '\ufeff' + header + '\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
