import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationResult,
} from '@earendil-works/pi-coding-agent';

const TEMP_FILE_PREFIX = 'pi-exa-';

export interface TruncatedToolOutput {
  text: string;
  truncation: TruncationResult;
  fullOutputPath?: string;
}

export async function truncateToolOutput(
  text: string,
  fileStem: string,
  refineHint: string,
  options?: { maxLines?: number; maxBytes?: number },
): Promise<TruncatedToolOutput> {
  const truncation = truncateHead(text, {
    maxLines: options?.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: options?.maxBytes ?? DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return { text: truncation.content, truncation };
  }

  const tempDir = await mkdtemp(join(tmpdir(), TEMP_FILE_PREFIX));
  const fullOutputPath = join(tempDir, `${fileStem}.txt`);
  await writeFile(fullOutputPath, text, 'utf8');

  const truncatedLines = truncation.totalLines - truncation.outputLines;
  const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
  const notice =
    `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted. ` +
    `${refineHint}Full output saved to: ${fullOutputPath}]`;

  return {
    text: truncation.content + notice,
    truncation,
    fullOutputPath,
  };
}
