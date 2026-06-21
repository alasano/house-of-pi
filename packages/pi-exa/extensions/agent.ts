import {
  ExaApiError,
  exaDelete,
  exaGet,
  exaPost,
  exaRawRequest,
  parseResponseBody,
} from './client';
import type {
  ExaAgentEvent,
  ExaAgentEventListResponse,
  ExaAgentRun,
  ExaAgentRunListResponse,
  ExaDeletedAgentRun,
  JsonObject,
} from './types';
import { isRecord } from './util';

export const TERMINAL_AGENT_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export interface ExaAgentCreateRequest {
  query: string;
  systemPrompt?: string;
  input?: {
    data?: JsonObject[];
    exclusion?: JsonObject[];
  };
  outputSchema?: JsonObject;
  effort?: string;
  previousRunId?: string;
  metadata?: Record<string, string>;
}

export interface ExaAgentPaginationParams {
  limit?: number;
  cursor?: string;
  [key: string]: string | number | undefined;
}

export interface ExaAgentEventReplayParams {
  lastEventId?: string;
}

export interface AgentPollOptions {
  pollIntervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onPoll?: (run: ExaAgentRun) => void;
}

export interface AgentPollResult {
  run: ExaAgentRun;
  timedOut: boolean;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Operation aborted.'));
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new Error('Operation aborted.'));
      },
      { once: true },
    );
  });
}

function parseSsePart(part: string): ExaAgentEvent | undefined {
  const event: Partial<ExaAgentEvent> = {};
  const dataLines: string[] = [];

  for (const line of part.split('\n')) {
    if (!line || !line.includes(':')) continue;
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').replace(/^ /, '');

    if (field === 'id') event.id = value;
    if (field === 'event') event.event = value;
    if (field === 'data') dataLines.push(value);
  }

  if (!event.event || dataLines.length === 0) return undefined;

  const data = dataLines.join('\n');
  try {
    const parsed = JSON.parse(data);
    event.data = isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    event.data = { value: data };
  }

  return event as ExaAgentEvent;
}

export function isTerminalAgentStatus(status: unknown): boolean {
  return TERMINAL_AGENT_STATUSES.includes(status as (typeof TERMINAL_AGENT_STATUSES)[number]);
}

export function getRunIdFromAgentEvent(event: ExaAgentEvent): string | undefined {
  if (typeof event.data.id === 'string') return event.data.id;
  if (isRecord(event.data.run) && typeof event.data.run.id === 'string') return event.data.run.id;
  if (typeof event.data.runId === 'string') return event.data.runId;
  return undefined;
}

export async function createAgentRun(
  apiKey: string,
  request: ExaAgentCreateRequest,
  signal?: AbortSignal,
): Promise<ExaAgentRun> {
  return exaPost<ExaAgentRun>(apiKey, '/agent/runs', request, signal);
}

export async function getAgentRun(
  apiKey: string,
  runId: string,
  signal?: AbortSignal,
): Promise<ExaAgentRun> {
  return exaGet<ExaAgentRun>(apiKey, `/agent/runs/${encodeURIComponent(runId)}`, undefined, signal);
}

export async function listAgentRuns(
  apiKey: string,
  params: ExaAgentPaginationParams,
  signal?: AbortSignal,
): Promise<ExaAgentRunListResponse> {
  return exaGet<ExaAgentRunListResponse>(apiKey, '/agent/runs', params, signal);
}

export async function cancelAgentRun(
  apiKey: string,
  runId: string,
  signal?: AbortSignal,
): Promise<ExaAgentRun> {
  return exaPost<ExaAgentRun>(
    apiKey,
    `/agent/runs/${encodeURIComponent(runId)}/cancel`,
    undefined,
    signal,
  );
}

export async function deleteAgentRun(
  apiKey: string,
  runId: string,
  signal?: AbortSignal,
): Promise<ExaDeletedAgentRun> {
  return exaDelete<ExaDeletedAgentRun>(apiKey, `/agent/runs/${encodeURIComponent(runId)}`, signal);
}

export async function listAgentRunEvents(
  apiKey: string,
  runId: string,
  params: ExaAgentPaginationParams,
  signal?: AbortSignal,
): Promise<ExaAgentEventListResponse> {
  return exaGet<ExaAgentEventListResponse>(
    apiKey,
    `/agent/runs/${encodeURIComponent(runId)}/events`,
    params,
    signal,
  );
}

async function* streamAgentEventsFromResponse(response: Response): AsyncGenerator<ExaAgentEvent> {
  if (!response.body) throw new Error('No response body for Exa Agent event stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const event = parseSsePart(part);
        if (event) yield event;
      }
    }

    if (buffer.trim()) {
      const event = parseSsePart(buffer.trim());
      if (event) yield event;
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function* streamAgentRunEvents(
  apiKey: string,
  request: ExaAgentCreateRequest,
  signal?: AbortSignal,
): AsyncGenerator<ExaAgentEvent> {
  const response = await exaRawRequest(apiKey, '/agent/runs', {
    method: 'POST',
    body: request,
    headers: { Accept: 'text/event-stream' },
    signal,
  });

  if (!response.ok) {
    const responseBody = await parseResponseBody(response);
    throw new ExaApiError(
      `Exa API request failed: ${
        isRecord(responseBody) && typeof responseBody.message === 'string'
          ? responseBody.message
          : `${response.status} ${response.statusText}`
      }`,
      response.status,
      responseBody,
    );
  }

  if (!response.body) throw new Error('No response body for Exa Agent event stream.');

  yield* streamAgentEventsFromResponse(response);
}

export async function* replayAgentRunEvents(
  apiKey: string,
  runId: string,
  params: ExaAgentEventReplayParams = {},
  signal?: AbortSignal,
): AsyncGenerator<ExaAgentEvent> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (params.lastEventId) headers['Last-Event-ID'] = params.lastEventId;

  const response = await exaRawRequest(apiKey, `/agent/runs/${encodeURIComponent(runId)}/events`, {
    method: 'GET',
    headers,
    signal,
  });

  if (!response.ok) {
    const responseBody = await parseResponseBody(response);
    throw new ExaApiError(
      `Exa API request failed: ${
        isRecord(responseBody) && typeof responseBody.message === 'string'
          ? responseBody.message
          : `${response.status} ${response.statusText}`
      }`,
      response.status,
      responseBody,
    );
  }

  yield* streamAgentEventsFromResponse(response);
}

export async function pollAgentRunUntilFinished(
  apiKey: string,
  runId: string,
  options: AgentPollOptions,
): Promise<AgentPollResult> {
  const start = Date.now();
  let run = await getAgentRun(apiKey, runId, options.signal);
  options.onPoll?.(run);

  while (!isTerminalAgentStatus(run.status)) {
    if (Date.now() - start >= options.timeoutMs) {
      return { run, timedOut: true };
    }

    await sleep(options.pollIntervalMs, options.signal);
    run = await getAgentRun(apiKey, runId, options.signal);
    options.onPoll?.(run);
  }

  return { run, timedOut: false };
}
