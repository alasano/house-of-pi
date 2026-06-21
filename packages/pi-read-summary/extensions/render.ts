import type { Component } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { ReadBatch, ReadBatchEntry } from './batches';
import { stylePath, type ThemeLike } from './paths';
import { countRangeLines, formatLineRanges } from './ranges';

function pluralizeFiles(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

function pluralizeLines(count: number): string {
  return `${count} line${count === 1 ? '' : 's'}`;
}

function getEntryStatus(entry: ReadBatchEntry, theme: ThemeLike): string {
  if (entry.failed) {
    return `${theme.fg('dim', '[')}${theme.fg('warning', 'Read failed')}${theme.fg('dim', ']')}`;
  }

  if (entry.isImage) {
    return `${theme.fg('dim', '[')}${theme.fg('muted', 'Read image')}${theme.fg('dim', ']')}`;
  }

  const uniqueLineCount = countRangeLines(entry.ranges);
  if (uniqueLineCount > 0) {
    return `${theme.fg('dim', '[')}${theme.fg('muted', `Read ${pluralizeLines(uniqueLineCount)}`)}${theme.fg('dim', ']')}`;
  }

  if (entry.inFlight > 0) {
    return `${theme.fg('dim', '[')}${theme.fg('muted', 'Reading…')}${theme.fg('dim', ']')}`;
  }

  return `${theme.fg('dim', '[')}${theme.fg('muted', 'Read file')}${theme.fg('dim', ']')}`;
}

function formatEntryLine(entry: ReadBatchEntry, theme: ThemeLike, width: number): string {
  const prefix = theme.fg('dim', '└─ "');
  const path = stylePath(entry.path, theme);
  const suffix = theme.fg('dim', '"');
  const annotation = getEntryStatus(entry, theme);
  const suffixAndAnnotation = `${suffix} ${annotation}`;
  const pathWidth = width - visibleWidth(prefix) - visibleWidth(suffixAndAnnotation);

  if (pathWidth <= 0) {
    return truncateToWidth(`${prefix}${path}${suffixAndAnnotation}`, width);
  }

  return `${prefix}${truncateToWidth(path, pathWidth, '…')}${suffixAndAnnotation}`;
}

export function createReadSummaryComponent(
  batchId: string,
  batches: Map<string, ReadBatch>,
  theme: ThemeLike,
  expanded: boolean,
): Component {
  return {
    render(width: number): string[] {
      const batch = batches.get(batchId);
      if (!batch) return [];

      const safeWidth = Math.max(1, width);
      const fileCount = batch.entries.length;
      const failedCount = batch.entries.filter((entry) => entry.failed).length;
      const statusDot = batch.done ? theme.fg('success', '●') : theme.fg('text', '○');
      const statusText = batch.done
        ? theme.fg('success', `Read ${pluralizeFiles(fileCount)}`)
        : theme.fg('accent', `Reading ${pluralizeFiles(fileCount)}…`);

      let firstLine = `${statusDot} ${statusText}`;
      if (failedCount > 0) {
        firstLine += ` ${theme.fg('warning', `(${failedCount} failed)`)}`;
      }

      const lines = [truncateToWidth(firstLine, safeWidth)];

      for (const entry of batch.entries) {
        lines.push(formatEntryLine(entry, theme, safeWidth));

        if (expanded && entry.ranges.length > 0) {
          lines.push(
            truncateToWidth(
              `${theme.fg('dim', '   ')} ${theme.fg('muted', formatLineRanges(entry.ranges))}`,
              safeWidth,
            ),
          );
        }
      }

      return lines;
    },
    invalidate() {},
  };
}
