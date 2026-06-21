import { positiveInteger } from './ranges';

export type ToolContentBlock = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
};

export type ReadResultLike = {
  content?: ToolContentBlock[];
  details?: unknown;
};

export function getReadStartLine(args: unknown): number {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 1;
  return positiveInteger((args as { offset?: unknown }).offset) ?? 1;
}

export function isImageReadResult(result: ReadResultLike): boolean {
  return result.content?.some((block) => block.type === 'image') === true;
}

function findTextContent(content: ToolContentBlock[] | undefined): string | undefined {
  if (!content) return undefined;

  const textBlock = content.find(
    (block) => block.type === 'text' && typeof block.text === 'string',
  );
  return textBlock?.text;
}

function extractLineCountFromText(text: string): number {
  const showingMatch = text.match(
    /\[Showing lines (\d+)-(\d+) of \d+(?: \([^)]+\))?\. Use offset=\d+ to continue\.\]\s*$/,
  );
  if (showingMatch) {
    const start = Number.parseInt(showingMatch[1] ?? '', 10);
    const end = Number.parseInt(showingMatch[2] ?? '', 10);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      return end - start + 1;
    }
  }

  const textWithoutNotice = text
    .replace(
      /\n\n\[Showing lines \d+-\d+ of \d+(?: \([^)]+\))?\. Use offset=\d+ to continue\.\]\s*$/,
      '',
    )
    .replace(/\n\n\[\d+ more lines in file\. Use offset=\d+ to continue\.\]\s*$/, '');

  if (!textWithoutNotice) return 0;
  return textWithoutNotice.split('\n').length;
}

export function extractReadLineCount(result: ReadResultLike): number | undefined {
  if (result.details && typeof result.details === 'object' && !Array.isArray(result.details)) {
    const truncation = (result.details as { truncation?: { outputLines?: unknown } }).truncation;
    if (truncation && typeof truncation.outputLines === 'number') {
      return truncation.outputLines;
    }
  }

  const text = findTextContent(result.content);
  if (typeof text !== 'string') return undefined;

  return extractLineCountFromText(text);
}
