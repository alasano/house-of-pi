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

type MilestoneLike = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  progress?: number | null;
  targetDate?: string | null;
  sortOrder?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  project?: {
    id?: string | null;
    name?: string | null;
    url?: string | null;
  } | null;
};

type MilestoneResultDetails = {
  milestone?: MilestoneLike | null;
  milestones?: MilestoneLike[];
  success?: boolean;
};

const MILESTONE_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 90;
const DESCRIPTION_LIMIT = 180;
const TABLE_NAME_MIN_WIDTH = 24;

function milestoneDetails(result: AgentToolResult<any>): MilestoneResultDetails {
  return (result.details ?? {}) as MilestoneResultDetails;
}

function milestoneName(milestone: MilestoneLike): string {
  return truncate(cleanOneLine(asString(milestone.name) ?? '(unnamed milestone)'), NAME_LIMIT);
}

function milestoneProject(milestone: MilestoneLike): string | undefined {
  return asString(milestone.project?.name) ?? asString(milestone.project?.id);
}

function milestoneStatus(milestone: MilestoneLike): string | undefined {
  return asString(milestone.status);
}

function milestoneTarget(milestone: MilestoneLike): string | undefined {
  return asString(milestone.targetDate);
}

function milestoneProgress(milestone: MilestoneLike): string | undefined {
  const progress = milestone.progress;
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return undefined;

  const percent = progress >= 0 && progress <= 1 ? progress * 100 : progress;
  return `${Math.round(percent)}%`;
}

function metadataParts(milestone: MilestoneLike): string[] {
  const project = milestoneProject(milestone);
  const status = milestoneStatus(milestone);
  const progress = milestoneProgress(milestone);
  const target = milestoneTarget(milestone);

  return [
    project ? `project: ${project}` : undefined,
    status ? `status: ${status}` : undefined,
    progress ? `progress: ${progress}` : undefined,
    target ? `target: ${target}` : undefined,
  ].filter((part): part is string => !!part);
}

function descriptionSnippet(milestone: MilestoneLike): string | undefined {
  const description = asString(milestone.description);
  if (!description) return undefined;
  return truncate(cleanOneLine(description), DESCRIPTION_LIMIT);
}

function formatMilestoneListLine(milestone: MilestoneLike, theme: Theme, width: number): string {
  const name = milestoneName(milestone);
  const metadata = metadataParts(milestone);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', name)}${suffix}`, width);
}

function formatMilestoneTitle(milestone: MilestoneLike, theme: Theme): string {
  const id = asString(milestone.id);
  const name = theme.fg('toolOutput', milestoneName(milestone));
  return id ? `${name} ${theme.fg('dim', `(${truncate(id, 8)})`)}` : name;
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

const MILESTONE_TABLE_COLUMNS: TableColumn<MilestoneLike>[] = [
  {
    id: 'project',
    label: 'Project',
    width: 20,
    value: (milestone) => milestoneProject(milestone) ?? '—',
    style: (theme) => accentStyle(theme),
  },
  {
    id: 'status',
    label: 'Status',
    width: 12,
    value: (milestone) => milestoneStatus(milestone) ?? '—',
    style: statusStyle,
  },
  {
    id: 'progress',
    label: 'Progress',
    width: 9,
    value: (milestone) => milestoneProgress(milestone) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'target',
    label: 'Target',
    width: 12,
    value: (milestone) => milestoneTarget(milestone) ?? '—',
    style: (theme) => dimStyle(theme),
  },
];

function renderMilestoneTable(milestones: MilestoneLike[], theme: Theme, width: number): string[] {
  return renderResponsiveTable(milestones, theme, width, {
    columns: MILESTONE_TABLE_COLUMNS,
    primary: {
      label: 'Name',
      minWidth: TABLE_NAME_MIN_WIDTH,
      value: milestoneName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['progress', 'target', 'status', 'project'],
    fallback: formatMilestoneListLine,
  });
}

function renderMilestoneCard(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
  actionLabel: string,
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const milestone = milestoneDetails(result).milestone;
  if (!milestone) {
    return new Text(`\n${theme.fg('dim', 'Milestone not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const metadata = metadataParts(milestone);
  const description = descriptionSnippet(milestone);

  let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatMilestoneTitle(milestone, theme)}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  if (description) text += `\n  ${theme.fg('muted', description)}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

export function renderLinearMilestoneListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_milestones', args, theme, [
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
    ['filter', 'filter'],
  ]);
}

export function renderLinearMilestoneGetCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_get_milestone', args, theme, [
    ['milestoneId', 'milestoneId'],
  ]);
}

export function renderLinearMilestoneSaveCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_save_milestone', args, theme, [
    ['milestoneId', 'milestoneId'],
    ['name', 'name'],
    ['projectId', 'projectId'],
    ['targetDate', 'target'],
  ]);
}

export function renderLinearMilestoneDeleteCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_delete_milestone', args, theme, [
    ['milestoneId', 'milestoneId'],
  ]);
}

export function renderLinearMilestoneListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<MilestoneLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading milestones…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const milestones = Array.isArray(milestoneDetails(result).milestones)
    ? (milestoneDetails(result).milestones as MilestoneLike[])
    : [];

  return new LinearListResultComponent(milestones, theme, {
    noun: 'milestone',
    emptyLabel: 'No milestones found',
    previewLimit: MILESTONE_LIST_PREVIEW_LIMIT,
    renderItems: renderMilestoneTable,
  });
}

export function renderLinearMilestoneResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => renderMilestoneCard(result, options, theme, context, actionLabel);
}

export function renderLinearMilestoneSaveResult() {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: { args?: unknown },
  ): Text => {
    const args = (context.args ?? {}) as { milestoneId?: unknown };
    const actionLabel = asString(args.milestoneId) ? 'Updated milestone' : 'Created milestone';
    return renderMilestoneCard(result, options, theme, context, actionLabel);
  };
}

export function renderLinearMilestoneDeleteResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: { args?: unknown },
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Deleting milestone…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const details = milestoneDetails(result);
  const args = (context.args ?? {}) as { milestoneId?: unknown };
  const milestoneId = asString(args.milestoneId) ?? 'milestone';

  if (details.success !== true) {
    return new Text(`\n${theme.fg('warning', 'Delete status unknown')}\n\n${jsonHint()}`, 0, 0);
  }

  return new Text(
    `\n${theme.fg('success', '✓ Deleted milestone')} ${theme.fg('accent', milestoneId)}\n\n${jsonHint()}`,
    0,
    0,
  );
}
