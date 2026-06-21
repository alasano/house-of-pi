import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Static } from '@sinclair/typebox';
import { exaPost } from '../client';
import { formatSearchResponse } from '../format';
import { truncateToolOutput } from '../output';
import {
  buildSearchPreview,
  metadataFromArgs,
  renderExaCall,
  renderExaResult,
  sendProgress,
} from '../render';
import { WebSearchAdvancedParamsSchema } from '../schemas';
import type { ExaSearchResponse, ExaToolDetails, JsonObject, SearchType } from '../types';
import { compactObject } from '../util';
import { withExaApiKey, errorResult } from './helpers';

type WebSearchAdvancedParams = Static<typeof WebSearchAdvancedParamsSchema>;

type HighlightsRequest = true | { maxCharacters?: number; query?: string };

export interface WebSearchAdvancedRequest {
  query: string;
  type: SearchType;
  numResults: number;
  contents: JsonObject;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  startCrawlDate?: string;
  endCrawlDate?: string;
  includeText?: string[];
  excludeText?: string[];
  userLocation?: string;
  moderation?: boolean;
  additionalQueries?: string[];
}

function buildHighlights(params: WebSearchAdvancedParams): HighlightsRequest | undefined {
  if (!params.enableHighlights) return undefined;

  if (params.highlightsMaxCharacters !== undefined || params.highlightsQuery !== undefined) {
    return compactObject({
      maxCharacters: params.highlightsMaxCharacters,
      query: params.highlightsQuery,
    });
  }

  return true;
}

function buildContents(params: WebSearchAdvancedParams): JsonObject {
  return compactObject({
    text:
      params.textMaxCharacters !== undefined ? { maxCharacters: params.textMaxCharacters } : true,
    context:
      params.contextMaxCharacters !== undefined
        ? { maxCharacters: params.contextMaxCharacters }
        : undefined,
    summary: params.enableSummary
      ? params.summaryQuery
        ? { query: params.summaryQuery }
        : true
      : undefined,
    highlights: buildHighlights(params),
    maxAgeHours: params.maxAgeHours,
    livecrawlTimeout: params.livecrawlTimeout,
    subpages: params.subpages,
    subpageTarget: params.subpageTarget,
  });
}

export function buildWebSearchAdvancedRequest(
  params: WebSearchAdvancedParams,
): WebSearchAdvancedRequest {
  return compactObject({
    query: params.query,
    type: params.type ?? 'auto',
    numResults: params.numResults ?? 10,
    contents: buildContents(params),
    category: params.category,
    includeDomains: params.includeDomains,
    excludeDomains: params.excludeDomains,
    startPublishedDate: params.startPublishedDate,
    endPublishedDate: params.endPublishedDate,
    startCrawlDate: params.startCrawlDate,
    endCrawlDate: params.endCrawlDate,
    includeText: params.includeText,
    excludeText: params.excludeText,
    userLocation: params.userLocation,
    moderation: params.moderation,
    additionalQueries: params.additionalQueries,
  }) as WebSearchAdvancedRequest;
}

export function createWebSearchAdvancedTool() {
  return defineTool<
    typeof WebSearchAdvancedParamsSchema,
    ExaToolDetails<ExaSearchResponse, WebSearchAdvancedRequest> | undefined
  >({
    name: 'web_search_advanced_exa',
    label: 'Exa Advanced Search',
    description:
      'Advanced Exa web search with filters, domain restrictions, date ranges, highlights, summaries, freshness, and subpage crawling.',
    promptSnippet: 'Search Exa with filters, dates, domains, and content controls',
    promptGuidelines: [
      'Use web_search_advanced_exa when the search requires filters, dates, domains, categories, summaries, freshness, or subpages.',
      'Use textMaxCharacters when the task needs text but must keep each result bounded.',
    ],
    parameters: WebSearchAdvancedParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = buildWebSearchAdvancedRequest(params);
      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          sendProgress(onUpdate, 'Searching Exa with advanced filters...');
          const response = await exaPost<ExaSearchResponse>(apiKey, '/search', request, signal);
          const output = await truncateToolOutput(
            formatSearchResponse(response),
            'web-search-advanced-exa',
            'Reduce numResults, set textMaxCharacters, disable optional summaries/highlights, or narrow filters. ',
          );
          return {
            content: [{ type: 'text', text: output.text }],
            details: {
              endpoint: '/search',
              request,
              response,
              requestId: response.requestId,
              count: response.results?.length ?? 0,
              costDollars: response.costDollars,
              preview: buildSearchPreview(response, output),
              truncated: output.truncation.truncated,
              truncation: output.truncation,
              fullOutputPath: output.fullOutputPath,
            },
          };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
    renderCall(args, theme) {
      return renderExaCall(
        'web_search_advanced_exa',
        `"${args.query}"`,
        theme,
        metadataFromArgs(args, [
          'type',
          'numResults',
          'category',
          'textMaxCharacters',
          'contextMaxCharacters',
          'enableHighlights',
          'enableSummary',
        ]),
      );
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Searching Exa with advanced filters...');
    },
  });
}
