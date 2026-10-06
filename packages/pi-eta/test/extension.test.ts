import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtaEvent } from '../extensions/types';

const store = vi.hoisted(() => ({ events: [] as EtaEvent[] }));
vi.mock('../extensions/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../extensions/storage')>();
  return {
    ...actual,
    readEtaState: vi.fn(async () => actual.buildEtaState(store.events)),
    appendEtaEvent: async (event: EtaEvent) => {
      store.events.push(event);
    },
    commitEtaEvent: async <T>(
      build: (state: ReturnType<typeof actual.buildEtaState>) => { event?: EtaEvent; value: T },
    ) => {
      const result = build(actual.buildEtaState(store.events));
      if (result.event) store.events.push(result.event);
      return result.value;
    },
  };
});
vi.mock('../extensions/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../extensions/settings')>();
  return {
    ...actual,
    createEtaSettingsStore: async () => ({
      get: () => ({ verbose: false, calibrationMode: 'blended', profileSampleThreshold: 3 }),
    }),
  };
});

import etaExtension, { appendEtaPrompt } from '../extensions/index';
import { readEtaState, buildEtaState } from '../extensions/storage';
import type { createEtaStartTool } from '../extensions/tools/eta-start';
import type { createEtaUpdateTool } from '../extensions/tools/eta-update';

async function setup(sessionId = 'session') {
  const handlers = new Map<string, (event: never, ctx: ExtensionContext) => unknown>();
  const background = new Map<string, (data: unknown) => void>();
  const tools = new Map<string, unknown>();
  const unsubscribers: ReturnType<typeof vi.fn>[] = [];
  const pi = {
    registerTool: (tool: { name: string }) => {
      tools.set(tool.name, tool);
    },
    registerCommand: vi.fn(),
    on: (event: string, handler: (event: never, ctx: ExtensionContext) => unknown) => {
      handlers.set(event, handler);
    },
    events: {
      on: (event: string, handler: (data: unknown) => void) => {
        background.set(event, handler);
        const unsubscribe = vi.fn(() => background.delete(event));
        unsubscribers.push(unsubscribe);
        return unsubscribe;
      },
    },
  } as unknown as ExtensionAPI;
  const ui = {
    theme: { fg: (_color: string, text: string) => text },
    setStatus: vi.fn(),
    setWidget: vi.fn(),
  };
  const ctx = {
    hasUI: true,
    cwd: '/tmp/project',
    model: { provider: 'test', id: 'model' },
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => `/tmp/${sessionId}.jsonl`,
    },
    ui,
  } as unknown as ExtensionContext;
  await etaExtension(pi);
  const emit = async (event: string, data: unknown = {}) =>
    handlers.get(event)!(data as never, ctx);
  const start = tools.get('eta_start') as ReturnType<typeof createEtaStartTool>;
  const update = tools.get('eta_update') as ReturnType<typeof createEtaUpdateTool>;
  return { emit, start, update, ui, ctx, background, unsubscribers, tools };
}

describe('ETA extension lifecycle', () => {
  beforeEach(() => {
    store.events = [];
    vi.useFakeTimers();
    vi.setSystemTime('2026-01-01T00:00:00.000Z');
  });
  afterEach(() => {
    vi.mocked(readEtaState).mockReset();
    vi.mocked(readEtaState).mockImplementation(async () => buildEtaState(store.events));
    vi.useRealTimers();
  });

  it('registers remaining-work updates and requests them through hidden normal context only', async () => {
    const h = await setup();
    expect(h.tools.has('eta_update')).toBe(true);
    const prompt = appendEtaPrompt('System prompt');
    expect(prompt).toContain('more than about one minute');
    expect(prompt).toContain('longest critical path');
    expect(prompt).toContain('delegated agents');
    await h.emit('before_agent_start', { systemPrompt: '' });
    await h.emit('agent_start');
    await h.start.execute(
      'start',
      { taskSummary: 'Parent task', estimateMinutes: 4 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    vi.advanceTimersByTime(120_000);
    // UI ticks paint only; the reminder appears when the next real LLM call happens.
    const result = (await h.emit('context', { messages: [] })) as {
      messages: { role: string; display: boolean; content: string }[];
    };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe('custom');
    expect(result.messages[0]!.display).toBe(false);
    expect(result.messages[0]!.content).toContain('eta_update');
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    await h.update.execute(
      'update',
      { estimateMinutes: 1 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    vi.advanceTimersByTime(30_000);
    expect(await h.emit('context', { messages: [] })).toBeDefined();
    await h.emit('session_shutdown');
    expect(vi.getTimerCount()).toBe(0);
    expect(h.ui.setWidget).toHaveBeenLastCalledWith('pi-eta', undefined);
    expect(h.unsubscribers.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('keeps async child work visible after the parent turn and pauses after the last matching completion', async () => {
    const h = await setup();
    await h.emit('agent_start');
    await h.start.execute(
      'start',
      { taskSummary: 'Parent task', estimateMinutes: 4 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    h.background.get('subagent:async-started')!({ id: 'foreign', sessionId: '/tmp/other.jsonl' });
    await h.emit('agent_end');
    expect(vi.getTimerCount()).toBe(0);
    await h.emit('agent_start');
    h.background.get('subagent:async-started')!({ id: 'child', sessionId: '/tmp/session.jsonl' });
    await h.emit('agent_end');
    expect(vi.getTimerCount()).toBe(1);
    h.background.get('subagent:async-complete')!({ runId: 'foreign' });
    expect(vi.getTimerCount()).toBe(1);
    h.background.get('subagent:async-complete')!({ runId: 'child' });
    expect(vi.getTimerCount()).toBe(0);
    await h.emit('agent_start');
    expect(await h.emit('context', { messages: [] })).toBeDefined();
    await h.emit('session_shutdown');
  });

  it('does not resurrect a widget if session shutdown wins an in-flight state refresh', async () => {
    const h = await setup();
    await h.emit('agent_start');
    await h.start.execute(
      'start',
      { taskSummary: 'Parent task', estimateMinutes: 4 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    const state = buildEtaState(store.events);
    let resolve: (value: typeof state) => void = () => {
      throw new Error('Refresh not started');
    };
    vi.mocked(readEtaState).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = h.emit('context', { messages: [] });
    await h.emit('session_shutdown');
    resolve(state);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    expect(h.ui.setWidget).toHaveBeenLastCalledWith('pi-eta', undefined);
  });
});
