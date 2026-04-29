import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';
import {
  asString,
  cleanOneLine,
  expandedJson,
  shouldShowJson,
  jsonHint,
  LinearListResultComponent,
  renderLinearToolCall,
  renderResponsiveTable,
  truncate,
  truncateLine,
  type LinearToolRenderContext,
  type TableColumn,
  type ToolArgs,
} from './common';

type IssueLabelRef = {
  id?: string | null;
  key?: string | null;
  name?: string | null;
};

type IssueLabelLike = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  color?: string | null;
  isGroup?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  retiredAt?: string | null;
  team?: IssueLabelRef | null;
  parent?: IssueLabelRef | null;
};

type IssueLabelResultDetails = {
  label?: IssueLabelLike | null;
  labels?: IssueLabelLike[];
  success?: boolean;
};

const ISSUE_LABEL_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 90;
const DESCRIPTION_LIMIT = 180;
const TABLE_NAME_MIN_WIDTH = 24;

function issueLabelDetails(result: AgentToolResult<any>): IssueLabelResultDetails {
  return (result.details ?? {}) as IssueLabelResultDetails;
}

function argsObject(context: { args?: unknown }): ToolArgs {
  return context.args && typeof context.args === 'object' && !Array.isArray(context.args)
    ? (context.args as ToolArgs)
    : {};
}

function labelName(label: IssueLabelLike): string {
  return truncate(cleanOneLine(asString(label.name) ?? '(unnamed label)'), NAME_LIMIT);
}

function teamText(label: IssueLabelLike): string | undefined {
  const team = label.team;
  if (!team) return undefined;
  return asString(team.key) ?? asString(team.name) ?? asString(team.id);
}

function parentText(label: IssueLabelLike): string | undefined {
  const parent = label.parent;
  if (!parent) return undefined;
  return asString(parent.name) ?? asString(parent.id);
}

function groupText(label: IssueLabelLike): string {
  return label.isGroup === true ? 'yes' : '—';
}

function colorText(label: IssueLabelLike): string | undefined {
  return asString(label.color);
}

function flagParts(label: IssueLabelLike): string[] {
  return [
    label.isGroup === true ? 'group' : undefined,
    asString(label.retiredAt) ? 'retired' : undefined,
  ].filter((flag): flag is string => !!flag);
}

function descriptionSnippet(label: IssueLabelLike): string | undefined {
  const description = asString(label.description);
  if (!description) return undefined;
  return truncate(cleanOneLine(description), DESCRIPTION_LIMIT);
}

function metadataParts(
  label: IssueLabelLike,
  options: { includeDescription?: boolean } = {},
): string[] {
  const team = teamText(label);
  const parent = parentText(label);
  const flags = flagParts(label);
  const color = colorText(label);
  const description = options.includeDescription ? descriptionSnippet(label) : undefined;

  return [
    team ? `team: ${team}` : undefined,
    parent ? `parent: ${parent}` : undefined,
    flags.length ? flags.join(', ') : undefined,
    color ? `color: ${color}` : undefined,
    description,
  ].filter((part): part is string => !!part);
}

function formatIssueLabelListLine(label: IssueLabelLike, theme: Theme, width: number): string {
  const name = labelName(label);
  const metadata = metadataParts(label, { includeDescription: true });
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', name)}${suffix}`, width);
}

function formatIssueLabelTitle(label: IssueLabelLike, theme: Theme): string {
  const id = asString(label.id);
  const name = theme.fg('toolOutput', labelName(label));
  return id ? `${name} ${theme.fg('dim', `(${truncate(id, 8)})`)}` : name;
}

const ISSUE_LABEL_TABLE_COLUMNS: TableColumn<IssueLabelLike>[] = [
  {
    id: 'team',
    label: 'Team',
    width: 12,
    value: (label) => teamText(label) ?? '—',
    style: (theme, value) => (text) => theme.fg(value === '—' ? 'dim' : 'accent', text),
  },
  {
    id: 'parent',
    label: 'Parent',
    width: 18,
    value: (label) => parentText(label) ?? '—',
    style: (theme, value) => (text) => theme.fg(value === '—' ? 'dim' : 'muted', text),
  },
  {
    id: 'group',
    label: 'Group',
    width: 7,
    value: groupText,
    style: (theme, value) => (text) => theme.fg(value === 'yes' ? 'success' : 'dim', text),
  },
  {
    id: 'color',
    label: 'Color',
    width: 10,
    value: (label) => colorText(label) ?? '—',
    style: (theme, value) => (text) => theme.fg(value === '—' ? 'dim' : 'muted', text),
  },
];

function renderIssueLabelTable(labels: IssueLabelLike[], theme: Theme, width: number): string[] {
  return renderResponsiveTable(labels, theme, width, {
    columns: ISSUE_LABEL_TABLE_COLUMNS,
    primary: {
      label: 'Name',
      minWidth: TABLE_NAME_MIN_WIDTH,
      value: labelName,
      style: (theme) => (text) => theme.fg('toolOutput', text),
    },
    dropOrder: ['color', 'group', 'parent', 'team'],
    fallback: formatIssueLabelListLine,
  });
}

function renderIssueLabelCard(
  actionLabel: string,
  label: IssueLabelLike | null | undefined,
  theme: Theme,
): Text {
  if (!label) {
    return new Text(`\n${theme.fg('dim', 'Issue label not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const metadata = metadataParts(label);
  const description = descriptionSnippet(label);

  let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatIssueLabelTitle(label, theme)}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  if (description) text += `\n  ${theme.fg('muted', description)}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

export function renderLinearIssueLabelListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_issue_labels', args, theme, [
    ['teamKey', 'team'],
    ['teamId', 'teamId'],
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
    ['filter', 'filter'],
  ]);
}

export function renderLinearCreateIssueLabelCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_create_issue_label', args, theme, [
    ['id', 'id'],
    ['name', 'name'],
    ['teamKey', 'team'],
    ['teamId', 'teamId'],
    ['parentId', 'parentId'],
    ['color', 'color'],
    ['isGroup', 'group'],
  ]);
}

export function renderLinearUpdateIssueLabelCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_update_issue_label', args, theme, [
    ['id', 'id'],
    ['name', 'name'],
    ['parentId', 'parentId'],
    ['color', 'color'],
    ['isGroup', 'group'],
  ]);
}

export function renderLinearDeleteIssueLabelCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_delete_issue_label', args, theme, [['id', 'id']]);
}

export function renderLinearIssueLabelListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<IssueLabelLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading issue labels…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const labels = Array.isArray(issueLabelDetails(result).labels)
    ? (issueLabelDetails(result).labels as IssueLabelLike[])
    : [];

  return new LinearListResultComponent(labels, theme, {
    noun: 'label',
    pluralNoun: 'labels',
    emptyLabel: 'No issue labels found',
    previewLimit: ISSUE_LABEL_LIST_PREVIEW_LIMIT,
    renderItems: renderIssueLabelTable,
  });
}

export function renderLinearIssueLabelResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);

    return renderIssueLabelCard(actionLabel, issueLabelDetails(result).label, theme);
  };
}

export function renderLinearIssueLabelDeleteResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: { args?: unknown },
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Deleting issue label…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const details = issueLabelDetails(result);
  const args = argsObject(context);
  const id = asString(args.id) ?? 'issue label';

  if (details.success !== true) {
    return new Text(`\n${theme.fg('warning', 'Delete status unknown')}\n\n${jsonHint()}`, 0, 0);
  }

  return new Text(
    `\n${theme.fg('success', '✓ Deleted issue label')} ${theme.fg('accent', id)}\n\n${jsonHint()}`,
    0,
    0,
  );
}
