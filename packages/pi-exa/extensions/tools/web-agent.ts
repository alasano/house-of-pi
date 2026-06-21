import { defineTool } from '@earendil-works/pi-coding-agent';
import type { AgentToolUpdateCallback } from '@earendil-works/pi-coding-agent';
import type { Static } from '@sinclair/typebox';
import {
  createAgentRun,
  getAgentRun,
  getRunIdFromAgentEvent,
  isTerminalAgentStatus,
  pollAgentRunUntilFinished,
  streamAgentRunEvents,
  type ExaAgentCreateRequest,
} from '../agent';
import type { AgentRunTracker } from '../agent-tracker';
import { countAgentSources, formatAgentRunResponse } from '../format';
import { truncateToolOutput } from '../output';
import {
  buildAgentRunPreview,
  metadataFromArgs,
  renderExaCall,
  renderExaResult,
  sendProgress,
} from '../render';
import { WebAgentParamsSchema } from '../schemas';
import type { ExaAgentEvent, ExaAgentRun, ExaToolDetails, PreviewDetails } from '../types';
import { compactObject } from '../util';
import { withExaApiKey, errorResult } from './helpers';

type WebAgentParams = Static<typeof WebAgentParamsSchema>;

const DEFAULT_AGENT_POLL_INTERVAL_MS = 4000;
const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60 * 1000;

export interface WebAgentRequest extends ExaAgentCreateRequest {}

type WebAgentDetails =
  | (Partial<ExaToolDetails<ExaAgentRun, WebAgentRequest>> & {
      mode: 'wait' | 'background';
      monitor?: 'stream' | 'poll';
      timedOut?: boolean;
      events?: string[];
    })
  | undefined;

function createTimeoutSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason ?? new Error('Operation aborted.'));
  };
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function agentEventProgress(event: ExaAgentEvent): string {
  const runId = getRunIdFromAgentEvent(event);
  const status = typeof event.data.status === 'string' ? event.data.status : undefined;
  return [
    `Exa Agent event: ${event.event}`,
    runId ? `run=${runId}` : undefined,
    status ? `status=${status}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');
}

function sendAgentTimelineUpdate(
  onUpdate: AgentToolUpdateCallback<WebAgentDetails> | undefined,
  events: string[],
  summary = 'running',
) {
  const preview: PreviewDetails = {
    kind: 'agent',
    summary,
    lines: events.slice(-6),
    expandedLines: events,
  };

  onUpdate?.({
    content: [{ type: 'text', text: events[events.length - 1] || 'Running Exa Agent...' }],
    details: {
      endpoint: '/agent/runs',
      mode: 'wait',
      monitor: 'stream',
      events,
      preview,
    },
  });
}

function formatElapsedTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function sendAgentPollingUpdate(
  onUpdate: AgentToolUpdateCallback<WebAgentDetails> | undefined,
  run: ExaAgentRun,
  startedAt: number,
) {
  const elapsed = formatElapsedTime(Date.now() - startedAt);
  const lines = [`Run ID: ${run.id}`, `Status: ${run.status}`];
  const preview: PreviewDetails = {
    kind: 'agent',
    summary: `${run.status} | elapsed ${elapsed}`,
    lines,
    expandedLines: lines,
  };

  onUpdate?.({
    content: [{ type: 'text', text: `Exa Agent run ${run.id} is ${run.status}; polling...` }],
    details: {
      endpoint: '/agent/runs',
      response: run,
      requestId: run.id,
      mode: 'wait',
      monitor: 'poll',
      preview,
    },
  });
}

function remainingTimeout(startedAt: number, timeoutMs: number): number {
  return Math.max(1000, timeoutMs - (Date.now() - startedAt));
}

export function buildWebAgentRequest(params: WebAgentParams): WebAgentRequest {
  return compactObject({
    query: params.query,
    systemPrompt: params.systemPrompt,
    input: params.input,
    outputSchema: params.outputSchema,
    effort: params.effort,
    previousRunId: params.previousRunId,
    metadata: params.metadata,
  }) as WebAgentRequest;
}

async function waitWithPolling(
  apiKey: string,
  request: WebAgentRequest,
  params: WebAgentParams,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<WebAgentDetails> | undefined,
): Promise<{ run: ExaAgentRun; timedOut: boolean }> {
  const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_AGENT_POLL_INTERVAL_MS;
  const timeoutMs = params.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const startedAt = Date.now();

  sendProgress(onUpdate, 'Starting Exa Agent run...');
  const initialRun = await createAgentRun(apiKey, request, signal);
  sendAgentPollingUpdate(onUpdate, initialRun, startedAt);

  if (isTerminalAgentStatus(initialRun.status)) return { run: initialRun, timedOut: false };

  return pollAgentRunUntilFinished(apiKey, initialRun.id, {
    pollIntervalMs,
    timeoutMs,
    signal,
    onPoll: (run) => {
      sendAgentPollingUpdate(onUpdate, run, startedAt);
    },
  });
}

async function waitWithStreaming(
  apiKey: string,
  request: WebAgentRequest,
  params: WebAgentParams,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<WebAgentDetails> | undefined,
): Promise<{ run: ExaAgentRun; timedOut: boolean }> {
  const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_AGENT_POLL_INTERVAL_MS;
  const timeoutMs = params.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const startedAt = Date.now();
  const timeoutSignal = createTimeoutSignal(signal, timeoutMs);
  let runId: string | undefined;
  let terminalFromStream = false;
  const events: string[] = [];

  try {
    sendProgress(onUpdate, 'Starting Exa Agent run with streaming events...');
    for await (const event of streamAgentRunEvents(apiKey, request, timeoutSignal.signal)) {
      runId = getRunIdFromAgentEvent(event) ?? runId;
      const status = typeof event.data.status === 'string' ? event.data.status : undefined;
      terminalFromStream = terminalFromStream || isTerminalAgentStatus(status);
      const line = agentEventProgress(event);
      events.push(line);
      sendAgentTimelineUpdate(onUpdate, events, status || 'running');
    }
  } catch (error) {
    if (!runId || (!timeoutSignal.isTimedOut() && signal?.aborted)) throw error;
    if (timeoutSignal.isTimedOut()) {
      const run = await getAgentRun(apiKey, runId, signal);
      return { run, timedOut: true };
    }

    sendProgress(onUpdate, `Exa Agent stream ended; polling run ${runId}...`);
    return pollAgentRunUntilFinished(apiKey, runId, {
      pollIntervalMs,
      timeoutMs: remainingTimeout(startedAt, timeoutMs),
      signal,
    });
  } finally {
    timeoutSignal.dispose();
  }

  if (!runId) throw new Error('Exa Agent stream ended before a run ID was returned.');

  if (terminalFromStream) {
    return { run: await getAgentRun(apiKey, runId, signal), timedOut: false };
  }

  return pollAgentRunUntilFinished(apiKey, runId, {
    pollIntervalMs,
    timeoutMs: remainingTimeout(startedAt, timeoutMs),
    signal,
  });
}

export function createWebAgentTool(tracker: AgentRunTracker) {
  return defineTool<typeof WebAgentParamsSchema, WebAgentDetails>({
    name: 'web_agent_exa',
    label: 'Exa Agent',
    description:
      'Create an Exa Agent run for deep web research, list-building, enrichment, or structured multi-hop workflows. Supports foreground wait and background tracking.',
    promptSnippet: 'Run an Exa Agent research/list-building/enrichment workflow',
    promptGuidelines: [
      'Use web_agent_exa when the task needs multi-hop research, list building, row enrichment, or structured fields across many sources.',
      'Prefer normal search/answer/fetch tools for simple lookup. Use Agent only when it is clearly the better tool or recommend it to the user when the task fits.',
      'For structured output, provide outputSchema and bound arrays with maxItems so scope and contact-enrichment cost stay predictable.',
      'Use mode=background for long-running or expensive Agent work when the user does not need the result in the current turn.',
      'Completed foreground wait runs return the full Agent result payload, including structured output and grounding.',
      'After starting a background run, do not poll with web_agent_get_exa or web_agent_events_exa unless the user explicitly asks; pi-exa tracks the run and sends a compact follow-up when it completes.',
      'Treat background follow-ups as completion notices. Call web_agent_get_exa before answering with detailed findings from a background run.',
    ],
    parameters: WebAgentParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request = buildWebAgentRequest(params);
      const mode = params.mode ?? 'wait';
      const monitor = params.monitor ?? 'stream';

      try {
        return await withExaApiKey(ctx, async (apiKey) => {
          let run: ExaAgentRun;
          let timedOut = false;

          if (mode === 'background') {
            sendProgress(onUpdate, 'Starting Exa Agent run in background...');
            run = await createAgentRun(apiKey, request, signal);
            await tracker.track(run, { pollIntervalMs: params.pollIntervalMs }, ctx);
          } else if (monitor === 'poll') {
            const result = await waitWithPolling(apiKey, request, params, signal, onUpdate);
            run = result.run;
            timedOut = result.timedOut;
          } else {
            const result = await waitWithStreaming(apiKey, request, params, signal, onUpdate);
            run = result.run;
            timedOut = result.timedOut;
          }

          if (timedOut) await tracker.track(run, { pollIntervalMs: params.pollIntervalMs }, ctx);

          const output = await truncateToolOutput(
            formatAgentRunResponse(run, { timedOut, background: mode === 'background' }),
            'web-agent-exa',
            'Use web_agent_get_exa for the run ID, simplify outputSchema, reduce maxItems, or use mode=background. ',
            { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER },
          );

          return {
            content: [{ type: 'text', text: output.text }],
            details: {
              endpoint: '/agent/runs',
              request,
              response: run,
              requestId: run.id,
              count: countAgentSources(run.output?.grounding),
              costDollars: run.costDollars,
              preview: buildAgentRunPreview(run, output, {
                timedOut,
                background: mode === 'background',
              }),
              truncated: output.truncation.truncated,
              truncation: output.truncation,
              fullOutputPath: output.fullOutputPath,
              mode,
              monitor: mode === 'wait' ? monitor : undefined,
              timedOut,
            },
            isError: run.status === 'failed',
          };
        });
      } catch (error) {
        return errorResult(error);
      }
    },
    renderCall(args, theme) {
      const metadataArgs = args.mode === 'background' ? { ...args, monitor: undefined } : args;

      return renderExaCall(
        'web_agent_exa',
        `"${args.query}"`,
        theme,
        metadataFromArgs(metadataArgs, ['mode', 'monitor', 'effort', 'previousRunId']),
      );
    },
    renderResult(result, options, theme) {
      return renderExaResult(result, options, theme, 'Running Exa Agent...');
    },
  });
}
