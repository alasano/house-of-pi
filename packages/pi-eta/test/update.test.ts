import { describe, expect, it } from 'vitest';
import { buildEtaState, parseEtaEvent } from '../extensions/storage';
import { buildCalibrationSnapshot } from '../extensions/stats';
import type { EtaEvent, EtaStartEvent, EtaUpdateEvent } from '../extensions/types';

const model = { provider: 'test', id: 'model', key: 'test/model' };
const start: EtaStartEvent = {
  version: 1,
  eventId: 'start',
  type: 'start',
  at: '2026-01-01T00:00:00.000Z',
  taskId: 'task',
  taskSummary: 'Parent task',
  estimate: { lowMinutes: 10, highMinutes: 10 },
  model,
  project: { cwd: '/tmp/project', name: 'project' },
  sessionId: 'session',
  startedAt: '2026-01-01T00:00:00.000Z',
};
const update: EtaUpdateEvent = {
  version: 1,
  eventId: 'update',
  type: 'update',
  at: '2026-01-01T00:02:00.000Z',
  taskId: 'task',
  sessionId: 'session',
  estimate: { lowMinutes: 1, highMinutes: 2 },
  calibratedRange: { lowMinutes: 0.5, highMinutes: 1 },
  updatedAt: '2026-01-01T00:02:00.000Z',
};
const finish: EtaEvent = {
  version: 1,
  eventId: 'finish',
  type: 'finish',
  at: '2026-01-01T00:05:00.000Z',
  taskId: 'task',
  sessionId: 'session',
  model,
  project: start.project,
  outcome: 'completed',
  finishedAt: '2026-01-01T00:05:00.000Z',
};

describe('remaining-work ETA event history', () => {
  it('round-trips new updates and keeps pre-update logs backward compatible', () => {
    expect(parseEtaEvent(update)).toEqual(update);
    const legacy = buildEtaState([start]);
    expect(legacy.records[0]!.latestUpdate).toBeUndefined();
    expect(legacy.openRecords).toHaveLength(1);
    const updated = buildEtaState([start, update]);
    expect(updated.records[0]!.estimate).toEqual(start.estimate);
    expect(updated.records[0]!.latestUpdate).toEqual(update);
  });

  it('trains only on the original estimate even after remaining estimates change', () => {
    const state = buildEtaState([start, update, finish]);
    expect(state.trainingRecords).toHaveLength(1);
    expect(state.trainingRecords[0]!.actualWallMs).toBe(300_000);
    expect(buildCalibrationSnapshot(state, model, undefined).global.multiplier).toBeCloseTo(0.5);
  });

  it('ignores orphan, cross-session, and post-finish updates', () => {
    const state = buildEtaState([
      { ...update, eventId: 'orphan' },
      start,
      { ...update, eventId: 'foreign', sessionId: 'other' },
      update,
      finish,
      { ...update, eventId: 'late' },
    ]);
    expect(state.records[0]!.latestUpdate?.eventId).toBe('update');
  });

  it('records subagent estimates without summing parallel work and clears completed children', () => {
    const delegatedTasks = [
      { taskSummary: 'Research', estimateMinutes: 2 },
      { taskSummary: 'Review', estimateMinutes: 3 },
    ];
    const initial = { ...start, estimate: { lowMinutes: 4, highMinutes: 4 }, delegatedTasks };
    expect(parseEtaEvent(initial)).toEqual(initial);
    expect(buildEtaState([initial, update]).records[0]!.delegatedTasks).toEqual(delegatedTasks);
    const cleared = buildEtaState([
      initial,
      update,
      { ...update, eventId: 'cleared', delegatedTasks: [] },
    ]);
    expect(cleared.records[0]!.estimate).toEqual({ lowMinutes: 4, highMinutes: 4 });
    expect(cleared.records[0]!.delegatedTasks).toEqual([]);
  });

  it('rejects malformed updates instead of showing an invalid clock', () => {
    expect(parseEtaEvent({ ...update, updatedAt: 'bad-date' })).toBeUndefined();
    expect(
      parseEtaEvent({ ...update, estimate: { lowMinutes: -1, highMinutes: 2 } }),
    ).toBeUndefined();
    expect(
      parseEtaEvent({ ...update, estimate: { lowMinutes: 3, highMinutes: 2 } }),
    ).toBeUndefined();
    expect(
      parseEtaEvent({ ...update, estimate: { lowMinutes: Infinity, highMinutes: Infinity } }),
    ).toBeUndefined();
  });
});
