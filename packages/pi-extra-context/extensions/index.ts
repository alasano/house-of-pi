import { existsSync } from 'node:fs';
import { glob, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from '@mariozechner/pi-coding-agent';

const DEFAULT_MAX_BYTES_PER_FILE = 50_000;
const DEFAULT_MAX_TOTAL_BYTES = 200_000;
const CONFIG_FILENAME = 'pi-extra-context.json';
const SECTION_TITLE = 'Extra Context';

type Mode = 'project' | 'ancestor' | 'global' | 'absolute';
type ConfigScope = 'global' | 'project';

interface FileEntry {
  path: string;
  mode: Mode;
  optional: boolean;
}

interface RawConfig {
  files: FileEntry[];
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

interface ResolvedConfig {
  files: FileEntry[];
  maxBytesPerFile: number;
  maxTotalBytes: number;
  configPaths: string[];
  diagnostics: string[];
}

interface LoadedFile {
  path: string;
  displayPath: string;
  bytes: number;
  content: string;
}

interface LoadState {
  config: ResolvedConfig;
  files: LoadedFile[];
  diagnostics: string[];
  skipped: string[];
  totalBytes: number;
  loadedAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMode(value: unknown): value is Mode {
  return value === 'project' || value === 'ancestor' || value === 'global' || value === 'absolute';
}

function expandHome(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return join(homedir(), input.slice(2));
  return input;
}

function formatPath(cwd: string, filePath: string): string {
  const rel = relative(cwd, filePath);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;

  const home = homedir();
  if (filePath === home) return '~';
  if (filePath.startsWith(`${home}/`)) return `~/${filePath.slice(home.length + 1)}`;

  return filePath;
}

function ancestorsFromRoot(cwd: string): string[] {
  const dirs: string[] = [];
  let current = resolve(cwd);

  while (true) {
    dirs.unshift(current);

    const parent = dirname(current);
    if (parent === current) break;

    current = parent;
  }

  return dirs;
}

function configPath(scope: ConfigScope, cwd: string): string {
  if (scope === 'global') return join(getAgentDir(), 'extensions', CONFIG_FILENAME);
  return join(cwd, '.pi', CONFIG_FILENAME);
}

function parsePositiveInteger(
  value: unknown,
  name: string,
  diagnostics: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;

  diagnostics.push(`${name} must be a positive integer; ignoring configured value`);
  return undefined;
}

function parseFileEntry(
  value: unknown,
  sourcePath: string,
  index: number,
  diagnostics: string[],
): FileEntry | undefined {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      diagnostics.push(`${sourcePath}: files[${index}] is empty; skipping`);
      return undefined;
    }

    return { path: value, mode: 'project', optional: true };
  }

  if (!isRecord(value)) {
    diagnostics.push(`${sourcePath}: files[${index}] must be a string or object; skipping`);
    return undefined;
  }

  const pathValue = value.path;
  if (typeof pathValue !== 'string' || pathValue.trim().length === 0) {
    diagnostics.push(`${sourcePath}: files[${index}].path must be a non-empty string; skipping`);
    return undefined;
  }

  const mode = value.mode === undefined ? 'project' : value.mode;
  if (!isMode(mode)) {
    diagnostics.push(
      `${sourcePath}: files[${index}].mode must be project, ancestor, global, or absolute; skipping`,
    );
    return undefined;
  }

  const optional = value.optional === undefined ? true : value.optional;
  if (typeof optional !== 'boolean') {
    diagnostics.push(`${sourcePath}: files[${index}].optional must be a boolean; skipping`);
    return undefined;
  }

  return { path: pathValue, mode, optional };
}

async function readConfig(
  scope: ConfigScope,
  cwd: string,
): Promise<RawConfig & { path: string; exists: boolean; diagnostics: string[] }> {
  const path = configPath(scope, cwd);
  const diagnostics: string[] = [];

  if (!existsSync(path)) {
    return { path, exists: false, files: [], diagnostics };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    diagnostics.push(`${path}: failed to parse JSON: ${String(error)}`);
    return { path, exists: true, files: [], diagnostics };
  }

  if (!isRecord(parsed)) {
    diagnostics.push(`${path}: config must be a JSON object`);
    return { path, exists: true, files: [], diagnostics };
  }

  const rawFiles = parsed.files;
  const files: FileEntry[] = [];

  if (rawFiles !== undefined) {
    if (!Array.isArray(rawFiles)) {
      diagnostics.push(`${path}: files must be an array; ignoring configured files`);
    } else {
      for (const [index, entry] of rawFiles.entries()) {
        const parsedEntry = parseFileEntry(entry, path, index, diagnostics);
        if (parsedEntry) files.push(parsedEntry);
      }
    }
  }

  return {
    path,
    exists: true,
    files,
    maxBytesPerFile: parsePositiveInteger(
      parsed.maxBytesPerFile,
      `${path}: maxBytesPerFile`,
      diagnostics,
    ),
    maxTotalBytes: parsePositiveInteger(
      parsed.maxTotalBytes,
      `${path}: maxTotalBytes`,
      diagnostics,
    ),
    diagnostics,
  };
}

async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const globalConfig = await readConfig('global', cwd);
  const projectConfig = await readConfig('project', cwd);
  const diagnostics = [...globalConfig.diagnostics, ...projectConfig.diagnostics];
  const configPaths = [globalConfig, projectConfig]
    .filter((config) => config.exists)
    .map((config) => config.path);

  return {
    files: [...globalConfig.files, ...projectConfig.files],
    maxBytesPerFile:
      projectConfig.maxBytesPerFile ?? globalConfig.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE,
    maxTotalBytes:
      projectConfig.maxTotalBytes ?? globalConfig.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    configPaths,
    diagnostics,
  };
}

async function collectGlobMatches(pattern: string, cwd?: string): Promise<string[]> {
  const matches: string[] = [];
  const iterator = cwd ? glob(pattern, { cwd }) : glob(pattern);

  for await (const match of iterator) {
    const path = cwd ? resolve(cwd, match) : resolve(match);
    matches.push(path);
  }

  return matches.sort((a, b) => a.localeCompare(b));
}

async function resolveEntry(
  entry: FileEntry,
  cwd: string,
  diagnostics: string[],
): Promise<string[]> {
  switch (entry.mode) {
    case 'project':
      return collectGlobMatches(entry.path, cwd);

    case 'global':
      return collectGlobMatches(entry.path, getAgentDir());

    case 'absolute': {
      const expanded = expandHome(entry.path);
      if (!isAbsolute(expanded)) {
        diagnostics.push(`absolute entry "${entry.path}" must be absolute or ~-prefixed; skipping`);
        return [];
      }

      return collectGlobMatches(expanded);
    }

    case 'ancestor': {
      const matches: string[] = [];
      for (const dir of ancestorsFromRoot(cwd)) {
        matches.push(...(await collectGlobMatches(entry.path, dir)));
      }
      return matches;
    }
  }
}

async function loadExtraContext(ctx: ExtensionContext): Promise<LoadState> {
  const config = await loadConfig(ctx.cwd);
  const diagnostics = [...config.diagnostics];
  const skipped: string[] = [];
  const files: LoadedFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const entry of config.files) {
    let matches: string[];
    try {
      matches = await resolveEntry(entry, ctx.cwd, diagnostics);
    } catch (error) {
      diagnostics.push(`${entry.path}: failed to resolve: ${String(error)}`);
      continue;
    }

    if (matches.length === 0 && !entry.optional) {
      diagnostics.push(`${entry.path}: no files matched`);
    }

    for (const match of matches) {
      let canonicalPath: string;
      try {
        canonicalPath = await realpath(match);
      } catch (error) {
        skipped.push(`${formatPath(ctx.cwd, match)} (not readable: ${String(error)})`);
        continue;
      }

      if (seen.has(canonicalPath)) continue;
      seen.add(canonicalPath);

      let fileStat;
      try {
        fileStat = await stat(canonicalPath);
      } catch (error) {
        skipped.push(`${formatPath(ctx.cwd, canonicalPath)} (stat failed: ${String(error)})`);
        continue;
      }

      if (!fileStat.isFile()) {
        skipped.push(`${formatPath(ctx.cwd, canonicalPath)} (not a file)`);
        continue;
      }

      if (fileStat.size > config.maxBytesPerFile) {
        skipped.push(
          `${formatPath(ctx.cwd, canonicalPath)} (${fileStat.size} bytes exceeds maxBytesPerFile ${config.maxBytesPerFile})`,
        );
        continue;
      }

      if (totalBytes + fileStat.size > config.maxTotalBytes) {
        skipped.push(
          `${formatPath(ctx.cwd, canonicalPath)} (would exceed maxTotalBytes ${config.maxTotalBytes})`,
        );
        continue;
      }

      let content: string;
      try {
        content = await readFile(canonicalPath, 'utf8');
      } catch (error) {
        skipped.push(`${formatPath(ctx.cwd, canonicalPath)} (read failed: ${String(error)})`);
        continue;
      }

      const bytes = Buffer.byteLength(content, 'utf8');
      totalBytes += bytes;
      files.push({
        path: canonicalPath,
        displayPath: formatPath(ctx.cwd, canonicalPath),
        bytes,
        content,
      });
    }
  }

  return { config, files, diagnostics, skipped, totalBytes, loadedAt: new Date() };
}

function buildPromptSection(state: LoadState): string {
  const sections = state.files.map(
    (file) => `## ${file.displayPath}\n\n${file.content.trimEnd()}\n`,
  );

  return `# ${SECTION_TITLE}\n\nThe following files were loaded by pi-extra-context.\n\n${sections.join('\n')}`;
}

function statusLines(state: LoadState | undefined, cwd: string): string[] {
  if (!state) return ['pi-extra-context has not loaded yet'];

  const lines = [
    `Loaded files: ${state.files.length}`,
    `Total bytes: ${state.totalBytes} / ${state.config.maxTotalBytes}`,
    `Max bytes per file: ${state.config.maxBytesPerFile}`,
    `Loaded at: ${state.loadedAt.toLocaleString()}`,
  ];

  if (state.config.configPaths.length > 0) {
    lines.push(`Config: ${state.config.configPaths.join(', ')}`);
  } else {
    lines.push(`Config: none (${configPath('global', cwd)}, ${configPath('project', cwd)})`);
  }

  if (state.files.length > 0) {
    lines.push('Files:');
    for (const file of state.files) {
      lines.push(`- ${file.displayPath} (${file.bytes} bytes)`);
    }
  }

  if (state.skipped.length > 0) {
    lines.push('Skipped:');
    for (const skipped of state.skipped) lines.push(`- ${skipped}`);
  }

  if (state.diagnostics.length > 0) {
    lines.push('Diagnostics:');
    for (const diagnostic of state.diagnostics) lines.push(`- ${diagnostic}`);
  }

  return lines;
}

export default function piExtraContext(pi: ExtensionAPI) {
  let state: LoadState | undefined;

  async function reload(ctx: ExtensionContext, notify: boolean): Promise<void> {
    state = await loadExtraContext(ctx);

    if (!notify || !ctx.hasUI) return;

    if (state.files.length > 0) {
      ctx.ui.notify(
        `pi-extra-context loaded ${state.files.length} file(s), ${state.totalBytes} bytes`,
        'info',
      );
    } else if (state.config.configPaths.length > 0 || state.diagnostics.length > 0) {
      ctx.ui.notify(
        'pi-extra-context loaded no files',
        state.diagnostics.length > 0 ? 'warning' : 'info',
      );
    }
  }

  pi.registerCommand('pi-extra-context', {
    description:
      'Show or reload pi-extra-context status (usage: /pi-extra-context [status|reload])',
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();

      if (command === '' || command === 'status') {
        ctx.ui.notify(
          statusLines(state, ctx.cwd).join('\n'),
          state?.diagnostics.length ? 'warning' : 'info',
        );
        return;
      }

      if (command === 'reload') {
        await reload(ctx, false);
        ctx.ui.notify(
          statusLines(state, ctx.cwd).join('\n'),
          state?.diagnostics.length ? 'warning' : 'info',
        );
        return;
      }

      ctx.ui.notify('Usage: /pi-extra-context [status|reload]', 'warning');
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    await reload(ctx, true);
  });

  pi.on('before_agent_start', async (event) => {
    if (!state || state.files.length === 0) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildPromptSection(state)}`,
    };
  });
}
