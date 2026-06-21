export type LineRange = {
  start: number;
  end: number;
};

export function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}

export function mergeRanges(ranges: LineRange[]): LineRange[] {
  const sorted = ranges
    .filter((range) => range.start > 0 && range.end >= range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (!last || range.start > last.end + 1) {
      merged.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }

  return merged;
}

export function addLineRange(ranges: LineRange[], start: number, lineCount: number): LineRange[] {
  if (lineCount <= 0) return ranges;

  return mergeRanges([...ranges, { start, end: start + lineCount - 1 }]);
}

export function countRangeLines(ranges: LineRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
}

function formatLineRange(range: LineRange): string {
  return range.start === range.end ? `line ${range.start}` : `lines ${range.start}-${range.end}`;
}

export function formatLineRanges(ranges: LineRange[]): string {
  return ranges.map(formatLineRange).join(', ');
}
