import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtaEvent, EtaTaskRecord } from '../extensions/types';

const store = vi.hoisted(() => ({ events: [] as EtaEvent[] }));
vi.mock('../extensions/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../extensions/storage')>();
  return {
    ...actual,
    commitEtaEvent: async <T>(
      build: (state: ReturnType<typeof actual.buildEtaState>) => { event?: EtaEvent; value: T },
    ) => {
      const result = build(actual.buildEtaState(store.events));
      if (result.event) store.events.push(result.event);
      return result.value;
    },
  };
});

import { createEtaStartTool } from '../extensions/tools/eta-start';
import { createEtaUpdateTool } from '../extensions/tools/eta-update';
import { createEtaFinishTool } from '../extensions/tools/eta-finish';
import type { EtaSettingsStore } from '../extensions/settings';
import { buildEtaState } from '../extensions/storage';

const settings: EtaSettingsStore = {
  get: () => ({ verbose: false, calibrationMode: 'blended', profileSampleThreshold: 3 }),
  reload: async () => settings.get(),
  setVerbose: async () => settings.get(),
};

function context(sessionId = 'session'): ExtensionContext {
  return {
    cwd: '/tmp/project',
    model: { provider: 'test', id: 'model' },
    thinkingLevel: 'low',
    ui: { setStatus: vi.fn(), theme: { fg: (_color: string, text: string) => text } },
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => undefined },
  } as unknown as ExtensionContext;
}

describe('ETA lifecycle tools', () => {
  beforeEach(() => {
    store.events = [];
  });

  it('refreshes the current task and keeps the original estimate for calibration', async () => {
    const onChange = vi.fn<(ctx: ExtensionContext, record: EtaTaskRecord | undefined) => void>();
    const ctx = context();
    const started = await createEtaStartTool(settings, onChange).execute(
      'start',
      {
        taskSummary: 'Parent task',
        estimateMinutes: 4,
        delegatedTasks: [
          { taskSummary: 'Research', estimateMinutes: 2 },
          { taskSummary: 'Review', estimateMinutes: 3 },
        ],
      },
      new AbortController().signal,
      undefined,
      ctx,
    );
    expect(started.details.kind).toBe('start');
    const result = await createEtaUpdateTool(settings, onChange).execute(
      'update',
      {
        estimateMinutes: 2,
        delegatedTasks: [],
      },
      new AbortController().signal,
      undefined,
      ctx,
    );
    expect(result.details.kind).toBe('update');
    const state = buildEtaState(store.events);
    expect(state.records).toHaveLength(1);
    expect(state.records[0]!.estimate).toEqual({ lowMinutes: 4, highMinutes: 4 });
    expect(state.records[0]!.latestUpdate?.estimate).toEqual({ lowMinutes: 2, highMinutes: 2 });
    expect(state.records[0]!.delegatedTasks).toEqual([]);
    expect(onChange).toHaveBeenLastCalledWith(ctx, state.records[0]);
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('ETA updated.') },
    ]);
    expect(JSON.stringify(result.content)).not.toContain('lowMinutes');
    expect(JSON.stringify(result.content)).not.toContain('2m');
    await createEtaFinishTool(settings, onChange).execute(
      'finish',
      {},
      new AbortController().signal,
      undefined,
      ctx,
    );
    expect(onChange).toHaveBeenLastCalledWith(ctx, undefined);
  });

  it('does not modify or clear another session when an update fails', async () => {
    const ctx = context();
    const started = await createEtaStartTool(settings).execute(
      'start',
      {
        taskSummary: 'Parent task',
        estimateMinutes: 4,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );
    if (started.details.kind !== 'start') throw new Error('Start failed');
    const onChange = vi.fn();
    const updateTool = createEtaUpdateTool(settings, onChange);
    const crossSession = await updateTool.execute(
      'foreign',
      {
        taskId: started.details.taskId,
        estimateMinutes: 1,
      },
      new AbortController().signal,
      undefined,
      context('child'),
    );
    expect(crossSession.details.kind).toBe('error');
    const invalid = await updateTool.execute(
      'invalid',
      {
        estimateLowMinutes: 3,
        estimateHighMinutes: 2,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );
    expect(invalid.details.kind).toBe('error');
    const infinite = await updateTool.execute(
      'infinite',
      {
        estimateMinutes: Infinity,
      },
      new AbortController().signal,
      undefined,
      ctx,
    );
    expect(infinite.details.kind).toBe('error');
    expect(store.events).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects an update after completion and does not clear the current UI for an explicit foreign finish', async () => {
    const parent = context();
    const child = context('child');
    const parentStart = await createEtaStartTool(settings).execute(
      'parent',
      {
        taskSummary: 'Parent task',
        estimateMinutes: 4,
      },
      new AbortController().signal,
      undefined,
      parent,
    );
    const childStart = await createEtaStartTool(settings).execute(
      'child',
      {
        taskSummary: 'Child task',
        estimateMinutes: 2,
      },
      new AbortController().signal,
      undefined,
      child,
    );
    if (parentStart.details.kind !== 'start' || childStart.details.kind !== 'start')
      throw new Error('Start failed');
    const onChange = vi.fn();
    await createEtaFinishTool(settings, onChange).execute(
      'foreign-finish',
      {
        taskId: childStart.details.taskId,
      },
      new AbortController().signal,
      undefined,
      parent,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(buildEtaState(store.events).openRecords[0]!.taskId).toBe(parentStart.details.taskId);
    const result = await createEtaUpdateTool(settings, onChange).execute(
      'late',
      {
        taskId: childStart.details.taskId,
        estimateMinutes: 1,
      },
      new AbortController().signal,
      undefined,
      child,
    );
    expect(result.details.kind).toBe('error');
    expect(onChange).not.toHaveBeenCalled();
  });
});
