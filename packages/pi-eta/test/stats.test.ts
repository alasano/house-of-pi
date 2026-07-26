import { describe, expect, it } from 'vitest';
import { buildEtaState, parseEtaEvent } from '../extensions/storage';
import {
  DURATION_MIN_SAMPLES,
  buildCalibrationSnapshot,
  calculateCalibrationStats,
  calculateSizeBands,
  calibrateRange,
  fitDurationModel,
  sizeAdjustmentFactor,
} from '../extensions/stats';
import type {
  CompletedEtaRecord,
  EtaEvent,
  EtaModelInfo,
  EtaProjectInfo,
  EtaState,
} from '../extensions/types';

const model: EtaModelInfo = {
  provider: 'test',
  id: 'model',
  key: 'test/model',
};

const otherModel: EtaModelInfo = {
  provider: 'test',
  id: 'other-model',
  key: 'test/other-model',
};

const project: EtaProjectInfo = {
  cwd: '/tmp/project',
  name: 'project',
};

function completedRecord(
  taskId: string,
  estimateMinutes: number,
  actualMinutes: number,
  options: {
    model?: EtaModelInfo;
    thinkingLevel?: string;
    mixedProfile?: boolean;
  } = {},
): CompletedEtaRecord {
  const recordModel = options.model ?? model;
  const startedAt = '2026-01-01T00:00:00.000Z';
  const finishedAt = new Date(Date.parse(startedAt) + actualMinutes * 60000).toISOString();
  return {
    taskId,
    taskSummary: taskId,
    estimate: { lowMinutes: estimateMinutes, highMinutes: estimateMinutes },
    model: recordModel,
    ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
    project,
    sessionId: 'session',
    startedAt,
    mixedProfile: options.mixedProfile ?? false,
    finish: {
      version: 1,
      eventId: `finish-${taskId}`,
      type: 'finish',
      at: finishedAt,
      taskId,
      outcome: 'completed',
      model: recordModel,
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      project,
      sessionId: 'session',
      finishedAt,
      actualWallMs: actualMinutes * 60000,
    },
    actualWallMs: actualMinutes * 60000,
  };
}

function stateWithTraining(trainingRecords: CompletedEtaRecord[]): EtaState {
  return {
    events: [],
    checks: [],
    records: trainingRecords,
    openRecords: [],
    closedRecords: trainingRecords,
    completedRecords: trainingRecords,
    trainingRecords,
    resetCount: 0,
  };
}

describe('pi-eta calibration stats', () => {
  it('uses the median log ratio as the multiplier', () => {
    const records = [
      completedRecord('a', 100, 5),
      completedRecord('b', 100, 6),
      completedRecord('c', 100, 7),
    ];

    const stats = calculateCalibrationStats(records, 'global');

    expect(stats.sampleCount).toBe(3);
    expect(stats.multiplier).toBeCloseTo(0.06, 6);
  });

  it('handles estimate ranges through the geometric midpoint', () => {
    const record = completedRecord('range', 1, 60);
    record.estimate = { lowMinutes: 60, highMinutes: 240 };

    const stats = calculateCalibrationStats([record], 'global');

    expect(stats.multiplier).toBeCloseTo(0.5, 6);
  });
});

describe('pi-eta profile hierarchy', () => {
  const profileRecords = Array.from({ length: 4 }, (_, index) =>
    completedRecord(`profile-${index}`, 100, 25, { thinkingLevel: 'xhigh' }),
  );
  const otherLevelRecords = Array.from({ length: 6 }, (_, index) =>
    completedRecord(`level-${index}`, 100, 50, { thinkingLevel: 'low' }),
  );
  const otherModelRecords = Array.from({ length: 20 }, (_, index) =>
    completedRecord(`global-${index}`, 100, 20, { model: otherModel, thinkingLevel: 'xhigh' }),
  );
  const state = stateWithTraining([...profileRecords, ...otherLevelRecords, ...otherModelRecords]);

  it('partitions evidence into three disjoint strata that sum to global', () => {
    const snapshot = buildCalibrationSnapshot(state, model, 'xhigh');

    expect(snapshot.profile.sampleCount).toBe(4);
    expect(snapshot.modelOtherLevels.sampleCount).toBe(6);
    expect(snapshot.otherModels.sampleCount).toBe(20);
    expect(
      snapshot.profile.sampleCount +
        snapshot.modelOtherLevels.sampleCount +
        snapshot.otherModels.sampleCount,
    ).toBe(snapshot.global.sampleCount);
  });

  it('shrinks the profile toward its model and then toward other models', () => {
    const snapshot = buildCalibrationSnapshot(state, model, 'xhigh');

    // Other models contribute at most 10 prior samples to the model layer.
    const modelWeightWithinParent = 6 / (6 + 10);
    const parentLogRatio =
      modelWeightWithinParent * Math.log(0.5) + (1 - modelWeightWithinParent) * Math.log(0.2);
    // The parent then contributes at most 5 prior samples to the profile.
    const profileWeight = 4 / (4 + 5);
    const expected = Math.exp(
      profileWeight * Math.log(0.25) + (1 - profileWeight) * parentLogRatio,
    );

    expect(snapshot.selected?.scope).toBe('blended');
    expect(snapshot.selected?.multiplier).toBeCloseTo(expected, 8);
    expect(snapshot.blend?.profileWeight).toBeCloseTo(profileWeight, 8);
    expect(snapshot.blend?.modelWeight).toBeCloseTo(
      (1 - profileWeight) * modelWeightWithinParent,
      8,
    );
    expect(snapshot.blend?.otherModelsWeight).toBeCloseTo(
      (1 - profileWeight) * (1 - modelWeightWithinParent),
      8,
    );
  });

  it('keeps blend weights normalized to one', () => {
    const blend = buildCalibrationSnapshot(state, model, 'xhigh').blend!;

    expect(blend.profileWeight + blend.modelWeight + blend.otherModelsWeight).toBeCloseTo(1, 10);
  });

  it('never mixes a known thinking level with unknown-level history', () => {
    const legacy = stateWithTraining([
      completedRecord('legacy-a', 100, 40),
      completedRecord('legacy-b', 100, 40),
    ]);

    const known = buildCalibrationSnapshot(legacy, model, 'xhigh');
    const unknown = buildCalibrationSnapshot(legacy, model, undefined);

    expect(known.profile.sampleCount).toBe(0);
    expect(known.modelOtherLevels.sampleCount).toBe(2);
    expect(unknown.profile.sampleCount).toBe(2);
    expect(unknown.profile.profileKey).toBe('test/model:unknown');
    expect(known.profile.profileKey).toBe('test/model:xhigh');
  });

  it('falls back to broader strata when the profile has no evidence', () => {
    const snapshot = buildCalibrationSnapshot(state, model, 'max');

    expect(snapshot.profile.sampleCount).toBe(0);
    expect(snapshot.blend?.profileWeight).toBe(0);
    expect(snapshot.selected?.multiplier).toBeDefined();
  });

  it('uses profile-only evidence when nothing else exists', () => {
    const only = stateWithTraining([completedRecord('solo', 100, 30, { thinkingLevel: 'high' })]);
    const snapshot = buildCalibrationSnapshot(only, model, 'high');

    expect(snapshot.selected?.multiplier).toBeCloseTo(0.3, 8);
    expect(snapshot.blend).toEqual({ profileWeight: 1, modelWeight: 0, otherModelsWeight: 0 });
  });

  it('reports no calibration without any eligible samples', () => {
    const snapshot = buildCalibrationSnapshot(stateWithTraining([]), model, 'xhigh');

    expect(snapshot.selected).toBeUndefined();
    expect(snapshot.blend).toBeUndefined();
  });
});

describe('pi-eta calibration modes', () => {
  const state = stateWithTraining([
    ...Array.from({ length: 4 }, (_, index) =>
      completedRecord(`profile-${index}`, 100, 25, { thinkingLevel: 'xhigh' }),
    ),
    ...Array.from({ length: 6 }, (_, index) =>
      completedRecord(`level-${index}`, 100, 50, { thinkingLevel: 'low' }),
    ),
  ]);

  it('uses strictly the exact profile in profile mode', () => {
    const snapshot = buildCalibrationSnapshot(state, model, 'xhigh', {
      calibrationMode: 'profile',
      profileSampleThreshold: 3,
    });

    expect(snapshot.selected?.scope).toBe('profile');
    expect(snapshot.selected?.multiplier).toBeCloseTo(0.25, 8);
  });

  it('leaves profile mode unavailable without exact-profile samples', () => {
    const snapshot = buildCalibrationSnapshot(state, model, 'max', {
      calibrationMode: 'profile',
      profileSampleThreshold: 3,
    });

    expect(snapshot.profile.sampleCount).toBe(0);
    expect(snapshot.selected).toBeUndefined();
  });

  it('pools every eligible sample in global mode', () => {
    const snapshot = buildCalibrationSnapshot(state, model, 'xhigh', {
      calibrationMode: 'global',
      profileSampleThreshold: 3,
    });

    expect(snapshot.selected?.scope).toBe('global');
    expect(snapshot.selected?.sampleCount).toBe(10);
  });

  it('switches from global to the profile once the threshold is reached', () => {
    const before = buildCalibrationSnapshot(state, model, 'xhigh', {
      calibrationMode: 'profile-threshold',
      profileSampleThreshold: 5,
    });
    const reached = buildCalibrationSnapshot(state, model, 'xhigh', {
      calibrationMode: 'profile-threshold',
      profileSampleThreshold: 4,
    });

    expect(before.selected?.scope).toBe('global');
    expect(reached.selected?.scope).toBe('profile');
  });
});

describe('pi-eta duration model', () => {
  // actual = 0.5 · estimate^1.2, so the true slope is 1.2 before shrinkage.
  const sizedRecords = [1, 2, 3, 5, 8, 12, 20, 30, 45, 60, 90, 120, 180, 240].map(
    (estimate, index) =>
      completedRecord(`sized-${index}`, estimate, 0.5 * estimate ** 1.2, {
        thinkingLevel: 'xhigh',
      }),
  );

  it('recovers the slope and shrinks it toward one', () => {
    const duration = fitDurationModel(sizedRecords)!;
    const shrinkage = sizedRecords.length / (sizedRecords.length + 10);

    expect(duration.slope).toBeCloseTo(1 + 0.2 * shrinkage, 6);
    expect(duration.slope).toBeLessThan(1.2);
    expect(duration.minCenterMinutes).toBeCloseTo(1, 8);
    expect(duration.maxCenterMinutes).toBeCloseTo(240, 8);
  });

  it('stays dormant below the sample gate', () => {
    expect(fitDurationModel(sizedRecords.slice(0, DURATION_MIN_SAMPLES - 1))).toBeUndefined();
    expect(fitDurationModel(sizedRecords.slice(0, DURATION_MIN_SAMPLES))).toBeDefined();
  });

  it('stays dormant when estimate sizes are too similar', () => {
    const narrow = Array.from({ length: 20 }, (_, index) =>
      completedRecord(`narrow-${index}`, 10 + (index % 3), 30),
    );

    expect(fitDurationModel(narrow)).toBeUndefined();
  });

  it('stays dormant when only cross-profile spread exists', () => {
    // Each profile's estimates span 1.2x; the 5x spread lives between the two profiles,
    // where no Theil-Sen pair can see it, so the gate must not count it.
    const tightLow = [5, 5.5, 6, 5, 5.5, 6].map((estimate, index) =>
      completedRecord(`tight-low-${index}`, estimate, estimate, { thinkingLevel: 'low' }),
    );
    const tightHigh = [25, 27, 30, 25, 27, 30].map((estimate, index) =>
      completedRecord(`tight-high-${index}`, estimate, estimate, { thinkingLevel: 'xhigh' }),
    );

    expect(fitDurationModel([...tightLow, ...tightHigh])).toBeUndefined();
  });

  it('counts only pair-capable samples toward the activation gate', () => {
    // Twelve singleton profiles form no pairs; the two shared-profile points that do
    // pair up are far below the sample gate.
    const singletons = Array.from({ length: 12 }, (_, index) =>
      completedRecord(`single-${index}`, 1 + index, 10, { thinkingLevel: `level-${index}` }),
    );
    const pair = [
      completedRecord('pair-a', 1, 2, { thinkingLevel: 'shared' }),
      completedRecord('pair-b', 100, 20, { thinkingLevel: 'shared' }),
    ];

    expect(fitDurationModel([...singletons, ...pair])).toBeUndefined();
  });

  it('is neutral at the reference size and clamps outside the observed range', () => {
    const duration = fitDurationModel(sizedRecords)!;

    expect(sizeAdjustmentFactor(duration.refCenterMinutes, duration)).toBeCloseTo(1, 10);
    expect(sizeAdjustmentFactor(0.01, duration)).toBeCloseTo(
      sizeAdjustmentFactor(duration.minCenterMinutes, duration),
      10,
    );
    expect(sizeAdjustmentFactor(10_000, duration)).toBeCloseTo(
      sizeAdjustmentFactor(duration.maxCenterMinutes, duration),
      10,
    );
    expect(sizeAdjustmentFactor(60, undefined)).toBe(1);
  });

  it('applies the size adjustment to calibrated ranges', () => {
    const snapshot = buildCalibrationSnapshot(stateWithTraining(sizedRecords), model, 'xhigh');
    const multiplier = snapshot.selected!.multiplier!;
    const range = { lowMinutes: 200, highMinutes: 200 };

    const calibrated = calibrateRange(range, snapshot)!;
    const expected = 200 * multiplier * sizeAdjustmentFactor(200, snapshot.duration);

    expect(snapshot.duration).toBeDefined();
    expect(calibrated.lowMinutes).toBeCloseTo(expected, 8);
    expect(calibrated.lowMinutes).toBeGreaterThan(200 * multiplier);
  });

  it('does not mistake profile speed differences for a size effect', () => {
    // Two flat profiles: a fast one on small tasks, a slow one on large tasks. A pooled
    // cross-profile fit would read this as a slope below one; within-profile pairs see none.
    const fastSmall = [1, 2, 3, 5, 8, 12].map((estimate, index) =>
      completedRecord(`fast-${index}`, estimate, estimate * 0.5, { thinkingLevel: 'low' }),
    );
    const slowLarge = [20, 30, 45, 60, 90, 120].map((estimate, index) =>
      completedRecord(`slow-${index}`, estimate, estimate * 0.125, { thinkingLevel: 'xhigh' }),
    );
    const records = [...fastSmall, ...slowLarge];

    const duration = fitDurationModel(records)!;
    const snapshot = buildCalibrationSnapshot(stateWithTraining(records), model, 'low');

    expect(duration.slope).toBeCloseTo(1, 8);
    expect(snapshot.profile.multiplier).toBeCloseTo(0.5, 8);
  });

  it('expresses stratum multipliers at the reference size while the size effect is active', () => {
    const snapshot = buildCalibrationSnapshot(stateWithTraining(sizedRecords), model, 'xhigh');
    const duration = snapshot.duration!;
    const adjusted = sizedRecords
      .map((record) => {
        const center = record.estimate.lowMinutes;
        const rawRatio = Math.log(record.actualWallMs / 60000 / center);
        return (
          rawRatio - (duration.slope - 1) * (Math.log(center) - Math.log(duration.refCenterMinutes))
        );
      })
      .sort((a, b) => a - b);
    const expected = Math.exp((adjusted[6]! + adjusted[7]!) / 2);

    expect(snapshot.profile.multiplier).toBeCloseTo(expected, 8);
    expect(snapshot.global.multiplier).toBeCloseTo(expected, 8);
  });

  it('leaves calibrated ranges unscaled while the duration model is dormant', () => {
    const snapshot = buildCalibrationSnapshot(
      stateWithTraining([completedRecord('a', 100, 25, { thinkingLevel: 'xhigh' })]),
      model,
      'xhigh',
    );

    expect(snapshot.duration).toBeUndefined();
    expect(calibrateRange({ lowMinutes: 100, highMinutes: 100 }, snapshot)).toEqual({
      lowMinutes: 25,
      highMinutes: 25,
    });
  });
});

describe('pi-eta size bands', () => {
  it('splits history into round-bounded terciles', () => {
    const records = [1, 2, 3, 4, 10, 12, 14, 15, 60, 90, 120, 240].map((estimate, index) =>
      completedRecord(`band-${index}`, estimate, estimate * 0.5),
    );

    const bands = calculateSizeBands(records)!;

    expect(bands).toHaveLength(3);
    expect(bands[0]!.lowMinutes).toBeUndefined();
    expect(bands[2]!.highMinutes).toBeUndefined();
    expect(bands[0]!.highMinutes).toBe(bands[1]!.lowMinutes);
    expect(bands[1]!.highMinutes).toBe(bands[2]!.lowMinutes);
    expect(bands.reduce((total, band) => total + band.sampleCount, 0)).toBe(records.length);
    for (const band of bands) expect(band.sampleCount).toBeGreaterThanOrEqual(3);
  });

  it('reports the median multiplier per band', () => {
    const records = [
      ...[1, 2, 3].map((estimate, index) => completedRecord(`small-${index}`, estimate, estimate)),
      ...[60, 90, 120].map((estimate, index) =>
        completedRecord(`large-${index}`, estimate, estimate * 0.25),
      ),
      ...[11, 12, 13, 15].map((estimate, index) =>
        completedRecord(`mid-${index}`, estimate, estimate * 0.5),
      ),
    ];

    const bands = calculateSizeBands(records)!;

    expect(bands[0]!.multiplier).toBeCloseTo(1, 8);
    expect(bands[1]!.multiplier).toBeCloseTo(0.5, 8);
    expect(bands[2]!.multiplier).toBeCloseTo(0.25, 8);
  });

  it('hides bands when any band would have fewer than three samples', () => {
    const records = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100, 240].map((estimate, index) =>
      completedRecord(`thin-${index}`, estimate, estimate * 0.5),
    );

    expect(calculateSizeBands(records)).toBeUndefined();
  });

  it('hides bands when snapped boundaries collapse', () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      completedRecord(`flat-${index}`, 10, 5),
    );

    expect(calculateSizeBands(records)).toBeUndefined();
  });
});

describe('pi-eta event state', () => {
  it('round-trips the calibrated range and thinking level stored with a start event', () => {
    const event = parseEtaEvent({
      version: 1,
      eventId: 'start-calibrated',
      type: 'start',
      at: '2026-01-01T00:00:00.000Z',
      taskId: 'calibrated',
      taskSummary: 'calibrated',
      estimate: { lowMinutes: 10, highMinutes: 20 },
      calibratedRange: { lowMinutes: 2, highMinutes: 4 },
      model,
      thinkingLevel: 'xhigh',
      project,
      sessionId: 'session',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(event?.type).toBe('start');
    if (event?.type !== 'start') throw new Error('Expected a start event.');
    expect(event.calibratedRange).toEqual({ lowMinutes: 2, highMinutes: 4 });
    expect(event.thinkingLevel).toBe('xhigh');
    const record = buildEtaState([event]).records[0]!;
    expect(record.calibratedRange).toEqual({ lowMinutes: 2, highMinutes: 4 });
    expect(record.thinkingLevel).toBe('xhigh');
  });

  it('excludes events before the latest reset marker', () => {
    const beforeStart = {
      version: 1,
      eventId: 'start-before',
      type: 'start',
      at: '2026-01-01T00:00:00.000Z',
      taskId: 'before',
      taskSummary: 'before',
      estimate: { lowMinutes: 10, highMinutes: 10 },
      model,
      project,
      sessionId: 'session',
      startedAt: '2026-01-01T00:00:00.000Z',
    } satisfies EtaEvent;
    const reset = {
      version: 1,
      eventId: 'reset',
      type: 'reset',
      at: '2026-01-01T00:01:00.000Z',
    } satisfies EtaEvent;
    const afterStart = {
      version: 1,
      eventId: 'start-after',
      type: 'start',
      at: '2026-01-01T00:02:00.000Z',
      taskId: 'after',
      taskSummary: 'after',
      estimate: { lowMinutes: 10, highMinutes: 10 },
      model,
      project,
      sessionId: 'session',
      startedAt: '2026-01-01T00:02:00.000Z',
    } satisfies EtaEvent;

    const state = buildEtaState([beforeStart, reset, afterStart]);

    expect(state.resetCount).toBe(1);
    expect(state.records.map((record) => record.taskId)).toEqual(['after']);
  });
});

describe('pi-eta mixed execution profiles', () => {
  function startEvent(taskId: string, thinkingLevel?: string): EtaEvent {
    return {
      version: 1,
      eventId: `start-${taskId}`,
      type: 'start',
      at: '2026-01-01T00:00:00.000Z',
      taskId,
      taskSummary: taskId,
      estimate: { lowMinutes: 10, highMinutes: 10 },
      model,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      project,
      sessionId: 'session',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  function finishEvent(
    taskId: string,
    options: { model?: EtaModelInfo; thinkingLevel?: string } = {},
  ): EtaEvent {
    return {
      version: 1,
      eventId: `finish-${taskId}`,
      type: 'finish',
      at: '2026-01-01T00:05:00.000Z',
      taskId,
      outcome: 'completed',
      model: options.model ?? model,
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      project,
      sessionId: 'session',
      finishedAt: '2026-01-01T00:05:00.000Z',
      actualWallMs: 5 * 60000,
    };
  }

  it('flags a task carrying a profile change marker', () => {
    const marker: EtaEvent = {
      version: 1,
      eventId: 'marker',
      type: 'profile_change',
      at: '2026-01-01T00:02:00.000Z',
      taskId: 'round-trip',
    };
    const state = buildEtaState([
      startEvent('round-trip', 'xhigh'),
      marker,
      finishEvent('round-trip', { thinkingLevel: 'xhigh' }),
    ]);

    expect(state.records[0]!.mixedProfile).toBe(true);
    expect(state.completedRecords).toHaveLength(1);
    expect(state.trainingRecords).toHaveLength(0);
  });

  it('flags a thinking level or model mismatch between start and finish', () => {
    const levelChange = buildEtaState([
      startEvent('level', 'xhigh'),
      finishEvent('level', { thinkingLevel: 'low' }),
    ]);
    const modelChange = buildEtaState([
      startEvent('model', 'xhigh'),
      finishEvent('model', { model: otherModel, thinkingLevel: 'xhigh' }),
    ]);

    expect(levelChange.records[0]!.mixedProfile).toBe(true);
    expect(modelChange.records[0]!.mixedProfile).toBe(true);
  });

  it('does not flag legacy tasks whose start predates thinking-level capture', () => {
    const state = buildEtaState([
      startEvent('legacy'),
      finishEvent('legacy', { thinkingLevel: 'xhigh' }),
    ]);

    expect(state.records[0]!.mixedProfile).toBe(false);
    expect(state.trainingRecords).toHaveLength(1);
  });

  it('keeps mixed tasks out of every calibration stratum', () => {
    const state = stateWithTraining([]);
    const mixed = completedRecord('mixed', 100, 25, { thinkingLevel: 'xhigh', mixedProfile: true });
    const clean = completedRecord('clean', 100, 50, { thinkingLevel: 'xhigh' });
    state.completedRecords = [mixed, clean];
    state.trainingRecords = [clean];

    const snapshot = buildCalibrationSnapshot(state, model, 'xhigh');

    expect(snapshot.global.sampleCount).toBe(1);
    expect(snapshot.profile.multiplier).toBeCloseTo(0.5, 8);
  });
});
