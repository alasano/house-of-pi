import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { AutocompleteItem } from '@earendil-works/pi-tui';
import { Text } from '@earendil-works/pi-tui';

const CUSTOM_TYPE = 'pi-forcefeed';
const MAX_COMPLETIONS = 50;

type ForcefeedFileDetails = {
  path: string;
  absolutePath: string;
  bytes: number;
  lines: number;
};

type ForcefeedBatchDetails = {
  files: ForcefeedFileDetails[];
};

type ForcefedFile = {
  details: ForcefeedFileDetails;
  content: string;
};

function stripOptionalAt(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1).trimStart() : trimmed;
}

function stripMatchingQuotes(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length < 2) return trimmed;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizePathArg(args: string): string {
  return stripMatchingQuotes(stripOptionalAt(args));
}

function parsePathArgs(args: string): string[] {
  const paths: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of args) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      const normalized = normalizePathArg(current);
      if (normalized) paths.push(normalized);
      current = '';
      continue;
    }

    current += char;
  }

  if (escaping) current += '\\';

  const normalized = normalizePathArg(current);
  if (normalized) paths.push(normalized);

  return paths;
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function resolveInputPath(inputPath: string, cwd: string): string {
  const expanded = expandHomePath(inputPath);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

function toDisplayPath(path: string): string {
  return path.split(sep).join('/');
}

function displayPath(absolutePath: string, cwd: string): string {
  const rel = relative(cwd, absolutePath);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    return toDisplayPath(rel);
  }
  return toDisplayPath(absolutePath);
}

function completionDisplayPath(absolutePath: string, cwd: string, rawPrefix: string): string {
  const home = homedir();

  if (rawPrefix.startsWith('/')) {
    return toDisplayPath(absolutePath);
  }

  if (rawPrefix.startsWith('~')) {
    const relHome = relative(home, absolutePath);
    if (!relHome.startsWith('..') && !isAbsolute(relHome)) {
      return relHome ? `~/${toDisplayPath(relHome)}` : '~';
    }
    return toDisplayPath(absolutePath);
  }

  return displayPath(absolutePath, cwd);
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\r\n|\r|\n/).length;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes.toLocaleString()} ${bytes === 1 ? 'byte' : 'bytes'}`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const displayValue = (value >= 100 ? value.toFixed(0) : value.toFixed(1)).replace(/\.0$/, '');
  return `${displayValue} ${units[unitIndex]}`;
}

function formatLineCount(lines: number): string {
  return `${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}`;
}

function formatFileStats(details: Pick<ForcefeedFileDetails, 'bytes' | 'lines'>): string {
  return `${formatByteSize(details.bytes)}, ${formatLineCount(details.lines)}`;
}

function quoteCompletionValue(value: string): string {
  if (!/[\s"']/.test(value)) return value;
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function parseCompletionPrefix(argumentPrefix: string): string {
  return stripOptionalAt(argumentPrefix.trimStart()).replace(/^['"]/, '');
}

function splitCompletionArgument(argumentPrefix: string): {
  leading: string;
  token: string;
} {
  let quote: '"' | "'" | undefined;
  let escaping = false;
  let tokenStart = 0;

  for (let i = 0; i < argumentPrefix.length; i += 1) {
    const char = argumentPrefix[i];
    if (char === undefined) continue;

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      tokenStart = i + 1;
    }
  }

  return {
    leading: argumentPrefix.slice(0, tokenStart),
    token: argumentPrefix.slice(tokenStart),
  };
}

async function getPathCompletions(
  argumentPrefix: string,
  cwd: string,
): Promise<AutocompleteItem[] | null> {
  const { leading, token } = splitCompletionArgument(argumentPrefix);
  const rawPrefix = parseCompletionPrefix(token);
  const expandedPrefix = expandHomePath(rawPrefix);

  const searchDir =
    rawPrefix.endsWith('/') || rawPrefix === '' ? expandedPrefix : dirname(expandedPrefix);
  const searchName = rawPrefix.endsWith('/') ? '' : basename(expandedPrefix);
  const absoluteSearchDir = isAbsolute(searchDir) ? searchDir : resolve(cwd, searchDir || '.');

  let entries;
  try {
    entries = await readdir(absoluteSearchDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const items: AutocompleteItem[] = [];
  const lowerSearchName = searchName.toLowerCase();

  for (const entry of entries) {
    if (!entry.name.toLowerCase().startsWith(lowerSearchName)) continue;

    const absoluteEntryPath = join(absoluteSearchDir, entry.name);
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = (await stat(absoluteEntryPath)).isDirectory();
      } catch {
        isDirectory = false;
      }
    }

    const completionPath =
      completionDisplayPath(absoluteEntryPath, cwd, rawPrefix) + (isDirectory ? '/' : '');
    items.push({
      value: leading + quoteCompletionValue(completionPath),
      label: `${entry.name}${isDirectory ? '/' : ''}`,
      description: completionPath,
    });
  }

  items.sort((a, b) => {
    const aDir = a.label.endsWith('/');
    const bDir = b.label.endsWith('/');
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    return a.label.localeCompare(b.label);
  });

  return items.slice(0, MAX_COMPLETIONS);
}

function buildForcefeedContent(files: ForcefedFile[]): string {
  const header =
    files.length === 1
      ? '[pi-forcefeed] The user force-fed this complete file into context.'
      : `[pi-forcefeed] The user force-fed these ${files.length} complete files into context.`;

  return [
    header,
    'Treat the text below as the exact full file contents for any subsequent task.',
    ...files.flatMap((file, index) => [
      '',
      `File ${index + 1} of ${files.length}`,
      `Path: ${file.details.path}`,
      `Absolute path: ${file.details.absolutePath}`,
      `Size: ${formatFileStats(file.details)}`,
      '',
      `<<<PI_FORCEFEED_FILE_CONTENT_START ${file.details.path}>>>`,
      file.content,
      `<<<PI_FORCEFEED_FILE_CONTENT_END ${file.details.path}>>>`,
    ]),
  ].join('\n');
}

function getRenderedFiles(details: unknown): ForcefeedFileDetails[] {
  if (!details || typeof details !== 'object') return [];

  const maybeBatch = details as Partial<ForcefeedBatchDetails>;
  if (Array.isArray(maybeBatch.files)) return maybeBatch.files;

  const maybeFile = details as Partial<ForcefeedFileDetails>;
  if (
    typeof maybeFile.path === 'string' &&
    typeof maybeFile.absolutePath === 'string' &&
    typeof maybeFile.bytes === 'number' &&
    typeof maybeFile.lines === 'number'
  ) {
    return [maybeFile as ForcefeedFileDetails];
  }

  return [];
}

export default function forcefeed(pi: ExtensionAPI) {
  let currentCwd = process.cwd();

  pi.on('session_start', (_event, ctx) => {
    currentCwd = ctx.cwd;
  });

  pi.registerMessageRenderer(CUSTOM_TYPE, (message, _options, theme) => {
    const files = getRenderedFiles(message.details);
    const content =
      files
        .map((details) => {
          const size = formatFileStats(details);
          return `${theme.fg('customMessageLabel', theme.bold('[forcefeed] '))}${theme.fg(
            'customMessageText',
            details.path,
          )} ${theme.fg('dim', `(${size}; full content injected into context)`)}`;
        })
        .join('\n') ||
      `${theme.fg('customMessageLabel', theme.bold('[forcefeed] '))}${theme.fg(
        'customMessageText',
        'unknown file',
      )} ${theme.fg('dim', '(unknown size; full content injected into context)')}`;

    return new Text(content, 0, 0);
  });

  pi.registerCommand('forcefeed', {
    description:
      'Inject one or more complete files into conversation context without read-tool truncation',
    getArgumentCompletions: (argumentPrefix) => getPathCompletions(argumentPrefix, currentCwd),
    handler: async (args, ctx) => {
      const inputPaths = parsePathArgs(args);
      if (inputPaths.length === 0) {
        ctx.ui.notify(
          'Usage: /forcefeed <path> [more paths...] or /forcefeed @<path> @<other-path>',
          'warning',
        );
        return;
      }

      const failures: string[] = [];
      const files: ForcefedFile[] = [];

      for (const inputPath of inputPaths) {
        const absolutePath = resolveInputPath(inputPath, ctx.cwd);
        let buffer: Buffer;
        try {
          buffer = await readFile(absolutePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${inputPath}: ${message}`);
          continue;
        }

        const content = buffer.toString('utf8');
        const details: ForcefeedFileDetails = {
          path: displayPath(absolutePath, ctx.cwd),
          absolutePath: toDisplayPath(absolutePath),
          bytes: buffer.byteLength,
          lines: countLines(content),
        };

        files.push({ details, content });
      }

      if (files.length > 0) {
        pi.sendMessage(
          {
            customType: CUSTOM_TYPE,
            content: buildForcefeedContent(files),
            display: true,
            details: { files: files.map((file) => file.details) },
          },
          { deliverAs: 'steer' },
        );
      }

      if (failures.length > 0) {
        ctx.ui.notify(
          `forcefeed failed for ${failures.length} file(s):\n${failures.join('\n')}`,
          'error',
        );
      }
    },
  });
}
