import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';
import type { LinearIssue } from '../types';
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

type IssueLike = LinearIssue & {
  archivedAt?: string | null;
  completedAt?: string | null;
  estimate?: number | null;
  labels?: { nodes?: Array<{ id?: string; name?: string | null }> } | null;
  priorityLabel?: string | null;
  project?: { id?: string; name?: string | null } | null;
  startedAt?: string | null;
  trashed?: boolean | null;
};

type IssueResultDetails = {
  issue?: LinearIssue | null;
  issues?: LinearIssue[];
  success?: boolean;
};

const ISSUE_LIST_PREVIEW_LIMIT = 20;
const TITLE_LIMIT = 90;
const DESCRIPTION_LIMIT = 180;
const TABLE_TITLE_MIN_WIDTH = 24;

function issueDetails(result: AgentToolResult<any>): IssueResultDetails {
  return (result.details ?? {}) as IssueResultDetails;
}

function issueId(issue: IssueLike): string {
  return asString(issue.identifier) ?? asString(issue.id) ?? 'issue';
}

function issueTitle(issue: IssueLike): string {
  return truncate(cleanOneLine(asString(issue.title) ?? '(untitled)'), TITLE_LIMIT);
}

function priorityText(issue: IssueLike): string | undefined {
  const label = asString(issue.priorityLabel);
  if (label) return label;
  if (typeof issue.priority !== 'number' || issue.priority <= 0) return undefined;
  return `P${issue.priority}`;
}

function labelNames(issue: IssueLike): string[] {
  const nodes = Array.isArray(issue.labels?.nodes) ? issue.labels.nodes : [];
  return nodes.map((label) => asString(label.name)).filter((label): label is string => !!label);
}

function labelText(issue: IssueLike, limit = 3): string | undefined {
  const labels = labelNames(issue);
  if (labels.length === 0) return undefined;

  const shown = labels.slice(0, limit).join(', ');
  const hiddenCount = labels.length - limit;
  return hiddenCount > 0 ? `${shown}, +${hiddenCount}` : shown;
}

function allLabelText(issue: IssueLike): string {
  return labelNames(issue).join(', ') || '—';
}

function metadataParts(
  issue: IssueLike,
  options: { includeProject?: boolean; includeDueDate?: boolean } = {},
) {
  const state = asString(issue.state?.name);
  const priority = priorityText(issue);
  const assignee = asString(issue.assignee?.name);
  const labels = labelText(issue);
  const project = options.includeProject ? asString(issue.project?.name) : undefined;
  const dueDate = options.includeDueDate ? asString(issue.dueDate) : undefined;

  return [
    state,
    priority,
    assignee ? `@${assignee}` : undefined,
    labels,
    project ? `project: ${project}` : undefined,
    dueDate ? `due ${dueDate}` : undefined,
  ].filter((part): part is string => !!part);
}

function formatIssueListLine(issue: IssueLike, theme: Theme, width: number): string {
  const id = issueId(issue).padEnd(9);
  const title = issueTitle(issue);
  const metadata = metadataParts(issue);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(
    `  ${theme.fg('accent', id)} ${theme.fg('toolOutput', title)}${suffix}`,
    width,
  );
}

function formatIssueTitle(issue: IssueLike, theme: Theme): string {
  return `${theme.fg('accent', issueId(issue))} ${theme.fg('toolOutput', issueTitle(issue))}`;
}

function descriptionSnippet(issue: IssueLike): string | undefined {
  const description = asString(issue.description);
  if (!description) return undefined;
  return truncate(cleanOneLine(description), DESCRIPTION_LIMIT);
}

function priorityStyle(theme: Theme, value: string): (text: string) => string {
  const normalized = value.toLowerCase();
  if (normalized === 'urgent') return (text) => theme.fg('error', text);
  if (normalized === 'high') return (text) => theme.fg('warning', text);
  if (normalized === 'low' || normalized === 'no priority' || value === '—') {
    return dimStyle(theme);
  }
  return mutedStyle(theme);
}

function statusStyle(theme: Theme, value: string): (text: string) => string {
  const normalized = value.toLowerCase();
  if (normalized === 'done' || normalized === 'completed')
    return (text) => theme.fg('success', text);
  if (normalized === 'backlog' || value === '—') return dimStyle(theme);
  return mutedStyle(theme);
}

const ISSUE_TABLE_COLUMNS: TableColumn<IssueLike>[] = [
  {
    id: 'id',
    label: 'ID',
    width: 8,
    value: issueId,
    style: (theme) => accentStyle(theme),
  },
  {
    id: 'state',
    label: 'Status',
    width: 12,
    value: (issue) => asString(issue.state?.name) ?? '—',
    style: statusStyle,
  },
  {
    id: 'priority',
    label: 'Priority',
    width: 11,
    value: (issue) => priorityText(issue) ?? '—',
    style: priorityStyle,
  },
  {
    id: 'assignee',
    label: 'Assignee',
    width: 16,
    value: (issue) => asString(issue.assignee?.name) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'labels',
    label: 'Labels',
    width: 24,
    value: allLabelText,
    style: (theme) => dimStyle(theme),
  },
];

function renderIssueTable(issues: IssueLike[], theme: Theme, width: number): string[] {
  return renderResponsiveTable(issues, theme, width, {
    columns: ISSUE_TABLE_COLUMNS,
    primary: {
      label: 'Title',
      minWidth: TABLE_TITLE_MIN_WIDTH,
      value: issueTitle,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['labels', 'assignee', 'priority', 'state'],
    fallback: formatIssueListLine,
  });
}

export function renderLinearIssueListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_issues', args, theme, [
    ['query', 'query'],
    ['teamKey', 'team'],
    ['teamId', 'teamId'],
    ['stateName', 'state'],
    ['assigneeId', 'assignee'],
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
    ['filter', 'filter'],
    ['sort', 'sort'],
  ]);
}

export function renderLinearIssueSearchCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_search_issues', args, theme, [
    ['term', 'search'],
    ['includeComments', 'comments'],
    ['teamId', 'teamId'],
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
    ['filter', 'filter'],
  ]);
}

export function renderLinearGetIssueCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_get_issue', args, theme, [['issue', 'issue']]);
}

export function renderLinearCreateIssueCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_create_issue', args, theme, [
    ['title', 'title'],
    ['teamKey', 'team'],
    ['teamId', 'teamId'],
    ['stateId', 'state'],
    ['assigneeId', 'assignee'],
    ['priority', 'priority'],
    ['labelIds', 'labels'],
    ['projectId', 'projectId'],
    ['parentId', 'parentId'],
    ['dueDate', 'due'],
    ['input', 'input'],
  ]);
}

export function renderLinearUpdateIssueCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_update_issue', args, theme, [
    ['issue', 'issue'],
    ['title', 'title'],
    ['stateId', 'state'],
    ['assigneeId', 'assignee'],
    ['priority', 'priority'],
    ['dueDate', 'due'],
    ['clearDueDate', 'clearDue'],
    ['labelIds', 'labels'],
    ['addedLabelIds', 'addLabels'],
    ['removedLabelIds', 'removeLabels'],
    ['projectId', 'projectId'],
    ['parentId', 'parentId'],
    ['input', 'input'],
  ]);
}

export function renderLinearDeleteIssueCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_delete_issue', args, theme, [
    ['issue', 'issue'],
    ['permanentlyDelete', 'permanent'],
  ]);
}

export function renderLinearArchiveIssueCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_archive_issue', args, theme, [
    ['issue', 'issue'],
    ['trash', 'trash'],
  ]);
}

export function renderLinearUnarchiveIssueCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_unarchive_issue', args, theme, [['issue', 'issue']]);
}

export function renderLinearIssueListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<IssueLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading issues…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const issues = Array.isArray(issueDetails(result).issues)
    ? (issueDetails(result).issues as IssueLike[])
    : [];

  return new LinearListResultComponent(issues, theme, {
    noun: 'issue',
    emptyLabel: 'No issues found',
    previewLimit: ISSUE_LIST_PREVIEW_LIMIT,
    renderItems: renderIssueTable,
  });
}

export function renderLinearIssueResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);

    const issue = issueDetails(result).issue as IssueLike | null | undefined;
    if (!issue) {
      return new Text(`\n${theme.fg('dim', 'Issue not found')}\n\n${jsonHint()}`, 0, 0);
    }

    const metadata = metadataParts(issue, { includeProject: true, includeDueDate: true });
    const description = descriptionSnippet(issue);

    let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatIssueTitle(issue, theme)}`;
    if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
    if (description) text += `\n  ${theme.fg('muted', description)}`;
    if (issue.url) text += `\n  ${theme.fg('dim', issue.url)}`;
    text += `\n\n${jsonHint()}`;

    return new Text(text, 0, 0);
  };
}

export function renderLinearIssueSuccessResult(defaultActionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: { args?: unknown },
  ): Text => {
    if (options.isPartial)
      return new Text(theme.fg('warning', `${defaultActionLabel} issue…`), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);

    const details = issueDetails(result);
    const args = (context.args ?? {}) as {
      issue?: unknown;
      permanentlyDelete?: unknown;
      trash?: unknown;
    };
    const issue = asString(args.issue) ?? 'issue';
    const actionLabel =
      defaultActionLabel === 'Deleted' && args.permanentlyDelete === true
        ? 'Permanently deleted'
        : defaultActionLabel === 'Archived' && args.trash === true
          ? 'Trashed'
          : defaultActionLabel;

    if (details.success !== true) {
      return new Text(
        `\n${theme.fg('warning', `${actionLabel} status unknown`)}\n\n${jsonHint()}`,
        0,
        0,
      );
    }

    return new Text(
      `\n${theme.fg('success', `✓ ${actionLabel}`)} ${theme.fg('accent', issue)}\n\n${jsonHint()}`,
      0,
      0,
    );
  };
}
