import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Static } from '@sinclair/typebox';
import { exaPost } from '../client';
import { formatContentsResponse, hasContentsErrors } from '../format';
import { truncateToolOutput } from '../output';
import {
  buildContentsPreview,
  metadataFromArgs,
  renderExaCall,
  renderExaResult,
  sendProgress,
} from '../render';
import { WebFetchParamsSchema } from '../schemas';
import type { ExaContentsResponse, ExaToolDetails } from '../types';
import { withExaApiKey, errorResult } from './helpers';

type WebFetchParams = Static<typeof WebFetchParamsSchema>;

export interface WebFetchRequest {
  urls: string[];
  text: {
    maxCharacters: number;
  };
}

export function buildWebFetchRequest(params: WebFetchParams): WebFetchRequest {
  return {
    urls: params.urls,
    text: {
      maxCharacters: params.maxCharacters ?? 3000,
    },
  };
}

export function createWebFetchTool() {
  return defineTool<
    typeof WebFetchParamsSchema,
    ExaToolDetails<ExaContentsResponse, WebFetchRequest> | undefined
  >({
    name: 'web_fetch_exa',
    label: 'Exa Web Fetch',
    description:
      'Read clean markdown content from known URLs with Exa. Use after search when selected URLs need fuller content.',
    promptSnippet: 'Fetch clean markdown from known URLs with Exa',
    promptGuidelines: [
      'Use web_fetch_exa only after selecting promising URLs; avoid fetching every search result.',
      'Keep web_fetch_exa maxCharacters as small as the task allows.',
    ],
    parameters: WebFetchParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = buildWebFetchRequest(params);
      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          sendProgress(onUpdate, 'Fetching contents from Exa...');
          const response = await exaPost<ExaContentsResponse>(apiKey, '/contents', request, signal);
          const output = await truncateToolOutput(
            formatContentsResponse(response),
            'web-fetch-exa',
            'Fetch fewer URLs or reduce maxCharacters. ',
          );
          return {
            content: [{ type: 'text', text: output.text }],
            details: {
              endpoint: '/contents',
              request,
              response,
              requestId: response.requestId,
              count: response.results?.length ?? 0,
              costDollars: response.costDollars,
              preview: buildContentsPreview(response, params.urls.length, output),
              truncated: output.truncation.truncated,
              truncation: output.truncation,
              fullOutputPath: output.fullOutputPath,
            },
            isError: hasContentsErrors(response) && !response.results?.length,
          };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
    renderCall(args, theme) {
      return renderExaCall(
        'web_fetch_exa',
        `${args.urls.length} URL(s)`,
        theme,
        metadataFromArgs(args, ['maxCharacters']),
      );
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Fetching contents from Exa...');
    },
  });
}
