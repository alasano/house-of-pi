import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import {
  asString,
  cleanOneLine,
  dimStyle,
  expandedJson,
  shouldShowJson,
  jsonHint,
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

type InitiativeLike = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  content?: string | null;
  status?: string | null;
  targetDate?: string | null;
  health?: string | null;
  completedAt?: string | null;
  startedAt?: string | null;
  archivedAt?: string | null;
  trashed?: boolean | null;
  url?: string | null;
  owner?: { id?: string; name?: string | null; email?: string | null } | null;
};

type InitiativeResultDetails = {
  initiative?: InitiativeLike | null;
  initiatives?: InitiativeLike[];
  success?: boolean;
};

const INITIATIVE_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 90;
const SNIPPET_LIMIT = 180;
const TABLE_NAME_MIN_WIDTH = 24;

function initiativeDetails(result: AgentToolResult<any>): InitiativeResultDetails {
  return (result.details ?? {}) as InitiativeResultDetails;
}

function humanizeEnum(value: string): string {
  const words = cleanOneLine(value)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.replace(/\b\w/g, (character) => character.toUpperCase());
}

function initiativeName(initiative: InitiativeLike): string {
  return truncate(cleanOneLine(asString(initiative.name) ?? '(untitled)'), NAME_LIMIT);
}

function ownerName(initiative: InitiativeLike): string | undefined {
  return asString(initiative.owner?.name) ?? asString(initiative.owner?.email);
}

function statusText(initiative: InitiativeLike): string | undefined {
  const status = asString(initiative.status);
  return status ? humanizeEnum(status) : undefined;
}

function healthText(initiative: InitiativeLike): string | undefined {
  const health = asString(initiative.health);
  return health ? humanizeEnum(health) : undefined;
}

function metadataParts(initiative: InitiativeLike, options: { includeFlags?: boolean } = {}) {
  const owner = ownerName(initiative);
  const targetDate = asString(initiative.targetDate);

  const parts = [
    statusText(initiative),
    healthText(initiative),
    owner ? `@${owner}` : undefined,
    targetDate ? `target ${targetDate}` : undefined,
  ];

  if (options.includeFlags) {
    const startedAt = asString(initiative.startedAt);
    const completedAt = asString(initiative.completedAt);
    const archivedAt = asString(initiative.archivedAt);
    parts.push(
      startedAt ? `started ${startedAt}` : undefined,
      completedAt ? `completed ${completedAt}` : undefined,
      archivedAt ? `archived ${archivedAt}` : undefined,
      initiative.trashed === true ? 'trashed' : undefined,
    );
  }

  return parts.filter((part): part is string => !!part);
}

function descriptionSnippet(initiative: InitiativeLike): string | undefined {
  const text = asString(initiative.description) ?? asString(initiative.content);
  if (!text) return undefined;
  return truncate(cleanOneLine(text), SNIPPET_LIMIT);
}

function formatInitiativeListLine(initiative: InitiativeLike, theme: Theme, width: number): string {
  const name = initiativeName(initiative);
  const metadata = metadataParts(initiative);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', name)}${suffix}`, width);
}

function statusStyle(theme: Theme, value: string): (text: string) => string {
  const normalized = value.toLowerCase();
  if (normalized === 'completed' || normalized === 'done')
    return (text) => theme.fg('success', text);
  if (normalized === 'canceled' || normalized === 'cancelled')
    return (text) => theme.fg('error', text);
  if (normalized === 'planned' || value === '—') return dimStyle(theme);
  return mutedStyle(theme);
}

function healthStyle(theme: Theme, value: string): (text: string) => string {
  const normalized = value.toLowerCase();
  if (normalized.includes('off')) return (text) => theme.fg('error', text);
  if (normalized.includes('risk')) return (text) => theme.fg('warning', text);
  if (normalized.includes('track')) return (text) => theme.fg('success', text);
  if (value === '—') return dimStyle(theme);
  return mutedStyle(theme);
}

const INITIATIVE_TABLE_COLUMNS: TableColumn<InitiativeLike>[] = [
  {
    id: 'status',
    label: 'Status',
    width: 14,
    value: (initiative) => statusText(initiative) ?? '—',
    style: statusStyle,
  },
  {
    id: 'health',
    label: 'Health',
    width: 12,
    value: (initiative) => healthText(initiative) ?? '—',
    style: healthStyle,
  },
  {
    id: 'owner',
    label: 'Owner',
    width: 18,
    value: (initiative) => ownerName(initiative) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'target',
    label: 'Target',
    width: 12,
    value: (initiative) => asString(initiative.targetDate) ?? '—',
    style: (theme) => dimStyle(theme),
  },
];

function renderInitiativeTable(
  initiatives: InitiativeLike[],
  theme: Theme,
  width: number,
): string[] {
  return renderResponsiveTable(initiatives, theme, width, {
    columns: INITIATIVE_TABLE_COLUMNS,
    primary: {
      label: 'Name',
      minWidth: TABLE_NAME_MIN_WIDTH,
      value: initiativeName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['target', 'owner', 'health', 'status'],
    fallback: formatInitiativeListLine,
  });
}

function renderInitiativeCard(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
  actionLabel: string,
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const initiative = initiativeDetails(result).initiative;
  if (!initiative) {
    return new Text(`\n${theme.fg('dim', 'Initiative not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const name = initiativeName(initiative);
  const metadata = metadataParts(initiative, { includeFlags: true });
  const snippet = descriptionSnippet(initiative);
  const url = asString(initiative.url);

  let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${theme.fg('toolOutput', name)}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  if (snippet) text += `\n  ${theme.fg('muted', snippet)}`;
  if (url) text += `\n  ${theme.fg('dim', url)}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

export function renderLinearInitiativeListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_initiatives', args, theme, [
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
    ['filter', 'filter'],
    ['sort', 'sort'],
  ]);
}

export function renderLinearGetInitiativeCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_get_initiative', args, theme, [
    ['initiativeId', 'initiativeId'],
  ]);
}

export function renderLinearSaveInitiativeCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_save_initiative', args, theme, [
    ['initiativeId', 'initiativeId'],
    ['name', 'name'],
    ['status', 'status'],
    ['ownerId', 'ownerId'],
    ['targetDate', 'target'],
  ]);
}

export function renderLinearDeleteInitiativeCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_delete_initiative', args, theme, [
    ['initiativeId', 'initiativeId'],
  ]);
}

export function renderLinearArchiveInitiativeCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_archive_initiative', args, theme, [
    ['initiativeId', 'initiativeId'],
  ]);
}

export function renderLinearUnarchiveInitiativeCall(
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall('linear_unarchive_initiative', args, theme, [
    ['initiativeId', 'initiativeId'],
  ]);
}

export function renderLinearInitiativeListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<InitiativeLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading initiatives…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const initiatives = Array.isArray(initiativeDetails(result).initiatives)
    ? (initiativeDetails(result).initiatives as InitiativeLike[])
    : [];

  return new LinearListResultComponent(initiatives, theme, {
    noun: 'initiative',
    emptyLabel: 'No initiatives found',
    previewLimit: INITIATIVE_LIST_PREVIEW_LIMIT,
    renderItems: renderInitiativeTable,
  });
}

export function renderLinearInitiativeResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => renderInitiativeCard(result, options, theme, context, actionLabel);
}

export function renderLinearSaveInitiativeResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: { args?: unknown },
): Text {
  const args = (context.args ?? {}) as { initiativeId?: unknown };
  const actionLabel = asString(args.initiativeId) ? 'Updated initiative' : 'Created initiative';
  return renderInitiativeCard(result, options, theme, context, actionLabel);
}

export function renderLinearInitiativeSuccessResult(defaultActionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: { args?: unknown },
  ): Text => {
    if (options.isPartial)
      return new Text(theme.fg('warning', `${defaultActionLabel} initiative…`), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);

    const details = initiativeDetails(result);
    const args = (context.args ?? {}) as { initiativeId?: unknown };
    const initiativeId = asString(args.initiativeId) ?? 'initiative';

    if (details.success !== true) {
      return new Text(
        `\n${theme.fg('warning', `${defaultActionLabel} status unknown`)} ${theme.fg(
          'accent',
          initiativeId,
        )}\n\n${jsonHint()}`,
        0,
        0,
      );
    }

    return new Text(
      `\n${theme.fg('success', `✓ ${defaultActionLabel}`)} ${theme.fg(
        'accent',
        initiativeId,
      )}\n\n${jsonHint()}`,
      0,
      0,
    );
  };
}
