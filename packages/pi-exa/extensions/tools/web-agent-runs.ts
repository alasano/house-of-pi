import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Static } from '@sinclair/typebox';
import {
  cancelAgentRun,
  deleteAgentRun,
  getAgentRun,
  listAgentRunEvents,
  listAgentRuns,
  replayAgentRunEvents,
} from '../agent';
import {
  countAgentSources,
  formatAgentEventListResponse,
  formatAgentRunListResponse,
  formatAgentRunResponse,
  formatDeletedAgentRun,
} from '../format';
import { truncateToolOutput } from '../output';
import {
  buildAgentEventListPreview,
  buildAgentRunListPreview,
  buildAgentRunPreview,
  buildDeletedAgentRunPreview,
  metadataFromArgs,
  renderExaCall,
  renderExaResult,
  sendProgress,
} from '../render';
import {
  WebAgentEventsParamsSchema,
  WebAgentListParamsSchema,
  WebAgentRunParamsSchema,
} from '../schemas';
import type {
  ExaAgentEventListResponse,
  ExaAgentRun,
  ExaAgentRunListResponse,
  ExaDeletedAgentRun,
  ExaToolDetails,
} from '../types';
import { compactObject } from '../util';
import { errorResult, withExaApiKey } from './helpers';

type WebAgentRunParams = Static<typeof WebAgentRunParamsSchema>;
type WebAgentListParams = Static<typeof WebAgentListParamsSchema>;
type WebAgentEventsParams = Static<typeof WebAgentEventsParamsSchema>;

export interface AgentPaginationRequest {
  limit?: number;
  cursor?: string;
  [key: string]: string | number | undefined;
}

export function buildAgentPaginationRequest(
  params: WebAgentListParams | WebAgentEventsParams,
): AgentPaginationRequest {
  return compactObject({
    limit: params.limit,
    cursor: params.cursor,
  }) as AgentPaginationRequest;
}

export interface AgentEventReplayRequest {
  lastEventId?: string;
}

export function buildAgentEventReplayRequest(
  params: WebAgentEventsParams,
): AgentEventReplayRequest {
  return compactObject({
    lastEventId: params.lastEventId,
  }) as AgentEventReplayRequest;
}

async function collectAsync<T>(items: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const item of items) output.push(item);
  return output;
}

export function createWebAgentGetTool() {
  return defineTool<
    typeof WebAgentRunParamsSchema,
    ExaToolDetails<ExaAgentRun, WebAgentRunParams> | undefined
  >({
    name: 'web_agent_get_exa',
    label: 'Exa Agent Get Run',
    description:
      'Retrieve a stored Exa Agent run by ID, including output, sources, usage, and cost.',
    promptSnippet: 'Get an Exa Agent run by ID',
    promptGuidelines: [
      'Use web_agent_get_exa to inspect a known Agent run ID, including completed background runs. It returns the full Agent result payload, including structured output and grounding.',
      'If a run is still queued or running, inspect events only when the user asked for progress/history; otherwise wait for background completion or user direction.',
      'Do not repeatedly call web_agent_get_exa for a background run started by web_agent_exa; pi-exa tracks background completion and sends a follow-up.',
    ],
    parameters: WebAgentRunParamsSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          const response = await getAgentRun(apiKey, params.runId, signal);
          const output = await truncateToolOutput(
            formatAgentRunResponse(response),
            'web-agent-get-exa',
            'Use a narrower Agent output schema for future runs, or inspect only events with web_agent_events_exa. ',
            { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER },
          );

          return {
            content: [{ type: 'text', text: output.text }],
            details: {
              endpoint: `/agent/runs/${params.runId}`,
              request: params,
              response,
              requestId: response.id,
              count: countAgentSources(response.output?.grounding),
              costDollars: response.costDollars,
              preview: buildAgentRunPreview(response, output),
              truncated: output.truncation.truncated,
              truncation: output.truncation,
              fullOutputPath: output.fullOutputPath,
            },
            isError: response.status === 'failed',
          };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
    renderCall(args, theme) {
      return renderExaCall('web_agent_get_exa', args.runId, theme);
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Getting Exa Agent run...');
    },
  });
}

export function createWebAgentListTool() {
  return defineTool<
    typeof WebAgentListParamsSchema,
    ExaToolDetails<ExaAgentRunListResponse, AgentPaginationRequest> | undefined
  >({
    name: 'web_agent_list_exa',
    label: 'Exa Agent List Runs',
    description: 'List recent Exa Agent runs, with pagination support.',
    promptSnippet: 'List recent Exa Agent runs',
    promptGuidelines: [
      'Use web_agent_list_exa when the user needs to find a run ID or inspect recent Agent run statuses.',
      'Use cursor for pagination only when the first page does not contain the needed run.',
      'Do not use web_agent_list_exa as a polling loop for a background run started in this session.',
    ],
    parameters: WebAgentListParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = buildAgentPaginationRequest(params);
      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          sendProgress(onUpdate, 'Listing Exa Agent runs...');
          const response = await listAgentRuns(apiKey, request, signal);
          const output = await truncateToolOutput(
            formatAgentRunListResponse(response),
            'web-agent-list-exa',
            'Use a smaller limit, cursor pagination, or web_agent_get_exa for one run. ',
          );

          return {
            content: [{ type: 'text', text: output.text }],
            details: {
              endpoint: '/agent/runs',
              request,
              response,
              count: response.data?.length ?? 0,
              preview: buildAgentRunListPreview(response, output),
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
        'web_agent_list_exa',
        'recent runs',
        theme,
        metadataFromArgs(args, ['limit', 'cursor']),
      );
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Listing Exa Agent runs...');
    },
  });
}

export function createWebAgentCancelTool() {
  return defineTool<
    typeof WebAgentRunParamsSchema,
    ExaToolDetails<ExaAgentRun, WebAgentRunParams> | undefined
  >({
    name: 'web_agent_cancel_exa',
    label: 'Exa Agent Cancel Run',
    description: 'Cancel a queued or running Exa Agent run.',
    promptSnippet: 'Cancel an Exa Agent run',
    promptGuidelines: [
      'Use web_agent_cancel_exa only when the user wants to stop a known queued or running Agent run.',
      'After cancellation, use web_agent_get_exa if the user wants the stored final status and cost.',
    ],
    parameters: WebAgentRunParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          sendProgress(onUpdate, `Cancelling Exa Agent run ${params.runId}...`);
          const response = await cancelAgentRun(apiKey, params.runId, signal);
          const output = await truncateToolOutput(
            formatAgentRunResponse(response),
            'web-agent-cancel-exa',
            'Use web_agent_get_exa for the run ID if more detail is needed. ',
          );

          return {
            content: [{ type: 'text', text: output.text }],
            details: {
              endpoint: `/agent/runs/${params.runId}/cancel`,
              request: params,
              response,
              requestId: response.id,
              costDollars: response.costDollars,
              preview: buildAgentRunPreview(response, output),
              truncated: output.truncation.truncated,
              truncation: output.truncation,
              fullOutputPath: output.fullOutputPath,
            },
            isError: response.status === 'failed',
          };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
    renderCall(args, theme) {
      return renderExaCall('web_agent_cancel_exa', args.runId, theme);
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Cancelling Exa Agent run...');
    },
  });
}

export function createWebAgentDeleteTool() {
  return defineTool<
    typeof WebAgentRunParamsSchema,
    ExaToolDetails<ExaDeletedAgentRun, WebAgentRunParams> | undefined
  >({
    name: 'web_agent_delete_exa',
    label: 'Exa Agent Delete Run',
    description: 'Delete a stored Exa Agent run by ID.',
    promptSnippet: 'Delete a stored Exa Agent run',
    promptGuidelines: [
      'Use web_agent_delete_exa only when the user explicitly wants to delete a stored Agent run.',
      'Deletion removes the stored run from Exa; prefer web_agent_cancel_exa for stopping active work.',
    ],
    parameters: WebAgentRunParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          sendProgress(onUpdate, `Deleting Exa Agent run ${params.runId}...`);
          const response = await deleteAgentRun(apiKey, params.runId, signal);
          const output = await truncateToolOutput(
            formatDeletedAgentRun(response),
            'web-agent-delete-exa',
            'List runs with web_agent_list_exa if you need another run ID. ',
          );

          return {
            content: [{ type: 'text', text: output.text }],
            details: {
              endpoint: `/agent/runs/${params.runId}`,
              request: params,
              response,
              requestId: response.id,
              preview: buildDeletedAgentRunPreview(response, output),
              truncated: output.truncation.truncated,
              truncation: output.truncation,
              fullOutputPath: output.fullOutputPath,
            },
            isError: !response.deleted,
          };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
    renderCall(args, theme) {
      return renderExaCall('web_agent_delete_exa', args.runId, theme);
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Deleting Exa Agent run...');
    },
  });
}

export function createWebAgentEventsTool() {
  return defineTool<
    typeof WebAgentEventsParamsSchema,
    ExaToolDetails<ExaAgentEventListResponse, WebAgentEventsParams> | undefined
  >({
    name: 'web_agent_events_exa',
    label: 'Exa Agent Run Events',
    description: 'List stored lifecycle events for an Exa Agent run.',
    promptSnippet: 'List events for an Exa Agent run',
    promptGuidelines: [
      'Use web_agent_events_exa to inspect lifecycle progress or replay stored events for a known Agent run.',
      'Use web_agent_get_exa when the user needs the run output rather than event history.',
      'Do not call web_agent_events_exa repeatedly for background runs; the extension tracks background completion and sends a follow-up.',
    ],
    parameters: WebAgentEventsParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = params;
      const pagination = buildAgentPaginationRequest(params);
      const replay = buildAgentEventReplayRequest(params);
      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          sendProgress(
            onUpdate,
            params.replay
              ? `Replaying events for Exa Agent run ${params.runId}...`
              : `Listing events for Exa Agent run ${params.runId}...`,
          );
          const response = params.replay
            ? {
                object: 'list',
                data: await collectAsync(
                  replayAgentRunEvents(apiKey, params.runId, replay, signal),
                ),
                hasMore: false,
                nextCursor: null,
              }
            : await listAgentRunEvents(apiKey, params.runId, pagination, signal);
          const output = await truncateToolOutput(
            formatAgentEventListResponse(response),
            'web-agent-events-exa',
            'Use a smaller limit, cursor pagination, replay with lastEventId, or web_agent_get_exa for run output. ',
          );

          return {
            content: [{ type: 'text', text: output.text }],
            details: {
              endpoint: `/agent/runs/${params.runId}/events`,
              request,
              response,
              count: response.data?.length ?? 0,
              preview: buildAgentEventListPreview(response, output),
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
        'web_agent_events_exa',
        args.runId,
        theme,
        metadataFromArgs(args, ['limit', 'cursor', 'replay', 'lastEventId']),
      );
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Listing Exa Agent run events...');
    },
  });
}
