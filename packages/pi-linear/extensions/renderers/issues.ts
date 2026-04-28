import {
  keyHint,
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@mariozechner/pi-coding-agent';
import { Text, truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';
import type { LinearIssue } from '../types';

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

type IssueToolArgs = Record<string, unknown>;

type ColumnSpec = {
  id: string;
  label: string;
  width: number;
  value: (issue: IssueLike) => string;
  style: (theme: Theme, value: string) => (text: string) => string;
};

const ISSUE_LIST_PREVIEW_LIMIT = 20;
const TITLE_LIMIT = 90;
const DESCRIPTION_LIMIT = 180;
const TABLE_TITLE_MIN_WIDTH = 24;
const TABLE_SEPARATOR = '  ';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanOneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function issueDetails(result: AgentToolResult<any>): IssueResultDetails {
  return (result.details ?? {}) as IssueResultDetails;
}

function textContent(result: AgentToolResult<any>): string {
  const textBlock = result.content.find((block) => block.type === 'text');
  if (textBlock?.type === 'text' && textBlock.text) return textBlock.text;
  return JSON.stringify(result.details ?? null, null, 2);
}

function expandedJson(result: AgentToolResult<any>, theme: Theme): Text {
  const text = `\n${theme.fg('muted', 'Full JSON response')}\n${textContent(result)}\n\n${keyHint(
    'app.tools.expand',
    'show summary',
  )}`;
  return new Text(text, 0, 0);
}

function jsonHint(): string {
  return `(${keyHint('app.tools.expand', 'show full JSON')})`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
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

  return truncateToWidth(
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
    return (text) => theme.fg('dim', text);
  }
  return (text) => theme.fg('muted', text);
}

function statusStyle(theme: Theme, value: string): (text: string) => string {
  const normalized = value.toLowerCase();
  if (normalized === 'done' || normalized === 'completed')
    return (text) => theme.fg('success', text);
  if (normalized === 'backlog' || value === '—') return (text) => theme.fg('dim', text);
  return (text) => theme.fg('muted', text);
}

function plainStyle(theme: Theme): (text: string) => string {
  return (text) => theme.fg('muted', text);
}

function dimStyle(theme: Theme): (text: string) => string {
  return (text) => theme.fg('dim', text);
}

function accentStyle(theme: Theme): (text: string) => string {
  return (text) => theme.fg('accent', text);
}

const ISSUE_TABLE_COLUMNS: ColumnSpec[] = [
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
    style: (theme) => plainStyle(theme),
  },
  {
    id: 'labels',
    label: 'Labels',
    width: 24,
    value: allLabelText,
    style: (theme) => dimStyle(theme),
  },
];

function formatCell(rawValue: string, width: number, style: (text: string) => string): string {
  const cleanValue = cleanOneLine(rawValue || '—');
  const truncated = truncateToWidth(cleanValue, width);
  const padding = ' '.repeat(Math.max(0, width - visibleWidth(truncated)));
  return `${style(truncated)}${padding}`;
}

function fitTableLayout(width: number): { columns: ColumnSpec[]; titleWidth: number } | undefined {
  if (width < 28) return undefined;

  const dropOrder = ['labels', 'assignee', 'priority', 'state'];
  let columns = [...ISSUE_TABLE_COLUMNS];

  const titleWidthFor = (candidateColumns: ColumnSpec[]) => {
    const separatorWidth = TABLE_SEPARATOR.length * candidateColumns.length;
    const fixedWidth = candidateColumns.reduce((sum, column) => sum + column.width, 0);
    return width - fixedWidth - separatorWidth;
  };

  let titleWidth = titleWidthFor(columns);
  for (const columnToDrop of dropOrder) {
    if (titleWidth >= TABLE_TITLE_MIN_WIDTH) break;
    columns = columns.filter((column) => column.id !== columnToDrop);
    titleWidth = titleWidthFor(columns);
  }

  if (titleWidth < 10) return undefined;
  return { columns, titleWidth };
}

function tableLine(cells: string[], width: number): string {
  return truncateToWidth(cells.join(TABLE_SEPARATOR), width);
}

function renderIssueTable(issues: IssueLike[], theme: Theme, width: number): string[] {
  const layout = fitTableLayout(width);
  if (!layout) {
    return issues.map((issue) => formatIssueListLine(issue, theme, width));
  }

  const headerCells = [
    ...layout.columns.map((column) =>
      formatCell(column.label, column.width, (text) => theme.fg('dim', text)),
    ),
    formatCell('Title', layout.titleWidth, (text) => theme.fg('dim', text)),
  ];

  const lines = [tableLine(headerCells, width)];
  for (const issue of issues) {
    const cells = [
      ...layout.columns.map((column) =>
        formatCell(column.value(issue), column.width, column.style(theme, column.value(issue))),
      ),
      formatCell(issueTitle(issue), layout.titleWidth, (text) => theme.fg('toolOutput', text)),
    ];
    lines.push(tableLine(cells, width));
  }

  return lines;
}

class IssueListResultComponent {
  constructor(
    private readonly issues: IssueLike[],
    private readonly theme: Theme,
  ) {}

  render(width: number): string[] {
    const lines: string[] = [''];

    if (this.issues.length === 0) {
      lines.push(this.theme.fg('dim', 'No issues found'));
      lines.push('');
      lines.push(jsonHint());
      return lines.map((line) => truncateToWidth(line, width));
    }

    const shown = this.issues.slice(0, ISSUE_LIST_PREVIEW_LIMIT);
    lines.push(this.theme.fg('success', `✓ ${plural(this.issues.length, 'issue')} returned`));
    lines.push('');
    lines.push(...renderIssueTable(shown, this.theme, width));

    if (shown.length < this.issues.length) {
      lines.push(
        this.theme.fg('dim', `… ${plural(this.issues.length - shown.length, 'more issue')}`),
      );
    }

    lines.push('');
    lines.push(jsonHint());

    return lines.map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {}
}

function formatToolArgValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.includes(' ') ? `"${truncate(trimmed, 48)}"` : truncate(trimmed, 48);
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : undefined;
  if (Array.isArray(value)) return value.length ? `[${value.length}]` : undefined;
  if (value && typeof value === 'object') return '{…}';
  return undefined;
}

function renderIssueToolCall(
  toolName: string,
  args: IssueToolArgs | undefined,
  theme: Theme,
  fields: Array<[keyof IssueToolArgs & string, string]>,
): Text {
  let text = theme.fg('toolTitle', theme.bold(toolName));
  const parts = fields
    .map(([key, label]) => {
      const value = formatToolArgValue(args?.[key]);
      return value ? `${label}=${value}` : undefined;
    })
    .filter((part): part is string => !!part);

  if (parts.length) {
    text += ` ${theme.fg('dim', parts.join('  '))}`;
  }

  return new Text(text, 0, 0);
}

export function renderLinearIssueListCall(args: IssueToolArgs | undefined, theme: Theme): Text {
  return renderIssueToolCall('linear_list_issues', args, theme, [
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

export function renderLinearIssueSearchCall(args: IssueToolArgs | undefined, theme: Theme): Text {
  return renderIssueToolCall('linear_search_issues', args, theme, [
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

export function renderLinearIssueListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
): Text | IssueListResultComponent {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading issues…'), 0, 0);
  if (options.expanded) return expandedJson(result, theme);

  const issues = Array.isArray(issueDetails(result).issues)
    ? (issueDetails(result).issues as IssueLike[])
    : [];

  return new IssueListResultComponent(issues, theme);
}

export function renderLinearIssueResult(actionLabel: string) {
  return (result: AgentToolResult<any>, options: ToolRenderResultOptions, theme: Theme): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
    if (options.expanded) return expandedJson(result, theme);

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
    if (options.expanded) return expandedJson(result, theme);

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
