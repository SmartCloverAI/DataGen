type CsvOptions = { delimiter?: string };

function escapeCsv(value: unknown, delimiter: string) {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  const needsQuotes = str.includes(delimiter) || str.includes("\n") || str.includes('"');
  if (!needsQuotes) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Array<Record<string, unknown>>, opts: CsvOptions = {}) {
  const delimiter = opts.delimiter ?? ",";
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row ?? {}).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );
  if (headers.length === 0) return "";
  const lines = [headers.join(delimiter)];
  for (const row of rows) {
    const line = headers
      .map((h) => escapeCsv((row ?? {})[h], delimiter))
      .join(delimiter);
    lines.push(line);
  }
  return lines.join("\n");
}

export function normalizeResultsForCsv(results: unknown[]): Array<Record<string, unknown>> {
  return results.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return item as Record<string, unknown>;
    }
    return { value: item };
  });
}
