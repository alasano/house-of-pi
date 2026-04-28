import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';
import {
  accentStyle,
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

type ProjectLabelLike = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  color?: string | null;
  isGroup?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  retiredAt?: string | null;
  parent?: {
    id?: string | null;
    name?: string | null;
  } | null;
};

type ProjectLabelResultDetails = {
  label?: ProjectLabelLike | null;
  labels?: ProjectLabelLike[];
  success?: boolean;
};

const PROJECT_LABEL_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 90;
const DESCRIPTION_LIMIT = 180;
const TABLE_NAME_MIN_WIDTH = 24;

function projectLabelDetails(result: AgentToolResult<any>): ProjectLabelResultDetails {
  return (result.details ?? {}) as ProjectLabelResultDetails;
}

function labelName(label: ProjectLabelLike): string {
  return truncate(cleanOneLine(asString(label.name) ?? '(unnamed label)'), NAME_LIMIT);
}

function parentName(label: ProjectLabelLike): string | undefined {
  return asString(label.parent?.name) ?? asString(label.parent?.id);
}

function groupText(label: ProjectLabelLike): string | undefined {
  return label.isGroup === true ? 'group' : undefined;
}

function retiredText(label: ProjectLabelLike): string | undefined {
  return asString(label.retiredAt) ? 'retired' : undefined;
}

function colorText(label: ProjectLabelLike): string | undefined {
  return asString(label.color);
}

function descriptionSnippet(label: ProjectLabelLike): string | undefined {
  const description = asString(label.description);
  if (!description) return undefined;
  return truncate(cleanOneLine(description), DESCRIPTION_LIMIT);
}

function metadataParts(
  label: ProjectLabelLike,
  options: { includeDescription?: boolean } = {},
): string[] {
  const parent = parentName(label);
  const group = groupText(label);
  const retired = retiredText(label);
  const color = colorText(label);
  const description = options.includeDescription ? descriptionSnippet(label) : undefined;

  return [
    parent ? `parent: ${parent}` : undefined,
    group,
    retired,
    color ? `color: ${color}` : undefined,
    description,
  ].filter((part): part is string => !!part);
}

function formatProjectLabelListLine(label: ProjectLabelLike, theme: Theme, width: number): string {
  const name = labelName(label);
  const metadata = metadataParts(label, { includeDescription: true });
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', name)}${suffix}`, width);
}

function formatProjectLabelTitle(label: ProjectLabelLike, theme: Theme): string {
  const id = asString(label.id);
  const name = theme.fg('toolOutput', labelName(label));
  return id ? `${name} ${theme.fg('dim', `(${truncate(id, 8)})`)}` : name;
}

function groupColumnText(label: ProjectLabelLike): string {
  return label.isGroup === true ? 'yes' : '—';
}

function colorStyle(theme: Theme, value: string): (text: string) => string {
  if (value === '—') return dimStyle(theme);
  return accentStyle(theme);
}

const PROJECT_LABEL_TABLE_COLUMNS: TableColumn<ProjectLabelLike>[] = [
  {
    id: 'parent',
    label: 'Parent',
    width: 20,
    value: (label) => parentName(label) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'group',
    label: 'Group',
    width: 7,
    value: groupColumnText,
    style: (theme, value) => (value === 'yes' ? mutedStyle(theme) : dimStyle(theme)),
  },
  {
    id: 'color',
    label: 'Color',
    width: 10,
    value: (label) => colorText(label) ?? '—',
    style: colorStyle,
  },
];

function renderProjectLabelTable(
  labels: ProjectLabelLike[],
  theme: Theme,
  width: number,
): string[] {
  return renderResponsiveTable(labels, theme, width, {
    columns: PROJECT_LABEL_TABLE_COLUMNS,
    primary: {
      label: 'Name',
      minWidth: TABLE_NAME_MIN_WIDTH,
      value: labelName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['color', 'group', 'parent'],
    fallback: formatProjectLabelListLine,
  });
}

function renderProjectLabelCard(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  actionLabel: string,
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
  if (options.expanded) return expandedJson(result, theme);

  const label = projectLabelDetails(result).label;
  if (!label) {
    return new Text(`\n${theme.fg('dim', 'Project label not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const metadata = metadataParts(label);
  const description = descriptionSnippet(label);

  let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatProjectLabelTitle(label, theme)}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  if (description) text += `\n  ${theme.fg('muted', description)}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

export function renderLinearProjectLabelListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_project_labels', args, theme, [
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
    ['filter', 'filter'],
  ]);
}

export function renderLinearCreateProjectLabelCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_create_project_label', args, theme, [
    ['id', 'id'],
    ['name', 'name'],
    ['parentId', 'parentId'],
    ['color', 'color'],
    ['isGroup', 'isGroup'],
  ]);
}

export function renderLinearUpdateProjectLabelCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_update_project_label', args, theme, [
    ['id', 'id'],
    ['name', 'name'],
    ['parentId', 'parentId'],
    ['color', 'color'],
    ['isGroup', 'isGroup'],
  ]);
}

export function renderLinearDeleteProjectLabelCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_delete_project_label', args, theme, [['id', 'id']]);
}

export function renderLinearProjectLabelListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
): Text | LinearListResultComponent<ProjectLabelLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading project labels…'), 0, 0);
  if (options.expanded) return expandedJson(result, theme);

  const labels = Array.isArray(projectLabelDetails(result).labels)
    ? (projectLabelDetails(result).labels as ProjectLabelLike[])
    : [];

  return new LinearListResultComponent(labels, theme, {
    noun: 'label',
    emptyLabel: 'No project labels found',
    previewLimit: PROJECT_LABEL_LIST_PREVIEW_LIMIT,
    renderItems: renderProjectLabelTable,
  });
}

export function renderLinearProjectLabelResult(actionLabel: string) {
  return (result: AgentToolResult<any>, options: ToolRenderResultOptions, theme: Theme): Text =>
    renderProjectLabelCard(result, options, theme, actionLabel);
}

export function renderLinearProjectLabelDeleteResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: { args?: unknown },
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Deleting project label…'), 0, 0);
  if (options.expanded) return expandedJson(result, theme);

  const details = projectLabelDetails(result);
  const args = (context.args ?? {}) as { id?: unknown };
  const id = asString(args.id) ?? 'project label';

  if (details.success !== true) {
    return new Text(`\n${theme.fg('warning', 'Delete status unknown')}\n\n${jsonHint()}`, 0, 0);
  }

  return new Text(
    `\n${theme.fg('success', '✓ Deleted project label')} ${theme.fg('accent', id)}\n\n${jsonHint()}`,
    0,
    0,
  );
}
