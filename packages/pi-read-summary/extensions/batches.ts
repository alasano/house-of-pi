import type { LineRange } from './ranges';

export type ReadBatchEntry = {
  path: string;
  ranges: LineRange[];
  inFlight: number;
  isImage: boolean;
  failed: boolean;
};

export type ReadBatch = {
  id: string;
  anchorToolCallId: string;
  entries: ReadBatchEntry[];
  inFlight: number;
  pendingFinalize: boolean;
  done: boolean;
};

export function getOrCreateEntry(batch: ReadBatch, path: string): ReadBatchEntry | undefined {
  if (!path) return undefined;

  const existing = batch.entries.find((entry) => entry.path === path);
  if (existing) return existing;

  const entry: ReadBatchEntry = {
    path,
    ranges: [],
    inFlight: 0,
    isImage: false,
    failed: false,
  };
  batch.entries.push(entry);
  return entry;
}

export function markEntryFailed(
  batches: Map<string, ReadBatch>,
  batchId: string,
  path: string,
): void {
  const batch = batches.get(batchId);
  if (!batch) return;

  const entry = getOrCreateEntry(batch, path);
  if (entry) {
    entry.failed = true;
  }
}
