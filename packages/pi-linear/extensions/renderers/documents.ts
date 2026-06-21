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

type NamedRef = {
  id?: string;
  identifier?: string | null;
  key?: string | null;
  name?: string | null;
  title?: string | null;
};

type DocumentLike = {
  id?: string;
  title?: string | null;
  content?: string | null;
  summary?: string | null;
  hiddenAt?: string | null;
  archivedAt?: string | null;
  trashed?: boolean | null;
  updatedAt?: string | null;
  url?: string | null;
  team?: NamedRef | null;
  project?: NamedRef | null;
  issue?: NamedRef | null;
  initiative?: NamedRef | null;
};

type DocumentResultDetails = {
  document?: DocumentLike | null;
  documents?: DocumentLike[];
  success?: boolean;
};

const DOCUMENT_LIST_PREVIEW_LIMIT = 20;
const TITLE_LIMIT = 90;
const SNIPPET_LIMIT = 180;
const TABLE_TITLE_MIN_WIDTH = 24;

function documentDetails(result: AgentToolResult<any>): DocumentResultDetails {
  return (result.details ?? {}) as DocumentResultDetails;
}

function documentTitle(document: DocumentLike): string {
  return truncate(cleanOneLine(asString(document.title) ?? '(untitled)'), TITLE_LIMIT);
}

function contextText(document: DocumentLike): string | undefined {
  const issue = document.issue;
  if (issue) {
    return asString(issue.identifier) ?? asString(issue.title) ?? asString(issue.id);
  }

  const project = document.project;
  if (project) return asString(project.name) ?? asString(project.id);

  const initiative = document.initiative;
  if (initiative) return asString(initiative.name) ?? asString(initiative.id);

  return undefined;
}

function teamText(document: DocumentLike): string | undefined {
  const team = document.team;
  if (!team) return undefined;
  return asString(team.key) ?? asString(team.name) ?? asString(team.id);
}

function dateText(value: unknown): string | undefined {
  const date = asString(value);
  if (!date) return undefined;
  return date.includes('T') ? date.split('T')[0] : date;
}

function documentFlags(document: DocumentLike): string[] {
  return [
    asString(document.hiddenAt) ? 'hidden' : undefined,
    asString(document.archivedAt) ? 'archived' : undefined,
    document.trashed === true ? 'trashed' : undefined,
  ].filter((flag): flag is string => !!flag);
}

function flagsText(document: DocumentLike): string {
  return documentFlags(document).join(', ') || '—';
}

function documentSnippet(document: DocumentLike): string | undefined {
  const summary = asString(document.summary);
  if (summary) return truncate(cleanOneLine(summary), SNIPPET_LIMIT);

  const content = asString(document.content);
  if (content) return truncate(cleanOneLine(content), SNIPPET_LIMIT);

  return undefined;
}

function formatDocumentTitle(document: DocumentLike, theme: Theme): string {
  return theme.fg('toolOutput', documentTitle(document));
}

function metadataParts(document: DocumentLike): string[] {
  const context = contextText(document);
  const team = teamText(document);
  const updated = dateText(document.updatedAt);
  const flags = flagsText(document);

  return [
    context ? `context: ${context}` : undefined,
    team ? `team: ${team}` : undefined,
    updated ? `updated: ${updated}` : undefined,
    flags !== '—' ? flags : undefined,
  ].filter((part): part is string => !!part);
}

function formatDocumentListLine(document: DocumentLike, theme: Theme, width: number): string {
  const title = documentTitle(document);
  const metadata = metadataParts(document);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', title)}${suffix}`, width);
}

function flagsStyle(theme: Theme, value: string): (text: string) => string {
  if (value === '—') return dimStyle(theme);
  return (text) => theme.fg('warning', text);
}

const DOCUMENT_TABLE_COLUMNS: TableColumn<DocumentLike>[] = [
  {
    id: 'context',
    label: 'Context',
    width: 18,
    value: (document) => contextText(document) ?? '—',
    style: (theme) => accentStyle(theme),
  },
  {
    id: 'team',
    label: 'Team',
    width: 12,
    value: (document) => teamText(document) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'updated',
    label: 'Updated',
    width: 10,
    value: (document) => dateText(document.updatedAt) ?? '—',
    style: (theme) => dimStyle(theme),
  },
  {
    id: 'flags',
    label: 'Flags',
    width: 18,
    value: flagsText,
    style: flagsStyle,
  },
];

function renderDocumentTable(documents: DocumentLike[], theme: Theme, width: number): string[] {
  return renderResponsiveTable(documents, theme, width, {
    columns: DOCUMENT_TABLE_COLUMNS,
    primary: {
      label: 'Title',
      minWidth: TABLE_TITLE_MIN_WIDTH,
      value: documentTitle,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['flags', 'updated', 'team', 'context'],
    fallback: formatDocumentListLine,
  });
}

export function renderLinearDocumentListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_documents', args, theme, [
    ['first', 'first'],
    ['last', 'last'],
    ['orderBy', 'order'],
    ['includeArchived', 'archived'],
    ['filter', 'filter'],
  ]);
}

export function renderLinearGetDocumentCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_get_document', args, theme, [['documentId', 'documentId']]);
}

export function renderLinearCreateDocumentCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_create_document', args, theme, [
    ['title', 'title'],
    ['teamKey', 'team'],
    ['teamId', 'teamId'],
    ['projectId', 'projectId'],
    ['issueId', 'issueId'],
    ['initiativeId', 'initiativeId'],
  ]);
}

export function renderLinearUpdateDocumentCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_update_document', args, theme, [
    ['documentId', 'documentId'],
    ['title', 'title'],
    ['teamKey', 'team'],
    ['teamId', 'teamId'],
    ['projectId', 'projectId'],
    ['issueId', 'issueId'],
    ['initiativeId', 'initiativeId'],
  ]);
}

export function renderLinearDeleteDocumentCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_delete_document', args, theme, [
    ['documentId', 'documentId'],
  ]);
}

export function renderLinearUnarchiveDocumentCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_unarchive_document', args, theme, [
    ['documentId', 'documentId'],
  ]);
}

export function renderLinearDocumentListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<DocumentLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading documents…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const documents = Array.isArray(documentDetails(result).documents)
    ? (documentDetails(result).documents as DocumentLike[])
    : [];

  return new LinearListResultComponent(documents, theme, {
    noun: 'document',
    emptyLabel: 'No documents found',
    previewLimit: DOCUMENT_LIST_PREVIEW_LIMIT,
    renderItems: renderDocumentTable,
  });
}

export function renderLinearDocumentResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);

    const document = documentDetails(result).document;
    if (!document) {
      return new Text(`\n${theme.fg('dim', 'Document not found')}\n\n${jsonHint()}`, 0, 0);
    }

    const metadata = metadataParts(document);
    const snippet = documentSnippet(document);
    const url = asString(document.url);

    let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatDocumentTitle(document, theme)}`;
    if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
    if (url) text += `\n  ${theme.fg('dim', url)}`;
    if (snippet) text += `\n  ${theme.fg('muted', snippet)}`;
    text += `\n\n${jsonHint()}`;

    return new Text(text, 0, 0);
  };
}

export function renderLinearDocumentSuccessResult(defaultActionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: { args?: unknown },
  ): Text => {
    if (options.isPartial)
      return new Text(theme.fg('warning', `${defaultActionLabel} document…`), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);

    const details = documentDetails(result);
    const args = (context.args ?? {}) as ToolArgs;
    const documentId = asString(args.documentId) ?? 'document';

    if (details.success !== true) {
      return new Text(
        `\n${theme.fg('warning', `${defaultActionLabel} status unknown`)}\n\n${jsonHint()}`,
        0,
        0,
      );
    }

    return new Text(
      `\n${theme.fg('success', `✓ ${defaultActionLabel}`)} ${theme.fg(
        'accent',
        documentId,
      )}\n\n${jsonHint()}`,
      0,
      0,
    );
  };
}
