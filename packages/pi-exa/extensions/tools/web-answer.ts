import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Static } from '@sinclair/typebox';
import { exaPost } from '../client';
import { formatAnswerResponse } from '../format';
import { truncateToolOutput } from '../output';
import {
  buildAnswerPreview,
  metadataFromArgs,
  renderExaCall,
  renderExaResult,
  sendProgress,
} from '../render';
import { WebAnswerParamsSchema } from '../schemas';
import type { ExaAnswerResponse, ExaToolDetails, JsonObject } from '../types';
import { compactObject } from '../util';
import { withExaApiKey, errorResult } from './helpers';

type WebAnswerParams = Static<typeof WebAnswerParamsSchema>;

export interface WebAnswerRequest {
  query: string;
  text?: boolean;
  outputSchema?: JsonObject;
}

export function buildWebAnswerRequest(params: WebAnswerParams): WebAnswerRequest {
  return compactObject({
    query: params.query,
    text: params.text,
    outputSchema: params.outputSchema,
  }) as WebAnswerRequest;
}

export function createWebAnswerTool() {
  return defineTool<
    typeof WebAnswerParamsSchema,
    ExaToolDetails<ExaAnswerResponse, WebAnswerRequest> | undefined
  >({
    name: 'web_answer_exa',
    label: 'Exa Web Answer',
    description:
      'Ask Exa Answer for a direct sourced answer. Use when a generated answer with citations is better than a search result list.',
    promptSnippet: 'Ask Exa for a sourced answer',
    promptGuidelines: [
      'Use web_answer_exa when the user wants a direct sourced answer; use web_search_exa when the agent needs to inspect or compare sources itself.',
      'Do not set web_answer_exa text=true unless citation page text is necessary.',
    ],
    parameters: WebAnswerParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = buildWebAnswerRequest(params);
      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          sendProgress(onUpdate, 'Getting grounded answer from Exa...');
          const response = await exaPost<ExaAnswerResponse>(apiKey, '/answer', request, signal);
          const output = await truncateToolOutput(
            formatAnswerResponse(response),
            'web-answer-exa',
            'Set text=false or ask a narrower question. ',
          );
          return {
            content: [{ type: 'text', text: output.text }],
            details: {
              endpoint: '/answer',
              request,
              response,
              requestId: response.requestId,
              count: response.citations?.length ?? 0,
              costDollars: response.costDollars,
              preview: buildAnswerPreview(response, output),
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
        'web_answer_exa',
        `"${args.query}"`,
        theme,
        metadataFromArgs(args, ['text']),
      );
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Getting grounded answer from Exa...');
    },
  });
}
