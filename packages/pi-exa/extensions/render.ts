import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  Theme,
  ToolRenderResultOptions,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import type {
  ExaAgentEventListResponse,
  ExaAgentRun,
  ExaAgentRunListResponse,
  ExaDeletedAgentRun,
  ExaAnswerResponse,
  ExaContentsResponse,
  ExaSearchResponse,
  ExaSearchResult,
  PreviewDetails,
} from './types';
import { asString } from './util';
import type { TruncatedToolOutput } from './output';

const DEFAULT_UI_PREVIEW_RESULT_COUNT = 3;
const DEFAULT_UI_PREVIEW_EXCERPT_CHARS = 220;

type ToolArgs = Record<string, unknown>;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stringifyValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toExcerpt(text: string | undefined, maxChars = DEFAULT_UI_PREVIEW_EXCERPT_CHARS) {
  if (!text) return undefined;
  const normalized = normalizeWhitespace(text);
  if (!normalized) return undefined;
  return normalized.length > maxChars
    ? `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`
    : normalized;
}

function resultExcerpt(result: ExaSearchResult): string | undefined {
  return (
    toExcerpt(result.highlights?.join(' ')) ||
    toExcerpt(stringifyValue(result.summary)) ||
    toExcerpt(result.text)
  );
}

function previewLinesFromResults(results: ExaSearchResult[]): string[] {
  return results.slice(0, DEFAULT_UI_PREVIEW_RESULT_COUNT).flatMap((result, index) => {
    const title =
      asString(result.title) || asString(result.url) || asString(result.id) || 'Untitled';
    const lines = [`${index + 1}. ${title}`];
    if (result.url) lines.push(`   ${result.url}`);
    const excerpt = resultExcerpt(result);
    if (excerpt) lines.push(`   ${excerpt}`);
    return lines;
  });
}

function buildStatusSummary(statuses: ExaSearchResponse['statuses']): string | undefined {
  if (!statuses?.length) return undefined;
  const counts = new Map<string, number>();
  for (const status of statuses) {
    const key = asString(status.status) || 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => `${status}: ${count}`).join(' | ');
}

function previewFromOutput(output: TruncatedToolOutput) {
  return {
    truncated: output.truncation.truncated,
    fullOutputPath: output.fullOutputPath,
  };
}

export function buildSearchPreview(
  response: ExaSearchResponse,
  output: TruncatedToolOutput,
): PreviewDetails {
  const results = response.results || [];
  const lines = previewLinesFromResults(results);
  const synthesizedOutput = toExcerpt(stringifyValue(response.output?.content));
  if (synthesizedOutput) lines.unshift(`Output: ${synthesizedOutput}`);

  const statusSummary = buildStatusSummary(response.statuses);
  if (statusSummary) lines.unshift(`Statuses: ${statusSummary}`);

  return {
    kind: 'search',
    summary: `${results.length} result(s)`,
    lines,
    expandedLines: lines,
    ...previewFromOutput(output),
  };
}

export function buildContentsPreview(
  response: ExaContentsResponse,
  urlCount: number,
  output: TruncatedToolOutput,
): PreviewDetails {
  const results = response.results || [];
  const lines = previewLinesFromResults(results);
  const statusSummary = buildStatusSummary(response.statuses);
  if (statusSummary) lines.unshift(`Statuses: ${statusSummary}`);

  return {
    kind: 'contents',
    summary: `${results.length} item(s) from ${urlCount} URL(s)`,
    lines,
    expandedLines: lines,
    ...previewFromOutput(output),
  };
}

export function buildAnswerPreview(
  response: ExaAnswerResponse,
  output: TruncatedToolOutput,
): PreviewDetails {
  const answer = stringifyValue(response.answer);
  const citations = response.citations || [];
  const lines = [
    ...(answer ? [`1. Answer`, `   ${toExcerpt(answer)}`] : ['1. No answer returned']),
    ...citations
      .slice(0, Math.max(0, DEFAULT_UI_PREVIEW_RESULT_COUNT - 1))
      .flatMap((citation, index) => {
        const title = asString(citation.title) || asString(citation.url) || 'Source';
        const entry = [`${index + 2}. ${title}`];
        if (citation.url) entry.push(`   ${citation.url}`);
        const excerpt = toExcerpt(citation.text);
        if (excerpt) entry.push(`   ${excerpt}`);
        return entry;
      }),
  ];

  return {
    kind: 'answer',
    summary: `${citations.length} source(s)`,
    lines,
    expandedLines: lines,
    ...previewFromOutput(output),
  };
}

function agentRunExcerpt(run: ExaAgentRun): string | undefined {
  return (
    toExcerpt(run.output?.text || undefined) ||
    toExcerpt(stringifyValue(run.output?.structured)) ||
    toExcerpt(run.request?.query)
  );
}

function agentStructuredSummary(run: ExaAgentRun): string | undefined {
  const structured = run.output?.structured;
  if (structured === undefined || structured === null) return undefined;
  if (Array.isArray(structured)) return `Array with ${structured.length} item(s)`;
  if (typeof structured === 'object') {
    const entries = Object.entries(structured as Record<string, unknown>);
    const arrayEntry = entries.find(([, value]) => Array.isArray(value));
    if (arrayEntry && Array.isArray(arrayEntry[1])) {
      return `${arrayEntry[0]}: ${arrayEntry[1].length} item(s)`;
    }
    return `Object with ${entries.length} field(s)`;
  }
  return toExcerpt(String(structured));
}

function agentCostSummary(run: ExaAgentRun): string | undefined {
  const total = run.costDollars?.total;
  return total === undefined ? undefined : `$${total}`;
}

export function buildAgentRunPreview(
  run: ExaAgentRun,
  output: TruncatedToolOutput,
  options?: { timedOut?: boolean; background?: boolean },
): PreviewDetails {
  const lines: string[] = [];
  const excerpt = agentRunExcerpt(run);
  const structuredSummary = agentStructuredSummary(run);
  if (run.output?.text && excerpt) lines.push(`Answer: ${excerpt}`);
  if (structuredSummary) lines.push(`Structured: ${structuredSummary}`);
  if (!run.output?.text && !structuredSummary && excerpt) lines.push(`Preview: ${excerpt}`);
  if (options?.timedOut) lines.push('Timed out waiting; run can be inspected later.');
  if (options?.background) {
    lines.push('Background tracking enabled; the extension will notify on completion.');
  }
  if (lines.length === 0) lines.push(`Status: ${run.status}`);

  const cost = agentCostSummary(run);
  const summary = [run.status, cost].filter(Boolean).join(' | ');
  const expandedLines = [
    `Run ID: ${run.id}`,
    ...(run.request?.query ? [`Query: ${toExcerpt(run.request.query, 500)}`] : []),
    ...lines,
  ];

  return {
    kind: 'agent',
    summary,
    lines,
    expandedLines,
    ...previewFromOutput(output),
  };
}

export function buildAgentRunListPreview(
  response: ExaAgentRunListResponse,
  output: TruncatedToolOutput,
): PreviewDetails {
  const runs = response.data || [];
  const lines = runs.slice(0, DEFAULT_UI_PREVIEW_RESULT_COUNT).flatMap((run, index) => {
    const entry = [`${index + 1}. ${run.id} | ${run.status}`];
    if (run.request?.query) entry.push(`   ${toExcerpt(run.request.query)}`);
    return entry;
  });
  if (response.hasMore)
    lines.push(`More available: ${response.nextCursor || 'next cursor omitted'}`);

  return {
    kind: 'agent',
    summary: `${runs.length} run(s)`,
    lines,
    expandedLines: lines,
    ...previewFromOutput(output),
  };
}

export function buildAgentEventListPreview(
  response: ExaAgentEventListResponse,
  output: TruncatedToolOutput,
): PreviewDetails {
  const events = response.data || [];
  const lines = events.slice(0, DEFAULT_UI_PREVIEW_RESULT_COUNT).map((event, index) => {
    const runId = asString(event.data?.id) || asString(event.data?.runId);
    return `${index + 1}. ${event.event}${runId ? ` | ${runId}` : ''}`;
  });
  if (response.hasMore)
    lines.push(`More available: ${response.nextCursor || 'next cursor omitted'}`);

  return {
    kind: 'agent',
    summary: `${events.length} event(s)`,
    lines,
    expandedLines: lines,
    ...previewFromOutput(output),
  };
}

export function buildDeletedAgentRunPreview(
  response: ExaDeletedAgentRun,
  output: TruncatedToolOutput,
): PreviewDetails {
  const lines = [`Run: ${response.id}`, `Deleted: ${response.deleted ? 'yes' : 'no'}`];

  return {
    kind: 'agent',
    summary: response.deleted ? 'deleted' : 'not deleted',
    lines,
    expandedLines: lines,
    ...previewFromOutput(output),
  };
}

export function sendProgress<TDetails>(
  onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
  text: string,
) {
  onUpdate?.({
    content: [{ type: 'text', text }],
    details: { status: 'pending' } as TDetails,
  });
}

export function renderExaCall(
  toolName: string,
  primary: string,
  theme: Theme,
  metadata: string[] = [],
): Text {
  let text = theme.fg('toolTitle', theme.bold(`${toolName} `));
  text += theme.fg('accent', primary);
  if (metadata.length > 0) text += theme.fg('dim', ` | ${metadata.join(' | ')}`);
  return new Text(text, 0, 0);
}

function renderPreviewText(
  preview: PreviewDetails | undefined,
  expanded: boolean,
  theme: Theme,
  options?: { partial?: boolean; partialLabel?: string },
) {
  if (!preview) {
    return theme.fg('dim', 'No preview available');
  }

  const lines = expanded ? (preview.expandedLines ?? preview.lines) : preview.lines;

  let text = theme.fg('success', preview.summary);
  if (preview.truncated) text += theme.fg('warning', ' | agent output truncated');

  if (lines.length > 0) {
    const label =
      preview.kind === 'agent'
        ? options?.partial
          ? (options.partialLabel ?? 'Streaming events:')
          : expanded
            ? 'Expanded UI preview; Ctrl+O to hide:'
            : 'Preview only; Ctrl+O to show full response:'
        : 'UI preview only; the agent received a fuller payload:';
    text += `\n${theme.fg('muted', label)}`;
    for (const line of lines) {
      text += `\n${theme.fg('dim', line)}`;
    }
  }

  if (preview.fullOutputPath) {
    text += `\n${theme.fg('muted', `Full output saved to ${preview.fullOutputPath}`)}`;
  }

  return text;
}

export function renderPreviewResult(
  preview: PreviewDetails | undefined,
  expanded: boolean,
  theme: Theme,
): Text {
  return new Text(renderPreviewText(preview, expanded, theme), 0, 0);
}

function rawResponsePreview(details: unknown): string | undefined {
  if (!details || typeof details !== 'object' || !('response' in details)) return undefined;
  try {
    return JSON.stringify((details as { response: unknown }).response, null, 2);
  } catch {
    return undefined;
  }
}

export function renderExaResult<TDetails extends { preview?: PreviewDetails } | undefined>(
  result: AgentToolResult<TDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  pendingText: string,
): Text {
  if (options.isPartial) {
    if (result.details?.preview) {
      const details = result.details as { monitor?: unknown; preview?: PreviewDetails };
      const partialLabel =
        details.preview?.kind === 'agent' && details.monitor === 'poll'
          ? 'Polling status:'
          : undefined;
      return new Text(
        renderPreviewText(result.details.preview, true, theme, { partial: true, partialLabel }),
        0,
        0,
      );
    }

    const textContent = result.content?.find((item) => item.type === 'text')?.text;
    return new Text(theme.fg('warning', textContent || pendingText), 0, 0);
  }
  let text = renderPreviewText(result.details?.preview, options.expanded, theme);

  if (options.expanded && result.details?.preview?.kind === 'agent') {
    const raw = rawResponsePreview(result.details);
    if (raw) {
      text += `\n${theme.fg('muted', 'UI-only raw API response:')}\n${theme.fg('dim', raw)}`;
    }
  }

  return new Text(text, 0, 0);
}

export function metadataFromArgs(args: ToolArgs, keys: string[]): string[] {
  return keys.flatMap((key) => {
    const value = args[key];
    if (value === undefined || value === null || value === false) return [];
    if (value === true) return [key];
    return [`${key}=${String(value)}`];
  });
}
