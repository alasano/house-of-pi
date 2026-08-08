import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import {
  accentStyle,
  asString,
  cleanOneLine,
  detailLine,
  dimStyle,
  expandedJson,
  jsonHint,
  shouldShowJson,
  LinearListResultComponent,
  mutedStyle,
  renderLinearToolCall,
  renderResponsiveTable,
  textContent,
  toolOutputStyle,
  truncate,
  truncateLine,
  type LinearToolRenderContext,
  type TableColumn,
  type ToolArgs,
} from './common';

type CycleTeam = {
  id?: string | null;
  key?: string | null;
  name?: string | null;
};

type CycleLike = {
  id?: string | null;
  name?: string | null;
  number?: number | null;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  completedAt?: string | null;
  archivedAt?: string | null;
  autoArchivedAt?: string | null;
  isActive?: boolean | null;
  isFuture?: boolean | null;
  isPast?: boolean | null;
  isNext?: boolean | null;
  isPrevious?: boolean | null;
  progress?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  team?: CycleTeam | null;
};

type CycleResultDetails = {
  cycles?: CycleLike[];
  cycle?: CycleLike;
  success?: boolean;
};

const CYCLE_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 50;
const DESCRIPTION_LIMIT = 100;

function cycleDetails(result: AgentToolResult<any>): CycleResultDetails {
  return (result.details ?? {}) as CycleResultDetails;
}

function cycleName(cycle: CycleLike): string {
  return truncate(
    cleanOneLine(asString(cycle.name) ?? `Cycle #${cycle.number ?? '?'}`),
    NAME_LIMIT,
  );
}

function teamText(cycle: CycleLike): string | undefined {
  return asString(cycle.team?.key) ?? asString(cycle.team?.name) ?? asString(cycle.team?.id);
}

function dateText(value: string | null | undefined): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  return raw.slice(0, 10);
}

function statusText(cycle: CycleLike): string {
  const lifecycle = cycle.completedAt
    ? 'completed'
    : cycle.isActive === true
      ? 'active'
      : cycle.isFuture === true
        ? 'upcoming'
        : cycle.isPast === true
          ? 'past'
          : 'unknown';
  const position = cycle.isNext === true ? 'next' : cycle.isPrevious === true ? 'previous' : null;

  return [lifecycle, position].filter(Boolean).join(' · ');
}

function progressText(cycle: CycleLike): string | undefined {
  if (typeof cycle.progress !== 'number' || !Number.isFinite(cycle.progress)) return undefined;
  return `${Math.round(cycle.progress * 100)}%`;
}

function archivedText(cycle: CycleLike): string | undefined {
  const autoArchivedAt = dateText(cycle.autoArchivedAt);
  const archivedAt = dateText(cycle.archivedAt) ?? autoArchivedAt;
  if (!archivedAt) return undefined;
  return autoArchivedAt ? `${archivedAt} (auto)` : archivedAt;
}

function archivedMetadata(cycle: CycleLike): string | undefined {
  const archived = archivedText(cycle);
  return archived ? `archived ${archived}` : undefined;
}

function rangeText(cycle: CycleLike): string {
  return [dateText(cycle.startsAt), dateText(cycle.endsAt)].filter(Boolean).join(' → ') || '—';
}

function statusStyle(theme: Theme, value: string): (text: string) => string {
  if (value.startsWith('completed')) return (text) => theme.fg('success', text);
  if (value.startsWith('active')) return (text) => theme.fg('warning', text);
  if (value.startsWith('upcoming')) return (text) => theme.fg('accent', text);
  return mutedStyle(theme);
}

function descriptionSnippet(cycle: CycleLike): string | undefined {
  const description = asString(cycle.description);
  if (!description) return undefined;
  return truncate(cleanOneLine(description), DESCRIPTION_LIMIT);
}

function formatCycleListLine(cycle: CycleLike, theme: Theme, width: number): string {
  const range = [dateText(cycle.startsAt), dateText(cycle.endsAt)].filter(Boolean).join(' → ');
  const status = statusText(cycle);
  const progress = progressText(cycle);
  const parts = [
    range || undefined,
    status,
    progress ? `progress ${progress}` : undefined,
    teamText(cycle),
    archivedMetadata(cycle),
    descriptionSnippet(cycle),
  ].filter((part): part is string => !!part);
  const suffix = parts.length ? theme.fg('dim', ` · ${parts.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', cycleName(cycle))}${suffix}`, width);
}

const CYCLE_TABLE_COLUMNS: TableColumn<CycleLike>[] = [
  {
    id: 'status',
    label: 'Status',
    width: 20,
    value: (cycle) => statusText(cycle),
    style: (theme, value) => statusStyle(theme, value ?? ''),
  },
  {
    id: 'progress',
    label: 'Progress',
    width: 9,
    value: (cycle) => progressText(cycle) ?? '—',
    style: (theme) => dimStyle(theme),
  },
  {
    id: 'range',
    label: 'Range',
    width: 24,
    value: (cycle) =>
      [dateText(cycle.startsAt), dateText(cycle.endsAt)].filter(Boolean).join(' → ') || '—',
    style: (theme) => dimStyle(theme),
  },
  {
    id: 'team',
    label: 'Team',
    width: 12,
    value: (cycle) => teamText(cycle) ?? '—',
    style: (theme) => accentStyle(theme),
  },
];

const CYCLE_ARCHIVED_COLUMN: TableColumn<CycleLike> = {
  id: 'archived',
  label: 'Archived',
  width: 17,
  value: (cycle) => archivedText(cycle) ?? '—',
  style: (theme, value) => (value === '—' ? dimStyle(theme) : (text) => theme.fg('warning', text)),
};

function renderCycleTable(cycles: CycleLike[], theme: Theme, width: number): string[] {
  const columns = cycles.some((cycle) => archivedText(cycle))
    ? [...CYCLE_TABLE_COLUMNS, CYCLE_ARCHIVED_COLUMN]
    : CYCLE_TABLE_COLUMNS;

  return renderResponsiveTable(cycles, theme, width, {
    columns,
    primary: {
      label: 'Cycle',
      minWidth: 20,
      value: cycleName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['team', 'range', 'progress', 'status'],
    fallback: formatCycleListLine,
  });
}

export function renderLinearCycleListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_cycles', args, theme, [
    ['teamId', 'teamId'],
    ['teamKey', 'team'],
    ['filter', 'filter'],
    ['first', 'first'],
    ['after', 'after'],
    ['last', 'last'],
    ['before', 'before'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
  ]);
}

export function renderLinearGetCycleCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_get_cycle', args, theme, [['id', 'id']]);
}

export function renderLinearArchiveCycleCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_archive_cycle', args, theme, [['id', 'id']]);
}

export function renderLinearCycleListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<CycleLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading cycles…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);
  if (context.isError) {
    const message = cleanOneLine(textContent(result)) || 'Linear request failed.';
    return new Text(theme.fg('error', `✗ ${message}`), 0, 0);
  }

  const cycles = Array.isArray(cycleDetails(result).cycles)
    ? (cycleDetails(result).cycles as CycleLike[])
    : [];

  return new LinearListResultComponent(cycles, theme, {
    noun: 'cycle',
    pluralNoun: 'cycles',
    emptyLabel: 'No cycles found',
    previewLimit: CYCLE_LIST_PREVIEW_LIMIT,
    renderItems: renderCycleTable,
  });
}

export function renderLinearCycleMutationCall(
  toolName: string,
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall(toolName, args, theme, [
    ['id', 'id'],
    ['name', 'name'],
    ['teamId', 'teamId'],
    ['teamKey', 'team'],
    ['startsAt', 'starts'],
    ['endsAt', 'ends'],
    ['completedAt', 'completed'],
  ]);
}

function renderCycleDetail(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
  mode: 'get' | 'archive',
): Text {
  const actionLabel = mode === 'archive' ? 'Archived' : 'Cycle';
  if (options.isPartial) {
    return new Text(
      theme.fg('warning', mode === 'archive' ? 'Archiving cycle…' : 'Loading cycle…'),
      0,
      0,
    );
  }
  if (shouldShowJson(options, context)) return expandedJson(result, theme);
  if (context.isError) {
    const message = cleanOneLine(textContent(result)) || `Linear failed to ${mode} the cycle.`;
    return new Text(theme.fg('error', `✗ ${message}`), 0, 0);
  }

  const details = cycleDetails(result);
  if (mode === 'archive' && details.success !== true) {
    return new Text(theme.fg('error', '✗ Cycle archive status unknown.'), 0, 0);
  }

  const cycle = details.cycle;
  if (!cycle) {
    return new Text(theme.fg('error', '✗ Cycle not found.'), 0, 0);
  }

  const status = statusText(cycle);
  const lines = [
    '',
    `${theme.fg('success', `✓ ${actionLabel}`)} ${theme.fg('toolOutput', cycleName(cycle))}`,
    '',
    detailLine(theme, 'Team', teamText(cycle) ?? '—', (text) => theme.fg('accent', text)),
    detailLine(theme, 'Status', status, statusStyle(theme, status)),
    detailLine(theme, 'Progress', progressText(cycle) ?? '—', (text) => theme.fg('dim', text)),
    detailLine(theme, 'Range', rangeText(cycle), (text) => theme.fg('dim', text)),
  ];

  const archived = archivedText(cycle);
  if (archived) {
    lines.push(detailLine(theme, 'Archived', archived, (text) => theme.fg('warning', text)));
  }

  const description = descriptionSnippet(cycle);
  if (description) {
    lines.push(detailLine(theme, 'Description', description, (text) => theme.fg('muted', text)));
  }

  if (mode === 'archive') {
    lines.push(
      detailLine(theme, 'Issues', 'all assigned issues unlinked', (text) =>
        theme.fg('warning', text),
      ),
    );
  }

  lines.push('', jsonHint());
  return new Text(lines.join('\n'), 0, 0);
}

export function renderLinearGetCycleResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text {
  return renderCycleDetail(result, options, theme, context, 'get');
}

export function renderLinearArchiveCycleResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text {
  return renderCycleDetail(result, options, theme, context, 'archive');
}

export function renderLinearCycleMutationResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', 'Working…'), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);
    if (context.isError) {
      const message = cleanOneLine(textContent(result)) || 'Cycle operation failed.';
      return new Text(theme.fg('error', `✗ ${message}`), 0, 0);
    }

    const details = cycleDetails(result);
    if (details.success === false) {
      return new Text(theme.fg('error', '✗ Cycle operation failed.'), 0, 0);
    }

    const cycle = details.cycle;
    if (!cycle) {
      return new Text(theme.fg('error', '✗ Cycle operation returned no cycle.'), 0, 0);
    }

    const range = [dateText(cycle.startsAt), dateText(cycle.endsAt)].filter(Boolean).join(' → ');
    const lines = [
      `${theme.fg('success', `✓ ${actionLabel}`)} ${theme.fg('toolOutput', cycleName(cycle))}`,
    ];
    const progress = progressText(cycle);
    const parts = [
      range || undefined,
      statusText(cycle),
      progress ? `progress ${progress}` : undefined,
      teamText(cycle),
      archivedMetadata(cycle),
    ].filter((part): part is string => !!part);
    if (parts.length) lines.push(theme.fg('dim', parts.join(' · ')));
    lines.push('', jsonHint());

    return new Text(lines.join('\n'), 0, 0);
  };
}
