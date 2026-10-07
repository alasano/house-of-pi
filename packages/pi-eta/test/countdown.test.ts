import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countdownLabel,
  EtaCountdown,
  nextEtaRefreshAt,
  remainingEtaRange,
} from '../extensions/countdown';
import type { EtaTaskRecord } from '../extensions/types';

const startedAt = '2026-01-01T00:00:00.000Z';
const start = Date.parse(startedAt);

function task(options: Partial<EtaTaskRecord> = {}): EtaTaskRecord {
  return {
    taskId: 'parent-task',
    taskSummary: 'Implement and verify',
    estimate: { lowMinutes: 10, highMinutes: 12 },
    model: { provider: 'test', id: 'model', key: 'test/model' },
    project: { cwd: '/tmp/project', name: 'project' },
    sessionId: 'session',
    startedAt,
    mixedProfile: false,
    ...options,
  };
}

function context(sessionId = 'session', hasUI = true, mode: ExtensionContext['mode'] = 'tui') {
  const ui = {
    setStatus: vi.fn(),
    setWidget: vi.fn(),
    theme: { fg: (_color: string, value: string) => value },
  };
  const ctx = {
    hasUI,
    mode,
    ui,
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => `/tmp/${sessionId}.jsonl`,
    },
  } as unknown as ExtensionContext;
  const widgetText = () => {
    const factory = ui.setWidget.mock.calls.at(-1)?.[1];
    return typeof factory === 'function' ? (factory().render(1000) as string[]).join('\n') : '';
  };
  return { ctx, ui, widgetText };
}

describe('live ETA countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });
  afterEach(() => vi.useRealTimers());

  it('requests updates periodically before the first deadline and deduplicates normal turns', () => {
    const clock = new EtaCountdown();
    const { ctx, ui, widgetText } = context();
    clock.resume();
    clock.sync(ctx, task());
    expect(nextEtaRefreshAt(task())).toBe(start + 120_000);
    vi.advanceTimersByTime(119_000);
    expect(clock.takeReminder()).toBeUndefined();
    vi.advanceTimersByTime(1_000);
    const reminder = clock.takeReminder();
    expect(reminder).toContain('eta_update');
    expect(reminder).toContain('subagent');
    expect(reminder).not.toContain('10');
    expect(reminder).not.toContain('12');
    expect(clock.takeReminder()).toBeUndefined();
    // Reloading the durable record at each context call cannot re-arm the same reminder.
    clock.sync(ctx, task());
    expect(clock.takeReminder()).toBeUndefined();
    expect(widgetText()).toContain('ETA 8m – 10m remaining');
    expect(ui.setStatus.mock.calls.every((call) => call[1] === undefined)).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(clock.takeReminder()).toContain('eta_update');
    clock.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes short calibrated estimates halfway through rather than waiting for zero', () => {
    const record = task({ calibratedRange: { lowMinutes: 1, highMinutes: 2 } });
    expect(nextEtaRefreshAt(record)).toBe(start + 30_000);
    expect(remainingEtaRange(record, start + 45_000)).toEqual({
      lowMinutes: 0.25,
      highMinutes: 1.25,
    });
    expect(countdownLabel(record, start + 61_000)).toContain('up to');
    expect(countdownLabel(record, start + 121_000)).toBe('ETA exceeded · update needed');
    expect(countdownLabel(record, start + 1_000_000)).not.toMatch(/-\d/);
  });

  it('uses a fresh remaining estimate without restarting the original task duration', () => {
    const clock = new EtaCountdown();
    const { ctx, ui, widgetText } = context();
    clock.resume();
    clock.sync(ctx, task());
    vi.advanceTimersByTime(120_000);
    clock.takeReminder();
    clock.sync(
      ctx,
      task({
        latestUpdate: {
          version: 1,
          eventId: 'revision-1',
          type: 'update',
          at: new Date(Date.now()).toISOString(),
          taskId: 'parent-task',
          sessionId: 'session',
          estimate: { lowMinutes: 3, highMinutes: 3 },
          calibratedRange: { lowMinutes: 1, highMinutes: 1 },
          updatedAt: new Date(Date.now()).toISOString(),
        },
      }),
    );
    expect(widgetText()).toContain('ETA 1m remaining');
    expect(ui.setWidget.mock.calls.at(-1)?.[2]).toEqual({ placement: 'belowEditor' });
    expect(clock.takeReminder()).toBeUndefined();
    vi.advanceTimersByTime(30_000);
    expect(clock.takeReminder()).toContain('eta_update');
    clock.stop();
  });

  it('pauses when the agent stops, requests a new estimate on resume, and clears on finish', () => {
    const clock = new EtaCountdown();
    const { ctx, ui, widgetText } = context();
    clock.resume();
    clock.sync(ctx, task());
    clock.pause();
    expect(vi.getTimerCount()).toBe(0);
    expect(widgetText()).toContain('ETA paused · re-estimate on resume');
    vi.advanceTimersByTime(3_600_000);
    expect(clock.takeReminder()).toBeUndefined();
    clock.resume();
    expect(clock.takeReminder()).toContain('eta_update');
    clock.sync(ctx, undefined);
    expect(vi.getTimerCount()).toBe(0);
    expect(ui.setWidget).toHaveBeenLastCalledWith('pi-eta', undefined);
    expect(clock.takeReminder()).toBeUndefined();
    clock.stop();
  });

  it('keeps waiting for background subagents through parent agent_end, filtering other sessions', () => {
    const clock = new EtaCountdown();
    const { ctx } = context();
    clock.resume();
    clock.sync(ctx, task());
    clock.backgroundStarted('foreign', '/tmp/other.jsonl');
    clock.pause();
    expect(vi.getTimerCount()).toBe(0);
    clock.resume();
    clock.backgroundStarted('root-run', '/tmp/session.jsonl');
    clock.backgroundStarted('child-run', 'session');
    clock.pause();
    expect(vi.getTimerCount()).toBe(1);
    clock.backgroundCompleted('foreign');
    expect(vi.getTimerCount()).toBe(1);
    clock.backgroundCompleted('child-run');
    expect(vi.getTimerCount()).toBe(1);
    clock.backgroundCompleted('root-run');
    expect(vi.getTimerCount()).toBe(0);
    clock.resume();
    expect(clock.takeReminder()).toContain('eta_update');
    clock.stop();
  });

  it('does not display another session or allocate a UI timer in print mode', () => {
    const clock = new EtaCountdown();
    const { ctx, ui } = context();
    clock.resume();
    clock.sync(ctx, task());
    const calls = ui.setStatus.mock.calls.length;
    clock.sync(ctx, task({ sessionId: 'child-session', taskId: 'child' }));
    expect(ui.setStatus).toHaveBeenCalledTimes(calls);
    const other = context('other');
    clock.sync(other.ctx, task({ sessionId: 'other' }));
    expect(ui.setWidget).toHaveBeenLastCalledWith('pi-eta', undefined);
    clock.stop();
    expect(vi.getTimerCount()).toBe(0);

    const print = context('session', false);
    clock.resume();
    clock.sync(print.ctx, task());
    vi.advanceTimersByTime(120_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(print.ui.setStatus).not.toHaveBeenCalled();
    expect(clock.takeReminder()).toContain('eta_update');
    clock.stop();
  });

  it('renders at most two width-bounded lines with a small subagent estimate breakdown', () => {
    const clock = new EtaCountdown();
    const { ctx, ui } = context();
    clock.resume();
    clock.sync(
      ctx,
      task({
        taskSummary: 'Implement\nwith validation',
        delegatedTasks: [
          { taskSummary: 'Research', estimateMinutes: 2 },
          { taskSummary: 'Tests', estimateMinutes: 1 },
          { taskSummary: 'Review', estimateMinutes: 1 },
        ],
      }),
    );
    const factory = ui.setWidget.mock.calls.at(-1)![1];
    const lines = factory().render(120) as string[];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Implement with validation');
    expect(lines[1]).toContain('Research ~2m; Tests ~1m; +1 more');
    expect(
      factory()
        .render(20)
        .every((line: string) => visibleWidth(line) <= 20),
    ).toBe(true);
    clock.stop();
  });

  it('shows every TUI state only in the detailed widget below the editor, clearing any old footer status', () => {
    const clock = new EtaCountdown();
    const { ctx, ui, widgetText } = context();
    for (const status of ['pending', 'unavailable', 'missing'] as const) {
      clock.setBootstrapStatus(ctx, status);
      expect(widgetText()).toContain('ETA');
      expect(vi.getTimerCount()).toBe(0);
    }
    clock.resume();
    clock.sync(ctx, task({ delegatedTasks: [{ taskSummary: 'Research', estimateMinutes: 2 }] }));
    expect(widgetText()).toContain('Implement and verify');
    expect(widgetText()).toContain('Subagents (latest estimates): Research ~2m');
    clock.setUpdateAvailable(false);
    expect(widgetText()).toContain('update unavailable');
    expect(ui.setStatus.mock.calls.every((call) => call[1] === undefined)).toBe(true);
    const widgets = ui.setWidget.mock.calls.filter((call) => call[1] !== undefined);
    expect(widgets.every((call) => call[2]?.placement === 'belowEditor')).toBe(true);
    clock.stop();
    expect(ui.setWidget).toHaveBeenLastCalledWith('pi-eta', undefined);
    expect(ui.setStatus).toHaveBeenLastCalledWith('pi-eta', undefined);
  });

  it('uses only the supported status fallback in RPC, without a component widget', () => {
    const clock = new EtaCountdown();
    const { ctx, ui } = context('session', true, 'rpc');
    clock.setBootstrapStatus(ctx, 'pending');
    expect(ui.setStatus).toHaveBeenLastCalledWith(
      'pi-eta',
      'ETA pending · awaiting an agent estimate',
    );
    clock.resume();
    clock.sync(ctx, task());
    expect(ui.setStatus).toHaveBeenLastCalledWith('pi-eta', 'ETA 10m – 12m remaining');
    vi.advanceTimersByTime(1000);
    expect(ui.setStatus).toHaveBeenLastCalledWith('pi-eta', 'ETA 9m59s – 11m59s remaining');
    expect(ui.setWidget).not.toHaveBeenCalled();
    clock.stop();
    expect(ui.setWidget).not.toHaveBeenCalled();
    expect(ui.setStatus).toHaveBeenLastCalledWith('pi-eta', undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
});
