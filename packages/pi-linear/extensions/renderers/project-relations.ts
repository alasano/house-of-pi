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

type ProjectRelationProject = {
  id?: string | null;
  name?: string | null;
};

type ProjectRelationMilestone = {
  id?: string | null;
  name?: string | null;
};

type ProjectRelationLike = {
  id?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  type?: string | null;
  anchorType?: string | null;
  relatedAnchorType?: string | null;
  project?: ProjectRelationProject | null;
  projectMilestone?: ProjectRelationMilestone | null;
  relatedProject?: ProjectRelationProject | null;
  relatedProjectMilestone?: ProjectRelationMilestone | null;
};

type ProjectRelationResultDetails = {
  projectRelation?: ProjectRelationLike | null;
  projectRelations?: ProjectRelationLike[];
  success?: boolean;
};

const PROJECT_RELATION_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 70;
const TABLE_RELATION_MIN_WIDTH = 28;

const PROJECT_RELATION_MUTATION_FIELDS: Array<[key: string, label: string]> = [
  ['id', 'id'],
  ['projectId', 'projectId'],
  ['relatedProjectId', 'relatedProjectId'],
  ['type', 'type'],
  ['anchorType', 'anchor'],
  ['relatedAnchorType', 'relatedAnchor'],
  ['projectMilestoneId', 'projectMilestone'],
  ['relatedProjectMilestoneId', 'relatedProjectMilestone'],
];

function projectRelationDetails(result: AgentToolResult<any>): ProjectRelationResultDetails {
  return (result.details ?? {}) as ProjectRelationResultDetails;
}

function argsObject(context: { args?: unknown }): ToolArgs {
  return context.args && typeof context.args === 'object' && !Array.isArray(context.args)
    ? (context.args as ToolArgs)
    : {};
}

function projectName(project: ProjectRelationProject | null | undefined, fallback: string): string {
  return truncate(
    cleanOneLine(asString(project?.name) ?? asString(project?.id) ?? fallback),
    NAME_LIMIT,
  );
}

function hasProject(project: ProjectRelationProject | null | undefined): boolean {
  return !!(asString(project?.name) ?? asString(project?.id));
}

function relationType(relation: ProjectRelationLike): string {
  return asString(relation.type) ?? 'relation';
}

function milestoneName(milestone: ProjectRelationMilestone | null | undefined): string | undefined {
  const name = asString(milestone?.name) ?? asString(milestone?.id);
  return name ? truncate(cleanOneLine(name), NAME_LIMIT) : undefined;
}

function anchorText(
  anchorType: string | null | undefined,
  milestone: ProjectRelationMilestone | null | undefined,
): string | undefined {
  const anchor = asString(anchorType);
  const milestoneLabel = milestoneName(milestone);

  if (anchor && milestoneLabel) return `${anchor}: ${milestoneLabel}`;
  return milestoneLabel ?? anchor;
}

function projectAnchorText(relation: ProjectRelationLike): string | undefined {
  return anchorText(relation.anchorType, relation.projectMilestone);
}

function relatedProjectAnchorText(relation: ProjectRelationLike): string | undefined {
  return anchorText(relation.relatedAnchorType, relation.relatedProjectMilestone);
}

function relationSummary(relation: ProjectRelationLike): string {
  const id = asString(relation.id);
  const hasSource = hasProject(relation.project);
  const hasRelated = hasProject(relation.relatedProject);

  if (!hasSource && !hasRelated && id) return truncate(id, NAME_LIMIT);

  const project = projectName(relation.project, 'project');
  const relatedProject = projectName(relation.relatedProject, 'related project');
  return truncate(
    cleanOneLine(`${project} ${relationType(relation)} ${relatedProject}`),
    NAME_LIMIT * 2,
  );
}

function metadataParts(
  relation: ProjectRelationLike,
  options: { includeId?: boolean } = {},
): string[] {
  const anchor = projectAnchorText(relation);
  const relatedAnchor = relatedProjectAnchorText(relation);
  const id = options.includeId ? asString(relation.id) : undefined;

  return [
    anchor ? `anchor: ${anchor}` : undefined,
    relatedAnchor ? `related anchor: ${relatedAnchor}` : undefined,
    id ? `id: ${truncate(id, 8)}` : undefined,
  ].filter((part): part is string => !!part);
}

function formatProjectRelationListLine(
  relation: ProjectRelationLike,
  theme: Theme,
  width: number,
): string {
  const summary = relationSummary(relation);
  const metadata = metadataParts(relation, { includeId: true });
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', summary)}${suffix}`, width);
}

const PROJECT_RELATION_TABLE_COLUMNS: TableColumn<ProjectRelationLike>[] = [
  {
    id: 'type',
    label: 'Type',
    width: 12,
    value: (relation) => relationType(relation),
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'project',
    label: 'Project',
    width: 22,
    value: (relation) => projectName(relation.project, '—'),
    style: (theme) => toolOutputStyle(theme),
  },
  {
    id: 'relatedProject',
    label: 'Related project',
    width: 22,
    value: (relation) => projectName(relation.relatedProject, '—'),
    style: (theme) => toolOutputStyle(theme),
  },
  {
    id: 'anchor',
    label: 'Anchor',
    width: 20,
    value: (relation) => projectAnchorText(relation) ?? '—',
    style: (theme) => dimStyle(theme),
  },
  {
    id: 'relatedAnchor',
    label: 'Related anchor',
    width: 20,
    value: (relation) => relatedProjectAnchorText(relation) ?? '—',
    style: (theme) => dimStyle(theme),
  },
];

function renderProjectRelationTable(
  projectRelations: ProjectRelationLike[],
  theme: Theme,
  width: number,
): string[] {
  return renderResponsiveTable(projectRelations, theme, width, {
    columns: PROJECT_RELATION_TABLE_COLUMNS,
    primary: {
      label: 'Relation',
      minWidth: TABLE_RELATION_MIN_WIDTH,
      value: relationSummary,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['relatedAnchor', 'anchor', 'relatedProject', 'project', 'type'],
    fallback: formatProjectRelationListLine,
  });
}

function formatProjectRelationTitle(relation: ProjectRelationLike, theme: Theme): string {
  const id = asString(relation.id);
  const title = theme.fg('toolOutput', relationSummary(relation));
  return id ? `${title} ${theme.fg('dim', `(${truncate(id, 8)})`)}` : title;
}

function renderProjectRelationCard(
  actionLabel: string,
  relation: ProjectRelationLike | null | undefined,
  theme: Theme,
): Text {
  if (!relation) {
    return new Text(`\n${theme.fg('dim', 'Project relation not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const metadata = metadataParts(relation);

  let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatProjectRelationTitle(relation, theme)}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

export function renderLinearProjectRelationListCall(
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall('linear_list_project_relations', args, theme, [
    ['first', 'first'],
    ['orderBy', 'order'],
  ]);
}

export function renderLinearCreateProjectRelationCall(
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall(
    'linear_create_project_relation',
    args,
    theme,
    PROJECT_RELATION_MUTATION_FIELDS,
  );
}

export function renderLinearUpdateProjectRelationCall(
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall(
    'linear_update_project_relation',
    args,
    theme,
    PROJECT_RELATION_MUTATION_FIELDS,
  );
}

export function renderLinearDeleteProjectRelationCall(
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall('linear_delete_project_relation', args, theme, [['id', 'id']]);
}

export function renderLinearProjectRelationListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<ProjectRelationLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading project relations…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const projectRelations = Array.isArray(projectRelationDetails(result).projectRelations)
    ? (projectRelationDetails(result).projectRelations as ProjectRelationLike[])
    : [];

  return new LinearListResultComponent(projectRelations, theme, {
    noun: 'project relation',
    pluralNoun: 'project relations',
    emptyLabel: 'No project relations found',
    previewLimit: PROJECT_RELATION_LIST_PREVIEW_LIMIT,
    renderItems: renderProjectRelationTable,
  });
}

export function renderLinearProjectRelationResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);

    return renderProjectRelationCard(
      actionLabel,
      projectRelationDetails(result).projectRelation,
      theme,
    );
  };
}

export function renderLinearDeleteProjectRelationResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: { args?: unknown },
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Deleting project relation…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const details = projectRelationDetails(result);
  const args = argsObject(context);
  const id = asString(args.id) ?? 'project relation';

  if (details.success !== true) {
    return new Text(`\n${theme.fg('warning', 'Delete status unknown')}\n\n${jsonHint()}`, 0, 0);
  }

  return new Text(
    `\n${theme.fg('success', '✓ Deleted project relation')} ${theme.fg('accent', id)}\n\n${jsonHint()}`,
    0,
    0,
  );
}
