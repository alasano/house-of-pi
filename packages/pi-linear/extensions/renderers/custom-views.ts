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

type CustomViewTeam = {
  id?: string | null;
  key?: string | null;
  name?: string | null;
};

type CustomViewLike = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  filterData?: Record<string, unknown> | null;
  shared?: boolean | null;
  slugId?: string | null;
  modelName?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  team?: CustomViewTeam | null;
  owner?: { id?: string | null; name?: string | null; email?: string | null } | null;
};

type CustomViewResultDetails = {
  views?: CustomViewLike[];
  view?: CustomViewLike;
};

const VIEW_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 60;
const DESCRIPTION_LIMIT = 100;

function viewDetails(result: AgentToolResult<any>): CustomViewResultDetails {
  return (result.details ?? {}) as CustomViewResultDetails;
}

function viewName(view: CustomViewLike): string {
  return truncate(cleanOneLine(asString(view.name) ?? '(unnamed view)'), NAME_LIMIT);
}

function teamText(view: CustomViewLike): string | undefined {
  return asString(view.team?.key) ?? asString(view.team?.name) ?? asString(view.team?.id);
}

function scopeText(view: CustomViewLike): string {
  return teamText(view) ? `team: ${teamText(view)}` : 'workspace';
}

function descriptionSnippet(view: CustomViewLike): string | undefined {
  const description = asString(view.description);
  if (!description) return undefined;
  return truncate(cleanOneLine(description), DESCRIPTION_LIMIT);
}

function archivedText(view: CustomViewLike): string | undefined {
  const archivedAt = asString(view.archivedAt);
  return archivedAt?.slice(0, 10);
}

function archivedMetadata(view: CustomViewLike): string | undefined {
  const archived = archivedText(view);
  return archived ? `archived ${archived}` : undefined;
}

function metadataParts(view: CustomViewLike): string[] {
  const icon = asString(view.icon);
  const shared = view.shared;
  const filterKeys = view.filterData ? Object.keys(view.filterData).length : 0;

  return [
    scopeText(view),
    icon ? `icon: ${icon}` : undefined,
    typeof shared === 'boolean' ? (shared ? 'shared' : 'private') : undefined,
    filterKeys ? `${filterKeys} filter(s)` : 'no filter',
    archivedMetadata(view),
  ].filter((part): part is string => !!part);
}

function formatViewListLine(view: CustomViewLike, theme: Theme, width: number): string {
  const metadata = metadataParts(view);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', viewName(view))}${suffix}`, width);
}

const VIEW_TABLE_COLUMNS: TableColumn<CustomViewLike>[] = [
  {
    id: 'scope',
    label: 'Scope',
    width: 12,
    value: (view) => scopeText(view),
    style: (theme) => accentStyle(theme),
  },
  {
    id: 'icon',
    label: 'Icon',
    width: 10,
    value: (view) => asString(view.icon) ?? '—',
    style: (theme) => dimStyle(theme),
  },
  {
    id: 'description',
    label: 'Description',
    width: 40,
    value: (view) => descriptionSnippet(view) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
];

const VIEW_ARCHIVED_COLUMN: TableColumn<CustomViewLike> = {
  id: 'archived',
  label: 'Archived',
  width: 10,
  value: (view) => archivedText(view) ?? '—',
  style: (theme, value) => (value === '—' ? dimStyle(theme) : (text) => theme.fg('warning', text)),
};

function renderViewTable(views: CustomViewLike[], theme: Theme, width: number): string[] {
  const columns = views.some((view) => archivedText(view))
    ? [...VIEW_TABLE_COLUMNS, VIEW_ARCHIVED_COLUMN]
    : VIEW_TABLE_COLUMNS;

  return renderResponsiveTable(views, theme, width, {
    columns,
    primary: {
      label: 'Name',
      minWidth: 28,
      value: viewName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['description', 'icon', 'scope'],
    fallback: formatViewListLine,
  });
}

export function renderLinearCustomViewListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_views', args, theme, [
    ['first', 'first'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
  ]);
}

export function renderLinearCustomViewListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<CustomViewLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading custom views…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const views = Array.isArray(viewDetails(result).views)
    ? (viewDetails(result).views as CustomViewLike[])
    : [];

  return new LinearListResultComponent(views, theme, {
    noun: 'view',
    pluralNoun: 'views',
    emptyLabel: 'No custom views found',
    previewLimit: VIEW_LIST_PREVIEW_LIMIT,
    renderItems: renderViewTable,
  });
}

export function renderLinearCustomViewMutationCall(
  toolName: string,
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall(toolName, args, theme, [
    ['name', 'name'],
    ['teamId', 'team'],
    ['icon', 'icon'],
    ['color', 'color'],
    ['shared', 'shared'],
  ]);
}

export function renderLinearCustomViewMutationResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Working…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const view = viewDetails(result).view;
  if (!view) return new Text(theme.fg('muted', 'Custom view operation completed.'), 0, 0);

  const lines = [`${theme.fg('success', '✓')} ${theme.fg('toolOutput', viewName(view))}`];
  const parts = metadataParts(view);
  if (parts.length) lines.push(theme.fg('dim', parts.join(' · ')));

  return new Text(lines.join('\n'), 0, 0);
}
