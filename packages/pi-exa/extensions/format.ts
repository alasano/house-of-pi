import type {
  ExaAgentCostDollars,
  ExaAgentEvent,
  ExaAgentEventListResponse,
  ExaAgentGroundingEntry,
  ExaAgentRun,
  ExaAgentRunListResponse,
  ExaAgentUsage,
  ExaAnswerResponse,
  ExaContentsResponse,
  ExaContentsStatus,
  ExaDeletedAgentRun,
  ExaLink,
  ExaSearchResponse,
  ExaSearchResult,
} from './types';
import { asString, isRecord, truncateText } from './util';

const CITATION_TEXT_MAX = 500;
const MAX_EXTRA_LINKS = 10;
const AGENT_SOURCE_MAX = 10;

function stringifyValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatMetadataLine(result: {
  publishedDate?: string | null;
  author?: string | null;
  score?: number;
}): string | undefined {
  const parts: string[] = [];
  if (result.publishedDate) parts.push(`Published: ${result.publishedDate}`);
  if (result.author) parts.push(`Author: ${result.author}`);
  if (result.score !== undefined) parts.push(`Score: ${result.score}`);
  return parts.length ? parts.join(' | ') : undefined;
}

function formatMetadata(result: ExaSearchResult): string[] {
  const lines = [`Title: ${result.title || 'N/A'}`, `URL: ${result.url || result.id || 'N/A'}`];
  if (result.id && result.id !== result.url) lines.push(`ID: ${result.id}`);
  const metadata = formatMetadataLine(result);
  if (metadata) lines.push(metadata);
  if (result.image) lines.push(`Image: ${result.image}`);
  if (result.favicon) lines.push(`Favicon: ${result.favicon}`);
  return lines;
}

function formatLinkEntry(link: string | ExaLink): string {
  if (typeof link === 'string') return link;
  const label = asString(link.title) || asString(link.altText) || 'Link';
  return `${label}${link.url ? ` - ${link.url}` : ''}`;
}

function appendExtras(lines: string[], result: ExaSearchResult, indent = '') {
  const links = [...(result.links || []), ...(result.extras?.links || [])];
  if (links.length > 0) {
    lines.push(`${indent}Links:`);
    for (const link of links.slice(0, MAX_EXTRA_LINKS)) {
      lines.push(`${indent}- ${formatLinkEntry(link)}`);
    }
  }

  const imageLinks = [...(result.imageLinks || []), ...(result.extras?.imageLinks || [])];
  if (imageLinks.length > 0) {
    lines.push(`${indent}Image links:`);
    for (const imageLink of imageLinks.slice(0, MAX_EXTRA_LINKS)) {
      lines.push(`${indent}- ${formatLinkEntry(imageLink)}`);
    }
  }
}

function formatSearchResult(result: ExaSearchResult): string {
  const lines = formatMetadata(result);

  const summary = stringifyValue(result.summary);
  if (summary) {
    lines.push('Summary:');
    lines.push(summary);
  }

  if (Array.isArray(result.highlights) && result.highlights.length > 0) {
    lines.push('Highlights:');
    lines.push(...result.highlights.filter(Boolean).map((highlight) => `- ${highlight}`));
  }

  if (result.text) {
    lines.push('Text:');
    lines.push(result.text);
  }

  appendExtras(lines, result);

  if (Array.isArray(result.subpages) && result.subpages.length > 0) {
    lines.push('Subpages:');
    for (const [index, subpage] of result.subpages.entries()) {
      lines.push(formatContentResult(subpage, index + 1, 1));
    }
  }

  return lines.join('\n');
}

export function formatSearchResponse(response: ExaSearchResponse): string {
  const results = Array.isArray(response.results) ? response.results : [];
  const sections: string[] = [];

  if (response.context) {
    sections.push(`Context:\n${response.context}`);
  }

  if (response.output) {
    const output = stringifyValue(response.output.content);
    if (output) sections.push(`Synthesized output:\n${output}`);

    const grounding = response.output.grounding || [];
    if (grounding.length > 0) {
      const seen = new Set<string>();
      const lines = ['Sources:'];
      for (const item of grounding) {
        for (const citation of item.citations || []) {
          const key = citation.url || citation.title;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          lines.push(`- ${citation.title || 'Source'}${citation.url ? ` - ${citation.url}` : ''}`);
        }
      }
      if (lines.length > 1) sections.push(lines.join('\n'));
    }
  }

  if (results.length > 0) {
    sections.push(results.map(formatSearchResult).join('\n\n---\n\n'));
  }

  const errors = Array.isArray(response.statuses)
    ? response.statuses.filter((status) => status.status === 'error')
    : [];
  if (errors.length > 0) sections.push(errors.map(formatStatusError).join('\n'));

  return sections.length > 0 ? sections.join('\n\n---\n\n') : 'No search results found.';
}

function formatContentResult(result: ExaSearchResult, index?: number, depth = 0): string {
  const indent = '  '.repeat(depth);
  const title = result.title || result.url || result.id || '(no title)';
  const lines = [index === undefined ? `# ${title}` : `${indent}## Item ${index}: ${title}`];
  if (result.url || result.id) lines.push(`${indent}URL: ${result.url || result.id || 'N/A'}`);
  if (result.id && result.id !== result.url) lines.push(`${indent}ID: ${result.id}`);
  const metadata = formatMetadataLine(result);
  if (metadata) lines.push(`${indent}${metadata}`);
  lines.push('');

  const summary = stringifyValue(result.summary);
  if (summary) {
    lines.push(`${indent}Summary:`);
    lines.push(summary);
  }

  if (Array.isArray(result.highlights) && result.highlights.length > 0) {
    lines.push(`${indent}Highlights:`);
    lines.push(...result.highlights.filter(Boolean).map((highlight) => `${indent}- ${highlight}`));
  }

  if (result.text) {
    lines.push(`${indent}Text:`);
    lines.push(result.text);
  }

  appendExtras(lines, result, indent);

  if (Array.isArray(result.subpages) && result.subpages.length > 0) {
    lines.push(`${indent}Subpages:`);
    for (const [subpageIndex, subpage] of result.subpages.entries()) {
      lines.push(formatContentResult(subpage, subpageIndex + 1, depth + 1));
    }
  }

  return lines.join('\n').trim();
}

function formatStatusError(status: ExaContentsStatus): string {
  const target = status.url || status.id || 'unknown URL';
  const error = status.error;
  if (typeof error === 'string') return `Error fetching ${target}: ${error}`;
  if (isRecord(error)) {
    return `Error fetching ${target}: ${error.message || error.tag || 'unknown error'}`;
  }
  return `Error fetching ${target}: unknown error`;
}

export function formatContentsResponse(response: ExaContentsResponse): string {
  const results = Array.isArray(response.results) ? response.results : [];
  const errors = Array.isArray(response.statuses)
    ? response.statuses.filter((status) => status.status === 'error')
    : [];

  const sections = [
    ...results.map((result, index) => formatContentResult(result, index + 1)),
    ...errors.map(formatStatusError),
  ];
  return sections.length > 0
    ? sections.join('\n\n---\n\n')
    : 'No content found for the provided URL(s).';
}

export function hasContentsErrors(response: ExaContentsResponse): boolean {
  return Boolean(response.statuses?.some((status) => status.status === 'error'));
}

function formatAnswerValue(answer: ExaAnswerResponse['answer']): string {
  if (answer === undefined) return 'No answer returned.';
  if (typeof answer === 'string') return answer;
  return JSON.stringify(answer, null, 2);
}

function formatCitation(citation: ExaSearchResult, index: number): string {
  const lines = [
    `${index + 1}. ${citation.title || citation.url || citation.id || 'Untitled source'}`,
  ];
  if (citation.url) lines.push(`   URL: ${citation.url}`);
  const metadata = formatMetadataLine(citation);
  if (metadata) lines.push(`   ${metadata}`);
  if (citation.text) lines.push(`   Text: ${truncateText(citation.text, CITATION_TEXT_MAX)}`);
  return lines.join('\n');
}

export function formatAnswerResponse(response: ExaAnswerResponse): string {
  const lines = [`Answer:\n${formatAnswerValue(response.answer)}`];
  const citations = Array.isArray(response.citations) ? response.citations : [];

  if (citations.length > 0) {
    lines.push(`Sources:\n${citations.map(formatCitation).join('\n\n')}`);
  }

  return lines.join('\n\n');
}

function formatJsonBlock(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function formatKeyValues(
  value: ExaAgentUsage | ExaAgentCostDollars | undefined,
  keys: string[],
): string | undefined {
  if (!value) return undefined;
  const parts = keys.flatMap((key) => {
    const item = value[key];
    return item === undefined || item === null ? [] : [`${key}: ${item}`];
  });
  return parts.length ? parts.join(' | ') : undefined;
}

export function countAgentSources(grounding: ExaAgentGroundingEntry[] | null | undefined): number {
  if (!grounding?.length) return 0;

  const seen = new Set<string>();
  for (const entry of grounding) {
    for (const citation of entry.citations || []) {
      const key = citation.url || citation.title;
      if (!key) continue;
      seen.add(key);
    }
  }

  return seen.size;
}

function formatAgentSources(grounding: ExaAgentGroundingEntry[] | null | undefined): string[] {
  if (!grounding?.length) return [];

  const seen = new Set<string>();
  const sources: string[] = [];

  for (const entry of grounding) {
    for (const citation of entry.citations || []) {
      const key = citation.url || citation.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      sources.push(`${citation.title || 'Source'}${citation.url ? ` - ${citation.url}` : ''}`);
    }
  }

  if (sources.length === 0) return [];

  const lines = ['Sources:'];
  lines.push(...sources.slice(0, AGENT_SOURCE_MAX).map((source) => `- ${source}`));

  if (sources.length > AGENT_SOURCE_MAX) {
    lines.push(`...${sources.length - AGENT_SOURCE_MAX} more source(s) omitted.`);
  }

  return lines;
}

export function formatAgentRunResponse(
  run: ExaAgentRun,
  options?: { timedOut?: boolean; background?: boolean },
): string {
  const lines: string[] = [`# Exa Agent Run: ${run.id}`];

  const status = [`Status: ${run.status}`];
  if (run.stopReason) status.push(`Stop reason: ${run.stopReason}`);
  if (options?.timedOut) status.push('Wait timed out');
  if (options?.background) status.push('Background tracking enabled; do not poll unless needed');
  lines.push(status.join(' | '));

  const dates = [];
  if (run.createdAt) dates.push(`Created: ${run.createdAt}`);
  if (run.completedAt) dates.push(`Completed: ${run.completedAt}`);
  if (dates.length > 0) lines.push(dates.join(' | '));

  if (run.request?.query) {
    lines.push('');
    lines.push('Query:');
    lines.push(run.request.query);
  }

  if (run.output?.text) {
    lines.push('');
    lines.push('Answer:');
    lines.push(run.output.text);
  }

  if (run.output?.structured !== undefined && run.output.structured !== null) {
    lines.push('');
    lines.push('Structured output:');
    lines.push(formatJsonBlock(run.output.structured));
  }

  const sources = formatAgentSources(run.output?.grounding);
  if (sources.length > 0) {
    lines.push('');
    lines.push(...sources);
  }

  if (run.output?.grounding?.length) {
    lines.push('');
    lines.push('Citation grounding:');
    lines.push(formatJsonBlock(run.output.grounding));
  }

  if (run.error) {
    lines.push('');
    lines.push('Error:');
    lines.push(formatJsonBlock(run.error));
  }

  const usage = formatKeyValues(run.usage, [
    'agentComputeUnits',
    'searches',
    'emails',
    'phoneNumbers',
  ]);
  if (usage) {
    lines.push('');
    lines.push(`Usage: ${usage}`);
  }

  const cost = formatKeyValues(run.costDollars, [
    'total',
    'agentCompute',
    'search',
    'emails',
    'phoneNumbers',
  ]);
  if (cost) lines.push(`Cost: ${cost}`);

  return lines.join('\n');
}

function formatAgentRunListEntry(run: ExaAgentRun, index: number): string {
  const lines = [`${index + 1}. ${run.id} | ${run.status}`];
  if (run.createdAt) lines.push(`   Created: ${run.createdAt}`);
  if (run.completedAt) lines.push(`   Completed: ${run.completedAt}`);
  if (run.stopReason) lines.push(`   Stop reason: ${run.stopReason}`);
  if (run.request?.query) lines.push(`   Query: ${truncateText(run.request.query, 240)}`);
  const cost = formatKeyValues(run.costDollars, ['total', 'agentCompute', 'search']);
  if (cost) lines.push(`   Cost: ${cost}`);
  return lines.join('\n');
}

export function formatAgentRunListResponse(response: ExaAgentRunListResponse): string {
  const runs = Array.isArray(response.data) ? response.data : [];
  const lines = [`Agent runs: ${runs.length}`];

  if (runs.length > 0) {
    lines.push('');
    lines.push(runs.map(formatAgentRunListEntry).join('\n\n'));
  }

  if (response.hasMore) {
    lines.push('');
    lines.push(`More runs available. nextCursor: ${response.nextCursor || '(none returned)'}`);
  }

  return lines.join('\n');
}

function formatAgentEvent(event: ExaAgentEvent, index: number): string {
  const lines = [`${index + 1}. ${event.event}`];
  if (event.id) lines.push(`   Event ID: ${event.id}`);
  if (event.createdAt) lines.push(`   Created: ${event.createdAt}`);
  lines.push(`   Data: ${formatJsonBlock(event.data).replace(/\n/g, '\n   ')}`);
  return lines.join('\n');
}

export function formatAgentEventListResponse(response: ExaAgentEventListResponse): string {
  const events = Array.isArray(response.data) ? response.data : [];
  const lines = [`Agent run events: ${events.length}`];

  if (events.length > 0) {
    lines.push('');
    lines.push(events.map(formatAgentEvent).join('\n\n'));
  }

  if (response.hasMore) {
    lines.push('');
    lines.push(`More events available. nextCursor: ${response.nextCursor || '(none returned)'}`);
  }

  return lines.join('\n');
}

export function formatDeletedAgentRun(response: ExaDeletedAgentRun): string {
  return `Deleted Agent run: ${response.id}\nDeleted: ${response.deleted ? 'yes' : 'no'}`;
}
