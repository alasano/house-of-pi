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

type NamedRef = {
  id?: string;
  identifier?: string | null;
  title?: string | null;
};

type CommentUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
};

type CommentLike = {
  id?: string;
  body?: string | null;
  quotedText?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  editedAt?: string | null;
  resolvedAt?: string | null;
  url?: string | null;
  issue?: NamedRef | null;
  parent?: { id?: string | null } | null;
  user?: CommentUser | null;
};

type CommentResultDetails = {
  comment?: CommentLike | null;
  comments?: CommentLike[];
  success?: boolean;
};

const COMMENT_LIST_PREVIEW_LIMIT = 20;
const BODY_LIMIT = 180;
const QUOTED_LIMIT = 90;
const ISSUE_TITLE_LIMIT = 80;
const TABLE_BODY_MIN_WIDTH = 24;

function commentDetails(result: AgentToolResult<any>): CommentResultDetails {
  return (result.details ?? {}) as CommentResultDetails;
}

function argsObject(context: { args?: unknown }): ToolArgs {
  return context.args && typeof context.args === 'object' && !Array.isArray(context.args)
    ? (context.args as ToolArgs)
    : {};
}

function dateText(value: unknown): string | undefined {
  const date = asString(value);
  if (!date) return undefined;
  const [datePart] = date.split('T');
  return datePart || date;
}

function issueIdentifier(comment: CommentLike): string | undefined {
  return asString(comment.issue?.identifier) ?? asString(comment.issue?.id);
}

function issueTitle(comment: CommentLike): string | undefined {
  const title = asString(comment.issue?.title);
  return title ? truncate(cleanOneLine(title), ISSUE_TITLE_LIMIT) : undefined;
}

function issueText(comment: CommentLike): string | undefined {
  const identifier = issueIdentifier(comment);
  const title = issueTitle(comment);
  if (identifier && title) return `${identifier} ${title}`;
  return identifier ?? title;
}

function formatIssueText(comment: CommentLike, theme: Theme): string {
  const identifier = issueIdentifier(comment);
  const title = issueTitle(comment);
  if (identifier && title)
    return `${theme.fg('accent', identifier)} ${theme.fg('toolOutput', title)}`;
  if (identifier) return theme.fg('accent', identifier);
  if (title) return theme.fg('toolOutput', title);
  return theme.fg('dim', 'No issue');
}

function authorText(comment: CommentLike): string | undefined {
  return (
    asString(comment.user?.name) ?? asString(comment.user?.email) ?? asString(comment.user?.id)
  );
}

function bodySnippet(comment: CommentLike, limit = BODY_LIMIT): string | undefined {
  const body = asString(comment.body);
  if (!body) return undefined;
  return truncate(cleanOneLine(body), limit);
}

function quotedSnippet(comment: CommentLike, limit = QUOTED_LIMIT): string | undefined {
  const quoted = asString(comment.quotedText);
  if (!quoted) return undefined;
  return truncate(cleanOneLine(quoted), limit);
}

function bodyPreview(comment: CommentLike): string {
  const body = bodySnippet(comment);
  const quoted = quotedSnippet(comment);

  if (body && quoted && body !== quoted) return truncate(`${body} — quoted: ${quoted}`, BODY_LIMIT);
  return body ?? (quoted ? `quoted: ${quoted}` : '(empty comment)');
}

function listMetadataParts(comment: CommentLike): string[] {
  const issue = issueText(comment);
  const author = authorText(comment);
  const updated = dateText(comment.updatedAt);

  return [
    issue ? `issue: ${issue}` : undefined,
    author ? `author: ${author}` : undefined,
    updated ? `updated: ${updated}` : undefined,
  ].filter((part): part is string => !!part);
}

function cardMetadataParts(comment: CommentLike): string[] {
  const author = authorText(comment);
  const updated = dateText(comment.updatedAt);
  const edited = dateText(comment.editedAt);
  const resolved = dateText(comment.resolvedAt);

  return [
    author ? `author: ${author}` : undefined,
    updated ? `updated: ${updated}` : undefined,
    edited ? `edited: ${edited}` : undefined,
    resolved ? `resolved: ${resolved}` : undefined,
  ].filter((part): part is string => !!part);
}

function formatCommentListLine(comment: CommentLike, theme: Theme, width: number): string {
  const body = bodyPreview(comment);
  const metadata = listMetadataParts(comment);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', body)}${suffix}`, width);
}

const COMMENT_TABLE_COLUMNS: TableColumn<CommentLike>[] = [
  {
    id: 'issue',
    label: 'Issue',
    width: 16,
    value: (comment) => issueText(comment) ?? '—',
    style: (theme) => accentStyle(theme),
  },
  {
    id: 'author',
    label: 'Author',
    width: 18,
    value: (comment) => authorText(comment) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'updated',
    label: 'Updated',
    width: 10,
    value: (comment) => dateText(comment.updatedAt) ?? '—',
    style: (theme) => dimStyle(theme),
  },
];

function renderCommentTable(comments: CommentLike[], theme: Theme, width: number): string[] {
  return renderResponsiveTable(comments, theme, width, {
    columns: COMMENT_TABLE_COLUMNS,
    primary: {
      label: 'Body',
      minWidth: TABLE_BODY_MIN_WIDTH,
      value: bodyPreview,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['updated', 'author', 'issue'],
    fallback: formatCommentListLine,
  });
}

function renderCommentCard(
  actionLabel: string,
  comment: CommentLike | null | undefined,
  theme: Theme,
): Text {
  if (!comment) {
    return new Text(`\n${theme.fg('dim', 'Comment not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const metadata = cardMetadataParts(comment);
  const quoted = quotedSnippet(comment);
  const body = bodySnippet(comment);
  const url = asString(comment.url);

  let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatIssueText(comment, theme)}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  if (quoted) text += `\n  ${theme.fg('dim', `quoted: ${quoted}`)}`;
  if (body) text += `\n  ${theme.fg('muted', body)}`;
  if (url) text += `\n  ${theme.fg('dim', url)}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

export function renderLinearCommentListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_comments', args, theme, [
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
    ['filter', 'filter'],
  ]);
}

export function renderLinearCreateCommentCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_create_comment', args, theme, [
    ['id', 'id'],
    ['body', 'body'],
    ['issueId', 'issueId'],
    ['parentId', 'parentId'],
    ['quotedText', 'quote'],
  ]);
}

export function renderLinearUpdateCommentCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_update_comment', args, theme, [
    ['id', 'id'],
    ['body', 'body'],
    ['quotedText', 'quote'],
  ]);
}

export function renderLinearDeleteCommentCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_delete_comment', args, theme, [['id', 'id']]);
}

export function renderLinearCommentListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
): Text | LinearListResultComponent<CommentLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading comments…'), 0, 0);
  if (options.expanded) return expandedJson(result, theme);

  const comments = Array.isArray(commentDetails(result).comments)
    ? (commentDetails(result).comments as CommentLike[])
    : [];

  return new LinearListResultComponent(comments, theme, {
    noun: 'comment',
    emptyLabel: 'No comments found',
    previewLimit: COMMENT_LIST_PREVIEW_LIMIT,
    renderItems: renderCommentTable,
  });
}

export function renderLinearCommentResult(actionLabel: string) {
  return (result: AgentToolResult<any>, options: ToolRenderResultOptions, theme: Theme): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
    if (options.expanded) return expandedJson(result, theme);

    return renderCommentCard(actionLabel, commentDetails(result).comment, theme);
  };
}

export function renderLinearDeleteCommentResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: { args?: unknown },
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Deleting comment…'), 0, 0);
  if (options.expanded) return expandedJson(result, theme);

  const details = commentDetails(result);
  const args = argsObject(context);
  const id = asString(args.id) ?? 'comment';

  if (details.success !== true) {
    return new Text(
      `\n${theme.fg('warning', 'Deleted comment status unknown')}\n\n${jsonHint()}`,
      0,
      0,
    );
  }

  return new Text(
    `\n${theme.fg('success', '✓ Deleted comment')} ${theme.fg('accent', id)}\n\n${jsonHint()}`,
    0,
    0,
  );
}
