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
  projectFilterData?: Record<string, unknown> | null;
  initiativeFilterData?: Record<string, unknown> | null;
  feedItemFilterData?: Record<string, unknown> | null;
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

function viewTypeText(view: CustomViewLike): string | undefined {
  switch (view.modelName) {
    case 'Project':
      return 'projects';
    case 'Initiative':
      return 'initiatives';
    case 'FeedItem':
      return 'updates';
    default:
      return undefined;
  }
}

function activeFilterData(view: CustomViewLike): Record<string, unknown> | null | undefined {
  switch (view.modelName) {
    case 'Project':
      return view.projectFilterData;
    case 'Initiative':
      return view.initiativeFilterData;
    case 'FeedItem':
      return view.feedItemFilterData;
    default:
      return view.filterData;
  }
}

function filterKeysText(view: CustomViewLike): string | undefined {
  const filter = activeFilterData(view);
  const keys = filter ? Object.keys(filter) : [];
  return keys.length ? truncate(keys.join(', '), 60) : undefined;
}

function metadataParts(view: CustomViewLike): string[] {
  const icon = asString(view.icon);
  const shared = view.shared;
  const viewType = viewTypeText(view);
  const filterKeys = filterKeysText(view);

  return [
    scopeText(view),
    viewType ? `${viewType} view` : undefined,
    icon ? `icon: ${icon}` : undefined,
    typeof shared === 'boolean' ? (shared ? 'shared' : 'private') : undefined,
    filterKeys ? `filter: ${filterKeys}` : 'no filter',
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

const VIEW_TYPE_COLUMN: TableColumn<CustomViewLike> = {
  id: 'type',
  label: 'Type',
  width: 12,
  value: (view) => viewTypeText(view) ?? 'issues',
  style: (theme) => dimStyle(theme),
};

function renderViewTable(views: CustomViewLike[], theme: Theme, width: number): string[] {
  let columns = views.some((view) => viewTypeText(view))
    ? [VIEW_TYPE_COLUMN, ...VIEW_TABLE_COLUMNS]
    : VIEW_TABLE_COLUMNS;
  if (views.some((view) => archivedText(view))) {
    columns = [...columns, VIEW_ARCHIVED_COLUMN];
  }

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
    ['filter', 'filter'],
    ['first', 'first'],
    ['after', 'after'],
    ['last', 'last'],
    ['before', 'before'],
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
  if (context.isError) {
    const message = cleanOneLine(textContent(result)) || 'Linear request failed.';
    return new Text(theme.fg('error', `✗ ${message}`), 0, 0);
  }

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
    ['id', 'id'],
    ['name', 'name'],
    ['teamId', 'teamId'],
    ['teamKey', 'team'],
    ['icon', 'icon'],
    ['color', 'color'],
    ['shared', 'shared'],
    ['filterData', 'filter'],
    ['projectFilterData', 'projectFilter'],
    ['initiativeFilterData', 'initiativeFilter'],
    ['feedItemFilterData', 'feedFilter'],
  ]);
}

export function renderLinearCustomViewMutationResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', 'Working…'), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);
    if (context.isError) {
      const message = cleanOneLine(textContent(result)) || 'Custom view operation failed.';
      return new Text(theme.fg('error', `✗ ${message}`), 0, 0);
    }

    const view = viewDetails(result).view;
    if (!view) return new Text(theme.fg('muted', 'Custom view operation completed.'), 0, 0);

    const lines = [
      `${theme.fg('success', `✓ ${actionLabel}`)} ${theme.fg('toolOutput', viewName(view))}`,
    ];
    const parts = metadataParts(view);
    if (parts.length) lines.push(theme.fg('dim', parts.join(' · ')));
    const description = descriptionSnippet(view);
    if (description) lines.push(theme.fg('muted', description));
    lines.push('', jsonHint());

    return new Text(lines.join('\n'), 0, 0);
  };
}

export function renderLinearGetViewResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading view…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);
  if (context.isError) {
    const message = cleanOneLine(textContent(result)) || 'Linear failed to get the view.';
    return new Text(theme.fg('error', `✗ ${message}`), 0, 0);
  }

  const view = viewDetails(result).view;
  if (!view) {
    return new Text(theme.fg('error', '✗ View not found.'), 0, 0);
  }

  const lines = [
    '',
    `${theme.fg('success', '✓ View')} ${theme.fg('toolOutput', viewName(view))}`,
    '',
    detailLine(theme, 'Type', `${viewTypeText(view) ?? 'issues'} view`, (text) =>
      theme.fg('accent', text),
    ),
    detailLine(theme, 'Scope', scopeText(view), (text) => theme.fg('accent', text)),
  ];

  if (typeof view.shared === 'boolean') {
    lines.push(
      detailLine(theme, 'Shared', view.shared ? 'shared' : 'private', (text) =>
        theme.fg('dim', text),
      ),
    );
  }

  const icon = asString(view.icon);
  if (icon) {
    lines.push(detailLine(theme, 'Icon', icon, (text) => theme.fg('dim', text)));
  }

  lines.push(
    detailLine(theme, 'Filter', filterKeysText(view) ?? 'none', (text) => theme.fg('dim', text)),
  );

  const slug = asString(view.slugId);
  if (slug) {
    lines.push(detailLine(theme, 'Slug', slug, (text) => theme.fg('dim', text)));
  }

  const archived = archivedText(view);
  if (archived) {
    lines.push(detailLine(theme, 'Archived', archived, (text) => theme.fg('warning', text)));
  }

  const description = descriptionSnippet(view);
  if (description) {
    lines.push(detailLine(theme, 'Description', description, (text) => theme.fg('muted', text)));
  }

  lines.push('', jsonHint());
  return new Text(lines.join('\n'), 0, 0);
}
