import * as nodePath from 'node:path';

type ThemeColorKey = 'accent' | 'dim' | 'muted' | 'success' | 'syntaxString' | 'text' | 'warning';

export type ThemeLike = {
  fg: (color: ThemeColorKey, text: string) => string;
};

const DIR_GRADIENT_HEX = [
  '#7f849c',
  '#878ca2',
  '#8f93a8',
  '#979baf',
  '#9fa3b5',
  '#a7aabb',
  '#afb2c1',
  '#b7bac7',
  '#bfc2ce',
  '#c7c9d4',
  '#cfd1da',
  '#d7d9e0',
  '#dfe0e6',
] as const;

const FILE_COLOR = 'syntaxString';
const rgbCache = new Map<string, { r: number; g: number; b: number }>();

function isWithinDirectory(absolutePath: string, cwd: string): boolean {
  const relativePath = nodePath.relative(cwd, absolutePath);
  return (
    relativePath === '' || (!relativePath.startsWith('..') && !nodePath.isAbsolute(relativePath))
  );
}

export function toDisplaySeparators(path: string): string {
  return path.replaceAll('\\', '/');
}

export function normalizeDisplayPath(inputPath: unknown, cwd: string = process.cwd()): string {
  if (typeof inputPath !== 'string') return '(unknown path)';

  const trimmed = inputPath.trim();
  const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (!stripped) return '(unknown path)';

  const absolutePath = nodePath.isAbsolute(stripped)
    ? nodePath.normalize(stripped)
    : nodePath.resolve(cwd, stripped);

  if (isWithinDirectory(absolutePath, cwd)) {
    const relativePath = nodePath.relative(cwd, absolutePath);
    return toDisplaySeparators(relativePath || '.');
  }

  return toDisplaySeparators(absolutePath);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | undefined {
  const cached = rgbCache.get(hex);
  if (cached) return cached;

  const cleaned = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return undefined;

  const rgb = {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };

  rgbCache.set(hex, rgb);
  return rgb;
}

function fgHex(hex: string, text: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return text;
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[39m`;
}

function getDirColorHex(depth: number, totalDirs: number): string {
  if (totalDirs <= 1) return DIR_GRADIENT_HEX[0];

  const t = depth / Math.max(1, totalDirs - 1);
  const index = Math.round(t * (DIR_GRADIENT_HEX.length - 1));
  return (
    DIR_GRADIENT_HEX[Math.min(DIR_GRADIENT_HEX.length - 1, Math.max(0, index))] ??
    DIR_GRADIENT_HEX[0]
  );
}

export function stylePath(path: string, theme: ThemeLike): string {
  const normalizedPath = toDisplaySeparators(path);
  const hasLeadingSlash = normalizedPath.startsWith('/');
  const segments = normalizedPath.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return theme.fg(FILE_COLOR, normalizedPath || path);
  }

  if (segments.length === 1 && !hasLeadingSlash) {
    return theme.fg(FILE_COLOR, segments[0] ?? normalizedPath);
  }

  const directoryCount = Math.max(0, segments.length - 1);
  let styled = '';

  if (hasLeadingSlash) {
    styled += fgHex(getDirColorHex(0, Math.max(1, directoryCount)), '/');
  }

  for (let index = 0; index < directoryCount; index += 1) {
    const segment = segments[index];
    if (segment) {
      styled += fgHex(getDirColorHex(index, directoryCount), `${segment}/`);
    }
  }

  styled += theme.fg(FILE_COLOR, segments[segments.length - 1] ?? normalizedPath);
  return styled;
}
