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
  dimStyle,
  expandedJson,
  shouldShowJson,
  LinearListResultComponent,
  mutedStyle,
  renderLinearToolCall,
  renderResponsiveTable,
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
  createdAt?: string | null;
  updatedAt?: string | null;
  team?: CycleTeam | null;
};

type CycleResultDetails = {
  cycles?: CycleLike[];
  cycle?: CycleLike;
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
  if (cycle.completedAt) return 'completed';
  if (!cycle.startsAt) return 'planned';
  const now = Date.now();
  const startsAt = Date.parse(cycle.startsAt);
  const endsAt = cycle.endsAt ? Date.parse(cycle.endsAt) : NaN;
  if (!Number.isFinite(startsAt)) return 'planned';
  if (now < startsAt) return 'upcoming';
  if (Number.isFinite(endsAt) && now > endsAt) return 'past';
  return 'active';
}

function statusStyle(theme: Theme, value: string): (text: string) => string {
  if (value === 'completed') return (text) => theme.fg('success', text);
  if (value === 'active') return (text) => theme.fg('warning', text);
  if (value === 'upcoming') return (text) => theme.fg('accent', text);
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
  const parts = [range || undefined, status, teamText(cycle), descriptionSnippet(cycle)].filter(
    (part): part is string => !!part,
  );
  const suffix = parts.length ? theme.fg('dim', ` · ${parts.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', cycleName(cycle))}${suffix}`, width);
}

const CYCLE_TABLE_COLUMNS: TableColumn<CycleLike>[] = [
  {
    id: 'status',
    label: 'Status',
    width: 10,
    value: (cycle) => statusText(cycle),
    style: (theme, value) => statusStyle(theme, value ?? ''),
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

function renderCycleTable(cycles: CycleLike[], theme: Theme, width: number): string[] {
  return renderResponsiveTable(cycles, theme, width, {
    columns: CYCLE_TABLE_COLUMNS,
    primary: {
      label: 'Cycle',
      minWidth: 20,
      value: cycleName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['team', 'range', 'status'],
    fallback: formatCycleListLine,
  });
}

export function renderLinearCycleListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_cycles', args, theme, [
    ['first', 'first'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
  ]);
}

export function renderLinearCycleListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<CycleLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading cycles…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

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
    ['name', 'name'],
    ['teamId', 'team'],
    ['startsAt', 'starts'],
    ['endsAt', 'ends'],
  ]);
}

export function renderLinearCycleMutationResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Working…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const cycle = cycleDetails(result).cycle;
  if (!cycle) return new Text(theme.fg('muted', 'Cycle operation completed.'), 0, 0);

  const range = [dateText(cycle.startsAt), dateText(cycle.endsAt)].filter(Boolean).join(' → ');
  const lines = [`${theme.fg('success', '✓')} ${theme.fg('toolOutput', cycleName(cycle))}`];
  const parts = [range || undefined, statusText(cycle), teamText(cycle)].filter(
    (part): part is string => !!part,
  );
  if (parts.length) lines.push(theme.fg('dim', parts.join(' · ')));

  return new Text(lines.join('\n'), 0, 0);
}
