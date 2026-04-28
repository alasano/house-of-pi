import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';
import {
  asString,
  cleanOneLine,
  dimStyle,
  expandedJson,
  jsonHint,
  LinearListResultComponent,
  mutedStyle,
  renderLinearToolCall,
  renderResponsiveTable,
  toolOutputStyle,
  truncate,
  truncateLine,
  type TableColumn,
  type ToolArgs,
} from './common';

type ProjectPerson = {
  id?: string;
  name?: string | null;
  email?: string | null;
};

type ProjectTeam = {
  id?: string;
  key?: string | null;
  name?: string | null;
};

type ProjectLike = {
  id?: string;
  name?: string | null;
  description?: string | null;
  state?: string | null;
  status?: { id?: string; name?: string | null } | null;
  priority?: number | null;
  priorityLabel?: string | null;
  health?: string | null;
  progress?: number | null;
  startDate?: string | null;
  targetDate?: string | null;
  url?: string | null;
  lead?: ProjectPerson | null;
  teams?: { nodes?: ProjectTeam[] | null } | null;
};

type ProjectResultDetails = {
  project?: ProjectLike | null;
  projects?: ProjectLike[];
  success?: boolean;
};

const PROJECT_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 90;
const DESCRIPTION_LIMIT = 180;
const TABLE_NAME_MIN_WIDTH = 24;

function projectDetails(result: AgentToolResult<any>): ProjectResultDetails {
  return (result.details ?? {}) as ProjectResultDetails;
}

function argsObject(context: { args?: unknown }): ToolArgs {
  return context.args && typeof context.args === 'object' && !Array.isArray(context.args)
    ? (context.args as ToolArgs)
    : {};
}

function valueObject(value: unknown): ToolArgs | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ToolArgs)
    : undefined;
}

function humanizeEnum(value: string): string {
  const spaced = value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function projectName(project: ProjectLike): string {
  return truncate(cleanOneLine(asString(project.name) ?? '(untitled project)'), NAME_LIMIT);
}

function statusText(project: ProjectLike): string | undefined {
  return asString(project.status?.name) ?? asString(project.state);
}

function priorityText(project: ProjectLike): string | undefined {
  const label = asString(project.priorityLabel);
  if (label) return label;

  if (typeof project.priority !== 'number') return undefined;
  const priorityLabels: Record<number, string> = {
    0: 'No priority',
    1: 'Urgent',
    2: 'High',
    3: 'Medium',
    4: 'Low',
  };
  return priorityLabels[project.priority] ?? `P${project.priority}`;
}

function healthText(project: ProjectLike): string | undefined {
  const health = asString(project.health);
  return health ? humanizeEnum(health) : undefined;
}

function progressText(project: ProjectLike): string | undefined {
  if (typeof project.progress !== 'number' || Number.isNaN(project.progress)) return undefined;
  const percentage = project.progress <= 1 ? project.progress * 100 : project.progress;
  return `${Math.round(percentage)}%`;
}

function teamNames(project: ProjectLike): string[] {
  const nodes = Array.isArray(project.teams?.nodes) ? project.teams.nodes : [];
  return nodes
    .map((team) => asString(team.key) ?? asString(team.name))
    .filter((team): team is string => !!team);
}

function teamText(project: ProjectLike, limit = 3): string | undefined {
  const teams = teamNames(project);
  if (teams.length === 0) return undefined;

  const shown = teams.slice(0, limit).join(', ');
  const hiddenCount = teams.length - limit;
  return hiddenCount > 0 ? `${shown}, +${hiddenCount}` : shown;
}

function allTeamText(project: ProjectLike): string {
  return teamNames(project).join(', ') || '—';
}

function metadataParts(project: ProjectLike, options: { includeDates?: boolean } = {}): string[] {
  const status = statusText(project);
  const priority = priorityText(project);
  const health = healthText(project);
  const progress = progressText(project);
  const lead = asString(project.lead?.name);
  const teams = teamText(project);
  const startDate = options.includeDates ? asString(project.startDate) : undefined;
  const targetDate = options.includeDates ? asString(project.targetDate) : undefined;

  return [
    status,
    priority,
    health ? `health: ${health}` : undefined,
    progress ? `progress: ${progress}` : undefined,
    lead ? `lead: ${lead}` : undefined,
    teams ? `teams: ${teams}` : undefined,
    startDate ? `start: ${startDate}` : undefined,
    targetDate ? `target: ${targetDate}` : undefined,
  ].filter((part): part is string => !!part);
}

function formatProjectListLine(project: ProjectLike, theme: Theme, width: number): string {
  const name = projectName(project);
  const metadata = metadataParts(project);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', name)}${suffix}`, width);
}

function descriptionSnippet(project: ProjectLike): string | undefined {
  const description = asString(project.description);
  if (!description) return undefined;
  return truncate(cleanOneLine(description), DESCRIPTION_LIMIT);
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

function priorityStyle(theme: Theme, value: string): (text: string) => string {
  const normalized = value.toLowerCase();
  if (normalized === 'urgent') return (text) => theme.fg('error', text);
  if (normalized === 'high') return (text) => theme.fg('warning', text);
  if (normalized === 'low' || normalized === 'no priority' || value === '—') return dimStyle(theme);
  return mutedStyle(theme);
}

function healthStyle(theme: Theme, value: string): (text: string) => string {
  const normalized = value.toLowerCase();
  if (normalized.includes('track') || normalized === 'healthy')
    return (text) => theme.fg('success', text);
  if (normalized.includes('risk')) return (text) => theme.fg('warning', text);
  if (normalized.includes('off') || normalized.includes('blocked'))
    return (text) => theme.fg('error', text);
  if (value === '—') return dimStyle(theme);
  return mutedStyle(theme);
}

const PROJECT_TABLE_COLUMNS: TableColumn<ProjectLike>[] = [
  {
    id: 'status',
    label: 'State/Status',
    width: 14,
    value: (project) => statusText(project) ?? '—',
    style: statusStyle,
  },
  {
    id: 'priority',
    label: 'Priority',
    width: 11,
    value: (project) => priorityText(project) ?? '—',
    style: priorityStyle,
  },
  {
    id: 'health',
    label: 'Health',
    width: 12,
    value: (project) => healthText(project) ?? '—',
    style: healthStyle,
  },
  {
    id: 'progress',
    label: 'Progress',
    width: 9,
    value: (project) => progressText(project) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'lead',
    label: 'Lead',
    width: 16,
    value: (project) => asString(project.lead?.name) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'teams',
    label: 'Teams',
    width: 20,
    value: allTeamText,
    style: (theme) => dimStyle(theme),
  },
];

function renderProjectTable(projects: ProjectLike[], theme: Theme, width: number): string[] {
  return renderResponsiveTable(projects, theme, width, {
    columns: PROJECT_TABLE_COLUMNS,
    primary: {
      label: 'Name',
      minWidth: TABLE_NAME_MIN_WIDTH,
      value: projectName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['teams', 'lead', 'progress', 'health', 'priority', 'status'],
    fallback: formatProjectListLine,
  });
}

function formatProjectTitle(project: ProjectLike, theme: Theme): string {
  const id = asString(project.id);
  const prefix = id ? `${theme.fg('accent', truncate(id, 8))} ` : '';
  return `${prefix}${theme.fg('toolOutput', projectName(project))}`;
}

function renderProjectCard(
  actionLabel: string,
  project: ProjectLike | null | undefined,
  theme: Theme,
): Text {
  if (!project) {
    return new Text(`\n${theme.fg('dim', 'Project not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const metadata = metadataParts(project, { includeDates: true });
  const description = descriptionSnippet(project);

  let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatProjectTitle(project, theme)}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  if (description) text += `\n  ${theme.fg('muted', description)}`;
  const url = asString(project.url);
  if (url) text += `\n  ${theme.fg('dim', url)}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

function isProjectUpdate(context: { args?: unknown }): boolean {
  const args = argsObject(context);
  if (asString(args.projectId)) return true;

  const input = valueObject(args.input);
  return !!asString(input?.id);
}

export function renderLinearProjectListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_projects', args, theme, [
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
    ['filter', 'filter'],
    ['sort', 'sort'],
  ]);
}

export function renderLinearGetProjectCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_get_project', args, theme, [['projectId', 'projectId']]);
}

export function renderLinearSaveProjectCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_save_project', args, theme, [
    ['projectId', 'projectId'],
    ['name', 'name'],
    ['teamIds', 'teams'],
    ['leadId', 'lead'],
    ['statusId', 'status'],
    ['priority', 'priority'],
    ['startDate', 'start'],
    ['targetDate', 'target'],
    ['input', 'input'],
  ]);
}

export function renderLinearDeleteProjectCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_delete_project', args, theme, [['projectId', 'projectId']]);
}

export function renderLinearArchiveProjectCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_archive_project', args, theme, [
    ['projectId', 'projectId'],
    ['trash', 'trash'],
  ]);
}

export function renderLinearUnarchiveProjectCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_unarchive_project', args, theme, [
    ['projectId', 'projectId'],
  ]);
}

export function renderLinearProjectListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
): Text | LinearListResultComponent<ProjectLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading projects…'), 0, 0);
  if (options.expanded) return expandedJson(result, theme);

  const projects = Array.isArray(projectDetails(result).projects)
    ? (projectDetails(result).projects as ProjectLike[])
    : [];

  return new LinearListResultComponent(projects, theme, {
    noun: 'project',
    emptyLabel: 'No projects found',
    previewLimit: PROJECT_LIST_PREVIEW_LIMIT,
    renderItems: renderProjectTable,
  });
}

export function renderLinearProjectResult(actionLabel: string) {
  return (result: AgentToolResult<any>, options: ToolRenderResultOptions, theme: Theme): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
    if (options.expanded) return expandedJson(result, theme);

    return renderProjectCard(actionLabel, projectDetails(result).project, theme);
  };
}

export function renderLinearSaveProjectResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: { args?: unknown },
): Text {
  const actionLabel = isProjectUpdate(context) ? 'Updated project' : 'Created project';
  if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
  if (options.expanded) return expandedJson(result, theme);

  return renderProjectCard(actionLabel, projectDetails(result).project, theme);
}

export function renderLinearProjectSuccessResult(defaultActionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: { args?: unknown },
  ): Text => {
    if (options.isPartial)
      return new Text(theme.fg('warning', `${defaultActionLabel} project…`), 0, 0);
    if (options.expanded) return expandedJson(result, theme);

    const details = projectDetails(result);
    const args = argsObject(context);
    const projectId = asString(args.projectId) ?? 'project';
    const actionLabel =
      defaultActionLabel === 'Archived' && args.trash === true ? 'Trashed' : defaultActionLabel;

    if (details.success !== true) {
      return new Text(
        `\n${theme.fg('warning', `${actionLabel} status unknown`)}\n\n${jsonHint()}`,
        0,
        0,
      );
    }

    return new Text(
      `\n${theme.fg('success', `✓ ${actionLabel}`)} ${theme.fg('accent', projectId)}\n\n${jsonHint()}`,
      0,
      0,
    );
  };
}
