import {
  keyHint,
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@mariozechner/pi-coding-agent';
import { Text, truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';
import {
  getDefaultJsonView,
  registerLinearResultRenderer,
  type LinearToolRenderContext,
} from './state';

export type { LinearToolRenderContext } from './state';

export type ToolArgs = Record<string, unknown>;
export type CellStyle = (text: string) => string;

export type TableColumn<T> = {
  id: string;
  label: string;
  width: number;
  value: (item: T) => string;
  style?: (theme: Theme, value: string, item: T) => CellStyle;
};

export type PrimaryTableColumn<T> = {
  label: string;
  minWidth?: number;
  value: (item: T) => string;
  style?: (theme: Theme, value: string, item: T) => CellStyle;
};

export type ResponsiveTableOptions<T> = {
  columns: TableColumn<T>[];
  primary: PrimaryTableColumn<T>;
  dropOrder?: string[];
  fallback: (item: T, theme: Theme, width: number) => string;
  minWidth?: number;
};

export type ToolCallField = [key: string, label: string];

const TABLE_SEPARATOR = '  ';
const DEFAULT_TABLE_MIN_WIDTH = 28;
const DEFAULT_PRIMARY_MIN_WIDTH = 24;
const FALLBACK_PRIMARY_MIN_WIDTH = 10;
const TOOL_ARG_STRING_LIMIT = 48;

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function cleanOneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function truncateLine(value: string, width: number): string {
  return truncateToWidth(value, width);
}

export function textContent(result: AgentToolResult<any>): string {
  const textBlock = result.content.find((block) => block.type === 'text');
  if (textBlock?.type === 'text' && textBlock.text) return textBlock.text;
  return JSON.stringify(result.details ?? null, null, 2);
}

export function expandedJson(result: AgentToolResult<any>, theme: Theme): Text {
  const text = `\n${theme.fg('muted', 'Full JSON response')}\n${textContent(result)}\n\n${keyHint(
    'app.tools.expand',
    'show summary',
  )}`;
  return new Text(text, 0, 0);
}

export function shouldShowJson(
  options: ToolRenderResultOptions,
  context?: LinearToolRenderContext,
): boolean {
  registerLinearResultRenderer(context);
  return options.expanded !== getDefaultJsonView();
}

export function jsonHint(): string {
  return `(${keyHint('app.tools.expand', 'show full JSON')})`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function truncatePlainToWidth(value: string, width: number, ellipsis = '...'): string {
  if (width <= 0) return '';
  if (visibleWidth(value) <= width) return value;

  const ellipsisWidth = visibleWidth(ellipsis);
  if (ellipsisWidth >= width) return ellipsis.slice(0, width);

  const targetWidth = width - ellipsisWidth;
  let output = '';
  let outputWidth = 0;

  for (const character of Array.from(value)) {
    const characterWidth = visibleWidth(character);
    if (outputWidth + characterWidth > targetWidth) break;
    output += character;
    outputWidth += characterWidth;
  }

  return `${output.trimEnd()}${ellipsis}`;
}

export function formatCell(rawValue: string, width: number, style: CellStyle): string {
  const cleanValue = cleanOneLine(rawValue || '—');
  const truncated = truncatePlainToWidth(cleanValue, width);
  const padding = ' '.repeat(Math.max(0, width - visibleWidth(truncated)));
  return `${style(truncated)}${padding}`;
}

export function accentStyle(theme: Theme): CellStyle {
  return (text) => theme.fg('accent', text);
}

export function dimStyle(theme: Theme): CellStyle {
  return (text) => theme.fg('dim', text);
}

export function mutedStyle(theme: Theme): CellStyle {
  return (text) => theme.fg('muted', text);
}

export function toolOutputStyle(theme: Theme): CellStyle {
  return (text) => theme.fg('toolOutput', text);
}

function fitTableLayout<T>(
  width: number,
  columns: TableColumn<T>[],
  primaryMinWidth: number,
  dropOrder?: string[],
  minWidth = DEFAULT_TABLE_MIN_WIDTH,
): { columns: TableColumn<T>[]; primaryWidth: number } | undefined {
  if (width < minWidth) return undefined;

  const idsToDrop = dropOrder ?? columns.map((column) => column.id).reverse();
  let visibleColumns = [...columns];

  const primaryWidthFor = (candidateColumns: TableColumn<T>[]) => {
    const separatorWidth = TABLE_SEPARATOR.length * candidateColumns.length;
    const fixedWidth = candidateColumns.reduce((sum, column) => sum + column.width, 0);
    return width - fixedWidth - separatorWidth;
  };

  let primaryWidth = primaryWidthFor(visibleColumns);
  for (const columnToDrop of idsToDrop) {
    if (primaryWidth >= primaryMinWidth) break;
    visibleColumns = visibleColumns.filter((column) => column.id !== columnToDrop);
    primaryWidth = primaryWidthFor(visibleColumns);
  }

  if (primaryWidth < FALLBACK_PRIMARY_MIN_WIDTH) return undefined;
  return { columns: visibleColumns, primaryWidth };
}

function tableLine(cells: string[], width: number): string {
  return truncateToWidth(cells.join(TABLE_SEPARATOR), width);
}

export function renderResponsiveTable<T>(
  items: T[],
  theme: Theme,
  width: number,
  options: ResponsiveTableOptions<T>,
): string[] {
  const layout = fitTableLayout(
    width,
    options.columns,
    options.primary.minWidth ?? DEFAULT_PRIMARY_MIN_WIDTH,
    options.dropOrder,
    options.minWidth,
  );

  if (!layout) {
    return items.map((item) => options.fallback(item, theme, width));
  }

  const headerCells = [
    ...layout.columns.map((column) =>
      formatCell(column.label, column.width, (text) => theme.fg('dim', text)),
    ),
    formatCell(options.primary.label, layout.primaryWidth, (text) => theme.fg('dim', text)),
  ];

  const lines = [tableLine(headerCells, width)];
  for (const item of items) {
    const cells = [
      ...layout.columns.map((column) => {
        const value = column.value(item);
        const style = column.style?.(theme, value, item) ?? mutedStyle(theme);
        return formatCell(value, column.width, style);
      }),
      (() => {
        const value = options.primary.value(item);
        const style = options.primary.style?.(theme, value, item) ?? toolOutputStyle(theme);
        return formatCell(value, layout.primaryWidth, style);
      })(),
    ];
    lines.push(tableLine(cells, width));
  }

  return lines;
}

export class LinearListResultComponent<T> {
  constructor(
    private readonly items: T[],
    private readonly theme: Theme,
    private readonly options: {
      noun: string;
      pluralNoun?: string;
      emptyLabel: string;
      previewLimit?: number;
      renderItems: (items: T[], theme: Theme, width: number) => string[];
    },
  ) {}

  render(width: number): string[] {
    const lines: string[] = [''];

    if (this.items.length === 0) {
      lines.push(this.theme.fg('dim', this.options.emptyLabel));
      lines.push('');
      lines.push(jsonHint());
      return lines.map((line) => truncateToWidth(line, width));
    }

    const previewLimit = this.options.previewLimit ?? 20;
    const shown = this.items.slice(0, previewLimit);
    lines.push(
      this.theme.fg(
        'success',
        `✓ ${plural(this.items.length, this.options.noun, this.options.pluralNoun)} returned`,
      ),
    );
    lines.push('');
    lines.push(...this.options.renderItems(shown, this.theme, width));

    if (shown.length < this.items.length) {
      lines.push(
        this.theme.fg(
          'dim',
          `… ${plural(this.items.length - shown.length, `more ${this.options.noun}`)}`,
        ),
      );
    }

    lines.push('');
    lines.push(jsonHint());

    return lines.map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {}
}

export function formatToolArgValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.includes(' ')
      ? `"${truncate(trimmed, TOOL_ARG_STRING_LIMIT)}"`
      : truncate(trimmed, TOOL_ARG_STRING_LIMIT);
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : undefined;
  if (Array.isArray(value)) return value.length ? `[${value.length}]` : undefined;
  if (value && typeof value === 'object') return '{…}';
  return undefined;
}

export function renderLinearToolCall(
  toolName: string,
  args: ToolArgs | undefined,
  theme: Theme,
  fields: ToolCallField[],
): Text {
  let text = theme.fg('toolTitle', theme.bold(toolName));
  const parts = fields
    .map(([key, label]) => {
      const value = formatToolArgValue(args?.[key]);
      return value ? `${label}=${value}` : undefined;
    })
    .filter((part): part is string => !!part);

  if (parts.length) {
    text += ` ${theme.fg('dim', parts.join('  '))}`;
  }

  return new Text(text, 0, 0);
}
