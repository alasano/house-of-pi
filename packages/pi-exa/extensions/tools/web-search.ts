import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Static } from 'typebox';
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
import { WebSearchParamsSchema } from '../schemas';
import type { ExaSearchResponse, ExaToolDetails, SearchCategory, SearchType } from '../types';
import { withExaApiKey, errorResult } from './helpers';

type WebSearchParams = Static<typeof WebSearchParamsSchema>;

export interface WebSearchRequest {
  query: string;
  type: SearchType;
  numResults: number;
  category?: SearchCategory;
  contents: {
    highlights: true;
  };
}

const CATEGORY_PATTERN = /\bcategory:(company|research\s*paper|news|personal\s*site|people)\b/i;

function parseCategory(query: string): { query: string; category?: SearchCategory } {
  const match = query.match(CATEGORY_PATTERN);
  if (!match) return { query };

  return {
    query: query.replace(match[0], '').replace(/\s+/g, ' ').trim(),
    category: match[1]?.toLowerCase().replace(/\s+/g, ' ') as SearchCategory,
  };
}

export function buildWebSearchRequest(params: WebSearchParams): WebSearchRequest {
  const parsed = parseCategory(params.query);
  return {
    query: parsed.query || params.query,
    type: 'auto',
    numResults: params.numResults ?? 10,
    ...(parsed.category ? { category: parsed.category } : {}),
    contents: {
      highlights: true,
    },
  };
}

export function createWebSearchTool() {
  return defineTool<
    typeof WebSearchParamsSchema,
    ExaToolDetails<ExaSearchResponse, WebSearchRequest> | undefined
  >({
    name: 'web_search_exa',
    label: 'Exa Web Search',
    description:
      'Search the web with Exa and return compact, highlight-first results. Use for broad web lookup before fetching full pages.',
    promptSnippet: 'Search the web with compact Exa highlights',
    promptGuidelines: [
      'Use web_search_exa for broad web lookup, then use web_fetch_exa only on selected URLs that need fuller content.',
      'Prefer web_search_exa results as source leads; do not paste raw search output when a concise synthesis is enough.',
    ],
    parameters: WebSearchParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = buildWebSearchRequest(params);
      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          sendProgress(onUpdate, 'Searching Exa...');
          const response = await exaPost<ExaSearchResponse>(apiKey, '/search', request, signal);
          const output = await truncateToolOutput(
            formatSearchResponse(response),
            'web-search-exa',
            'Refine your query, reduce numResults, or use web_fetch_exa only for selected URLs. ',
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
        'web_search_exa',
        `"${args.query}"`,
        theme,
        metadataFromArgs(args, ['numResults']),
      );
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Searching Exa...');
    },
  });
}
