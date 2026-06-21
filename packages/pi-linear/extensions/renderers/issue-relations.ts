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
  renderLinearToolCall,
  renderResponsiveTable,
  toolOutputStyle,
  truncate,
  truncateLine,
  type LinearToolRenderContext,
  type TableColumn,
  type ToolArgs,
} from './common';

type NamedIssue = {
  id?: string;
  identifier?: string | null;
  title?: string | null;
};

type IssueRelationLike = {
  id?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  type?: string | null;
  issue?: NamedIssue | null;
  relatedIssue?: NamedIssue | null;
};

type IssueRelationResultDetails = {
  issueRelation?: IssueRelationLike | null;
  issueRelations?: IssueRelationLike[];
  success?: boolean;
};

const ISSUE_RELATION_LIST_PREVIEW_LIMIT = 20;
const ISSUE_TITLE_LIMIT = 54;
const TABLE_RELATION_MIN_WIDTH = 24;

function issueRelationDetails(result: AgentToolResult<any>): IssueRelationResultDetails {
  return (result.details ?? {}) as IssueRelationResultDetails;
}

function argsObject(context: { args?: unknown }): ToolArgs {
  return context.args && typeof context.args === 'object' && !Array.isArray(context.args)
    ? (context.args as ToolArgs)
    : {};
}

function dateText(value: unknown): string | undefined {
  const date = asString(value);
  if (!date) return undefined;

  const timeSeparator = date.indexOf('T');
  return timeSeparator >= 0 ? date.slice(0, timeSeparator) : date;
}

function issueRef(issue: NamedIssue | null | undefined): string | undefined {
  return asString(issue?.identifier) ?? asString(issue?.id);
}

function issueTitle(issue: NamedIssue | null | undefined): string | undefined {
  const title = asString(issue?.title);
  return title ? truncate(cleanOneLine(title), ISSUE_TITLE_LIMIT) : undefined;
}

function relationType(relation: IssueRelationLike): string {
  return asString(relation.type) ?? 'related';
}

function relationVerb(relation: IssueRelationLike): string {
  const type = relationType(relation).toLowerCase();
  if (type === 'blocks') return 'blocks';
  if (type === 'duplicate') return 'duplicates';
  if (type === 'related') return 'related to';
  if (type === 'similar') return 'similar to';
  return type.replace(/[_-]+/g, ' ');
}

function relationId(relation: IssueRelationLike): string | undefined {
  return asString(relation.id);
}

function relationSummary(relation: IssueRelationLike): string {
  const issue = issueRef(relation.issue);
  const relatedIssue = issueRef(relation.relatedIssue);
  if (issue && relatedIssue) return `${issue} ${relationVerb(relation)} ${relatedIssue}`;

  return (
    relationId(relation) ?? [issue, relationVerb(relation), relatedIssue].filter(Boolean).join(' ')
  );
}

function formatIssueWithTitle(issue: NamedIssue | null | undefined, theme: Theme): string {
  const ref = issueRef(issue);
  const title = issueTitle(issue);

  if (ref && title) return `${theme.fg('accent', ref)} ${theme.fg('toolOutput', title)}`;
  if (ref) return theme.fg('accent', ref);
  if (title) return theme.fg('toolOutput', title);
  return theme.fg('dim', 'unknown issue');
}

function formatRelationInline(relation: IssueRelationLike, theme: Theme): string {
  const issue = issueRef(relation.issue);
  const relatedIssue = issueRef(relation.relatedIssue);
  if (issue && relatedIssue) {
    return `${theme.fg('accent', issue)} ${theme.fg('toolOutput', relationVerb(relation))} ${theme.fg(
      'accent',
      relatedIssue,
    )}`;
  }

  return theme.fg('toolOutput', relationSummary(relation));
}

function formatRelationCardSummary(relation: IssueRelationLike, theme: Theme): string {
  const issue = issueRef(relation.issue) ?? issueTitle(relation.issue);
  const relatedIssue = issueRef(relation.relatedIssue) ?? issueTitle(relation.relatedIssue);
  if (!issue && !relatedIssue) return theme.fg('accent', relationId(relation) ?? 'issue relation');

  return `${formatIssueWithTitle(relation.issue, theme)} ${theme.fg(
    'toolOutput',
    relationVerb(relation),
  )} ${formatIssueWithTitle(relation.relatedIssue, theme)}`;
}

function listMetadataParts(relation: IssueRelationLike): string[] {
  const updated = dateText(relation.updatedAt);
  const id = relationId(relation);

  return [updated ? `updated: ${updated}` : undefined, id ? `id: ${id}` : undefined].filter(
    (part): part is string => !!part,
  );
}

function cardMetadataParts(relation: IssueRelationLike): string[] {
  const updated = dateText(relation.updatedAt);
  const created = dateText(relation.createdAt);
  const id = relationId(relation);

  return [
    updated ? `updated: ${updated}` : undefined,
    created ? `created: ${created}` : undefined,
    id ? `id: ${id}` : undefined,
  ].filter((part): part is string => !!part);
}

function formatIssueRelationListLine(
  relation: IssueRelationLike,
  theme: Theme,
  width: number,
): string {
  const metadata = listMetadataParts(relation);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${formatRelationInline(relation, theme)}${suffix}`, width);
}

const ISSUE_RELATION_TABLE_COLUMNS: TableColumn<IssueRelationLike>[] = [
  {
    id: 'updated',
    label: 'Updated',
    width: 10,
    value: (relation) => dateText(relation.updatedAt) ?? '—',
    style: (theme) => dimStyle(theme),
  },
];

function renderIssueRelationTable(
  issueRelations: IssueRelationLike[],
  theme: Theme,
  width: number,
): string[] {
  return renderResponsiveTable(issueRelations, theme, width, {
    columns: ISSUE_RELATION_TABLE_COLUMNS,
    primary: {
      label: 'Relation',
      minWidth: TABLE_RELATION_MIN_WIDTH,
      value: relationSummary,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['updated'],
    fallback: formatIssueRelationListLine,
  });
}

function renderIssueRelationCard(
  actionLabel: string,
  relation: IssueRelationLike | null | undefined,
  theme: Theme,
): Text {
  if (!relation) {
    return new Text(`\n${theme.fg('dim', 'Issue relation not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const metadata = cardMetadataParts(relation);
  let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatRelationCardSummary(
    relation,
    theme,
  )}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

export function renderLinearIssueRelationListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_issue_relations', args, theme, [
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
  ]);
}

export function renderLinearCreateIssueRelationCall(
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall('linear_create_issue_relation', args, theme, [
    ['issueId', 'issueId'],
    ['relatedIssueId', 'relatedIssueId'],
    ['type', 'type'],
  ]);
}

export function renderLinearUpdateIssueRelationCall(
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall('linear_update_issue_relation', args, theme, [
    ['id', 'id'],
    ['issueId', 'issueId'],
    ['relatedIssueId', 'relatedIssueId'],
    ['type', 'type'],
  ]);
}

export function renderLinearDeleteIssueRelationCall(
  args: ToolArgs | undefined,
  theme: Theme,
): Text {
  return renderLinearToolCall('linear_delete_issue_relation', args, theme, [['id', 'id']]);
}

export function renderLinearIssueRelationListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<IssueRelationLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading issue relations…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const issueRelations = Array.isArray(issueRelationDetails(result).issueRelations)
    ? (issueRelationDetails(result).issueRelations as IssueRelationLike[])
    : [];

  return new LinearListResultComponent(issueRelations, theme, {
    noun: 'issue relation',
    emptyLabel: 'No issue relations found',
    previewLimit: ISSUE_RELATION_LIST_PREVIEW_LIMIT,
    renderItems: renderIssueRelationTable,
  });
}

export function renderLinearIssueRelationResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);

    return renderIssueRelationCard(actionLabel, issueRelationDetails(result).issueRelation, theme);
  };
}

export function renderLinearDeleteIssueRelationResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: { args?: unknown },
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Deleting issue relation…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const details = issueRelationDetails(result);
  const args = argsObject(context);
  const id = asString(args.id) ?? 'issue relation';

  if (details.success !== true) {
    return new Text(
      `\n${theme.fg('warning', 'Deleted issue relation status unknown')}\n\n${jsonHint()}`,
      0,
      0,
    );
  }

  return new Text(
    `\n${theme.fg('success', '✓ Deleted issue relation')} ${theme.fg('accent', id)}\n\n${jsonHint()}`,
    0,
    0,
  );
}
