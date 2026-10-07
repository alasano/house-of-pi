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
import type { createEtaFinishTool } from '../extensions/tools/eta-finish';

async function setup(
  options: {
    sessionId?: string;
    provider?: string;
    hasUI?: boolean;
    mode?: ExtensionContext['mode'];
    activeTools?: string[];
  } = {},
) {
  let sessionId = options.sessionId ?? 'session';
  const activeTools = options.activeTools ?? [
    'read',
    'bash',
    'eta_start',
    'eta_update',
    'eta_finish',
  ];
  const handlers = new Map<string, (event: never, ctx: ExtensionContext) => unknown>();
  const background = new Map<string, (data: unknown) => void>();
  const tools = new Map<string, unknown>();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: ExtensionContext) => Promise<void> }
  >();
  const unsubscribers: ReturnType<typeof vi.fn>[] = [];
  const pi = {
    registerTool: (tool: { name: string }) => {
      tools.set(tool.name, tool);
    },
    registerCommand: (
      name: string,
      command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> },
    ) => {
      commands.set(name, command);
    },
    getActiveTools: () => activeTools,
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
    confirm: vi.fn(async () => true),
    notify: vi.fn(),
  };
  const ctx = {
    hasUI: options.hasUI ?? true,
    mode: options.mode ?? 'tui',
    cwd: '/tmp/project',
    model: { provider: options.provider ?? 'test', id: 'model' },
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
  const finish = tools.get('eta_finish') as ReturnType<typeof createEtaFinishTool>;
  const switchSession = (id: string) => {
    sessionId = id;
  };
  const widgetText = () => {
    const factory = ui.setWidget.mock.calls.at(-1)?.[1];
    return typeof factory === 'function' ? (factory().render(1000) as string[]).join('\n') : '';
  };
  return {
    emit,
    start,
    update,
    finish,
    ui,
    ctx,
    background,
    unsubscribers,
    tools,
    commands,
    activeTools,
    switchSession,
    widgetText,
  };
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

  it.each(['deepseek', 'openai'])(
    'uses the same bounded first-run reminders for a mock %s provider',
    async (provider) => {
      const h = await setup({ provider });
      await h.emit('before_agent_start', { systemPrompt: '' });
      expect(h.widgetText()).toContain('ETA pending · awaiting an agent estimate');
      expect(vi.getTimerCount()).toBe(0);
      await h.emit('agent_start');
      const first = (await h.emit('context', { messages: [] })) as {
        messages: { role: string; customType: string; display: boolean; content: string }[];
      };
      expect(first.messages[0]).toMatchObject({
        role: 'custom',
        customType: 'pi-eta-bootstrap',
        display: false,
      });
      expect(first.messages[0]!.content).toContain('Trivial immediate tasks may skip it');
      expect(first.messages[0]!.content).toContain("original user's requested task");
      const example = first.messages[0]!.content.match(/Valid JSON shape example: (\{.*?\})/)![1]!;
      expect(JSON.parse(example)).toEqual({
        taskSummary: 'Complete the requested work',
        estimateMinutes: 3,
      });
      // Repeated context refreshes without business work never reset bootstrap state.
      for (let index = 0; index < 3; index++)
        expect(await h.emit('context', { messages: [] })).toBeUndefined();
      await h.emit('tool_execution_end', { toolName: 'eta_check' });
      expect(await h.emit('context', { messages: [] })).toBeUndefined();
      await h.emit('tool_execution_end', { toolName: 'read' });
      const second = (await h.emit('context', { messages: first.messages })) as typeof first;
      expect(second.messages).toHaveLength(1);
      expect(second.messages[0]!.content).toContain('work remaining from now');
      expect(second.messages[0]!.content).toContain('Do not repeat completed work');
      expect(second.messages[0]!.content).toContain('last start reminder');
      expect(h.widgetText()).toContain('ETA pending · awaiting an agent estimate');
      for (let index = 0; index < 4; index++) {
        await h.emit('tool_execution_end', { toolName: 'bash' });
        expect(await h.emit('context', { messages: [] })).toBeUndefined();
      }
      const scrubbed = (await h.emit('context', { messages: second.messages })) as {
        messages: unknown[];
      };
      expect(scrubbed.messages).toEqual([]);
      expect(h.widgetText()).toContain('ETA no estimate supplied');
      expect(vi.getTimerCount()).toBe(0);
      await h.emit('agent_end');
      expect(h.ui.setStatus).toHaveBeenLastCalledWith('pi-eta', undefined);
      expect(h.ui.setWidget).toHaveBeenLastCalledWith('pi-eta', undefined);
      await h.emit('session_shutdown');
    },
  );

  it('closes bootstrap on successful start and finish, then rearms only on the next user run', async () => {
    const h = await setup();
    await h.emit('before_agent_start', { systemPrompt: '' });
    await h.emit('agent_start');
    await h.emit('context', { messages: [] });
    await h.start.execute(
      'start',
      { taskSummary: 'Remaining implementation', estimateLowMinutes: 3, estimateHighMinutes: 4 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    expect(h.widgetText()).toContain('ETA 3m – 4m remaining');
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    await h.finish.execute('finish', {}, new AbortController().signal, undefined, h.ctx);
    await h.emit('tool_execution_end', { toolName: 'read' });
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    expect(h.ui.setStatus).toHaveBeenLastCalledWith('pi-eta', undefined);
    expect(vi.getTimerCount()).toBe(0);
    await h.emit('agent_end');
    await h.emit('before_agent_start', { systemPrompt: '' });
    await h.emit('agent_start');
    expect(await h.emit('context', { messages: [] })).toBeDefined();
    expect(h.widgetText()).toContain('ETA pending · awaiting an agent estimate');
    await h.emit('session_shutdown');
  });

  it('retains existing ETA update reminders instead of bootstrapping an already-open task', async () => {
    const h = await setup();
    await h.emit('agent_start');
    await h.start.execute(
      'start',
      { taskSummary: 'Existing task', estimateMinutes: 4 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    await h.emit('agent_end');
    await h.emit('before_agent_start', { systemPrompt: '' });
    await h.emit('agent_start');
    const resumed = (await h.emit('context', { messages: [] })) as {
      messages: { customType: string; content: string }[];
    };
    expect(resumed.messages[0]!.customType).toBe('pi-eta-refresh');
    expect(resumed.messages[0]!.content).toContain('eta_update');
    expect(resumed.messages[0]!.content).not.toContain('Valid JSON shape example');
    await h.emit('session_shutdown');
  });

  it('shows inactive ETA as unavailable without start instructions and can resume if tools become active', async () => {
    const h = await setup({ activeTools: ['read', 'bash'] });
    const prompt = (await h.emit('before_agent_start', { systemPrompt: 'System prompt' })) as {
      systemPrompt: string;
    };
    expect(prompt.systemPrompt).toBe('System prompt');
    expect(h.widgetText()).toContain('ETA unavailable · eta_start is inactive');
    await h.emit('agent_start');
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    await h.emit('tool_execution_end', { toolName: 'read' });
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    h.activeTools.push('eta_start');
    expect(await h.emit('context', { messages: [] })).toBeDefined();
    expect(h.widgetText()).toContain('ETA pending · awaiting an agent estimate');
    await h.emit('session_shutdown');
  });

  it('still supplies normal context reminders without UI or a clock timer', async () => {
    const h = await setup({ hasUI: false });
    await h.emit('before_agent_start', { systemPrompt: '' });
    await h.emit('agent_start');
    expect(await h.emit('context', { messages: [] })).toBeDefined();
    await h.emit('tool_execution_end', { toolName: 'read' });
    expect(await h.emit('context', { messages: [] })).toBeDefined();
    expect(h.ui.setStatus).not.toHaveBeenCalled();
    expect(h.ui.setWidget).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await h.emit('session_shutdown');
  });

  it.each(['agent_end', 'session_shutdown', 'session_start'])(
    'cannot resurrect pending ETA when %s wins an asynchronous refresh',
    async (lifecycle) => {
      const h = await setup();
      await h.emit('before_agent_start', { systemPrompt: '' });
      await h.emit('agent_start');
      const state = buildEtaState([]);
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
      if (lifecycle === 'session_start') h.switchSession('other-session');
      await h.emit(lifecycle);
      resolve(state);
      expect(await pending).toBeUndefined();
      expect(h.ui.setStatus).toHaveBeenLastCalledWith('pi-eta', undefined);
      expect(h.ui.setWidget).toHaveBeenLastCalledWith('pi-eta', undefined);
      expect(vi.getTimerCount()).toBe(0);
      if (lifecycle !== 'session_shutdown') await h.emit('session_shutdown');
    },
  );

  it('latches reset closed rather than restarting pending ETA on later context calls', async () => {
    const h = await setup();
    await h.emit('before_agent_start', { systemPrompt: '' });
    await h.emit('agent_start');
    await h.emit('context', { messages: [] });
    await h.commands.get('eta')!.handler('reset', h.ctx);
    await h.emit('tool_execution_end', { toolName: 'read' });
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    expect(h.ui.setWidget).toHaveBeenLastCalledWith('pi-eta', undefined);
    await h.emit('session_shutdown');
  });

  it('keeps failed starts pending and lets an honest successful retry replace the pending UI', async () => {
    const h = await setup();
    await h.emit('before_agent_start', { systemPrompt: '' });
    await h.emit('agent_start');
    await h.emit('context', { messages: [] });
    const failed = await h.start.execute(
      'failed',
      { taskSummary: 'Task', estimateLowMinutes: 4, estimateHighMinutes: 2 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    expect(failed.details.kind).toBe('error');
    expect(failed).toMatchObject({ isError: true });
    await h.emit('tool_execution_end', { toolName: 'eta_start', isError: true, result: failed });
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    expect(h.widgetText()).toContain('ETA pending · awaiting an agent estimate');
    await h.start.execute(
      'retry',
      { taskSummary: 'Task', estimateMinutes: 3 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    expect(h.widgetText()).toContain('ETA 3m remaining');
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    await h.emit('session_shutdown');
  });

  it('marks ETA error details through the result hook without rewriting results or touching other tools', async () => {
    const h = await setup();
    for (const toolName of ['eta_check', 'eta_start', 'eta_update', 'eta_finish']) {
      const event = {
        toolName,
        content: [
          { type: 'text', text: 'ETA failed: invalid range. Correct the estimate and retry.' },
        ],
        details: { kind: 'error', message: 'Invalid range' },
        isError: false,
      };
      const original = structuredClone(event);
      expect(await h.emit('tool_result', event)).toEqual({ isError: true });
      expect(event).toEqual(original);
      expect(
        await h.emit('tool_result', { toolName, details: { kind: 'start' }, isError: false }),
      ).toBeUndefined();
    }
    expect(
      await h.emit('tool_result', { toolName: 'read', details: { kind: 'error' }, isError: false }),
    ).toBeUndefined();
    expect(
      await h.emit('tool_result', {
        toolName: 'eta_other',
        details: { kind: 'error' },
        isError: false,
      }),
    ).toBeUndefined();
    expect(
      await h.emit('tool_result', { toolName: 'eta_start', details: null, isError: false }),
    ).toBeUndefined();
    await h.emit('session_shutdown');
  });

  it('preserves an existing countdown when an accidental duplicate eta_start fails', async () => {
    const h = await setup();
    await h.emit('before_agent_start', { systemPrompt: '' });
    await h.emit('agent_start');
    await h.start.execute(
      'start',
      { taskSummary: 'Task', estimateMinutes: 4 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    const duplicate = await h.start.execute(
      'duplicate',
      { taskSummary: 'Second task', estimateMinutes: 2 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    expect(duplicate).toMatchObject({ isError: true, details: { kind: 'error' } });
    await h.emit('tool_execution_end', { toolName: 'eta_start', result: duplicate });
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    expect(h.widgetText()).toContain('ETA 4m remaining');
    expect(store.events).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    await h.emit('session_shutdown');
  });

  it.each([
    ['read', 'bash'],
    ['read', 'bash', 'eta_finish'],
  ])(
    'does not ask an open task to refresh when its update tool is inactive (%s)',
    async (...activeTools) => {
      const h = await setup();
      await h.emit('agent_start');
      await h.start.execute(
        'start',
        { taskSummary: 'Existing task', estimateMinutes: 4 },
        new AbortController().signal,
        undefined,
        h.ctx,
      );
      await h.emit('agent_end');
      h.activeTools.splice(0, h.activeTools.length, ...activeTools);
      const prompt = (await h.emit('before_agent_start', { systemPrompt: 'Original prompt' })) as {
        systemPrompt: string;
      };
      expect(prompt.systemPrompt).not.toContain('eta_start');
      expect(prompt.systemPrompt).not.toContain('eta_update');
      if (!activeTools.includes('eta_finish'))
        expect(prompt.systemPrompt).not.toContain('eta_finish');
      await h.emit('agent_start');
      expect(await h.emit('context', { messages: [] })).toBeUndefined();
      expect(h.widgetText()).toContain('ETA 4m remaining · update unavailable');
      vi.advanceTimersByTime(120_000);
      expect(await h.emit('context', { messages: [] })).toBeUndefined();
      expect(h.widgetText()).toContain('ETA 2m remaining · update unavailable');
      expect(vi.getTimerCount()).toBe(1);
      await h.emit('session_shutdown');
    },
  );

  it('retains an overdue refresh until update is reactivated and omits an inactive finish tool', async () => {
    const h = await setup();
    await h.emit('agent_start');
    await h.start.execute(
      'start',
      { taskSummary: 'Existing task', estimateMinutes: 4 },
      new AbortController().signal,
      undefined,
      h.ctx,
    );
    await h.emit('agent_end');
    h.activeTools.splice(0, h.activeTools.length, 'read', 'bash');
    await h.emit('before_agent_start', { systemPrompt: '' });
    await h.emit('agent_start');
    vi.advanceTimersByTime(120_000);
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    h.activeTools.push('eta_update');
    const resumed = (await h.emit('context', { messages: [] })) as {
      messages: { content: string }[];
    };
    expect(resumed.messages[0]!.content).toContain('eta_update');
    expect(resumed.messages[0]!.content).not.toContain('eta_finish');
    expect(await h.emit('context', { messages: [] })).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
    await h.emit('session_shutdown');
  });

  it('includes only active ETA tool rules in the system prompt', async () => {
    const h = await setup({ activeTools: ['read', 'eta_start'] });
    const prompt = (await h.emit('before_agent_start', { systemPrompt: 'Original prompt' })) as {
      systemPrompt: string;
    };
    expect(prompt.systemPrompt).toContain('eta_start');
    expect(prompt.systemPrompt).not.toContain('eta_update');
    expect(prompt.systemPrompt).not.toContain('eta_finish');
    expect(prompt.systemPrompt).not.toContain('Never leave a timer running');
    expect(prompt.systemPrompt).not.toContain('eta_check');
    await h.emit('agent_start');
    expect(await h.emit('context', { messages: [] })).toBeDefined();
    await h.emit('session_shutdown');
  });
});
