import { describe, expect, it } from 'vitest';
import {
  buildEtaOverlayLines,
  calibrationRelationship,
  getEtaArgumentCompletions,
} from '../extensions/commands';
import { buildEtaState } from '../extensions/storage';
import { buildCalibrationSnapshot } from '../extensions/stats';
import type { EtaEvent, EtaModelInfo, EtaProjectInfo } from '../extensions/types';

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

const profileKey = 'test/model:xhigh';

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const taggedTheme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => `<b>${text}</b>`,
};

function completedTaskEvents(
  index: number,
  options: {
    model?: EtaModelInfo;
    thinkingLevel?: string;
    estimateMinutes?: number;
    actualMinutes?: number;
    summary?: string;
    profileChanged?: boolean;
  } = {},
): EtaEvent[] {
  const day = String(index + 1).padStart(2, '0');
  const startedAt = `2026-01-${day}T10:00:00.000Z`;
  const actualMinutes = options.actualMinutes ?? 4;
  const finishedAt = new Date(Date.parse(startedAt) + actualMinutes * 60000).toISOString();
  const taskId = `eta_task_secret_${index}`;
  const taskModel = options.model ?? model;
  const estimateMinutes = options.estimateMinutes ?? 15;
  const level = options.thinkingLevel ?? 'xhigh';

  return [
    {
      version: 1,
      eventId: `start-${index}`,
      type: 'start',
      at: startedAt,
      taskId,
      taskSummary: options.summary ?? `Completed task ${index}`,
      estimate: { lowMinutes: estimateMinutes, highMinutes: estimateMinutes * 2 },
      calibratedRange: { lowMinutes: 3, highMinutes: 6 },
      model: taskModel,
      thinkingLevel: level,
      project,
      sessionId: `session-${index}`,
      startedAt,
    },
    ...(options.profileChanged
      ? ([
          {
            version: 1,
            eventId: `change-${index}`,
            type: 'profile_change',
            at: startedAt,
            taskId,
          },
        ] satisfies EtaEvent[])
      : []),
    {
      version: 1,
      eventId: `finish-${index}`,
      type: 'finish',
      at: finishedAt,
      taskId,
      outcome: 'completed',
      model: taskModel,
      thinkingLevel: level,
      project,
      sessionId: `session-${index}`,
      finishedAt,
      actualWallMs: actualMinutes * 60_000,
    },
  ];
}

describe('getEtaArgumentCompletions', () => {
  it('suggests top-level subcommands', () => {
    expect(getEtaArgumentCompletions('')).toEqual([
      { value: 'stats', label: 'stats', description: 'Open the statistics overlay' },
      {
        value: 'verbose',
        label: 'verbose',
        description: 'Toggle or configure verbose output',
      },
      { value: 'reset', label: 'reset', description: 'Reset calibration data' },
    ]);
    expect(getEtaArgumentCompletions('st')).toEqual([
      { value: 'stats', label: 'stats', description: 'Open the statistics overlay' },
    ]);
  });

  it('suggests verbose options using full replacement values', () => {
    expect(getEtaArgumentCompletions('verbose ')).toEqual([
      { value: 'verbose on', label: 'on', description: 'Enable persistent verbose output' },
      { value: 'verbose off', label: 'off', description: 'Disable persistent verbose output' },
      { value: 'verbose status', label: 'status', description: 'Show the current setting' },
    ]);
    expect(getEtaArgumentCompletions('verbose o')).toEqual([
      { value: 'verbose on', label: 'on', description: 'Enable persistent verbose output' },
      { value: 'verbose off', label: 'off', description: 'Disable persistent verbose output' },
    ]);
  });

  it('returns no suggestions for unsupported argument shapes', () => {
    expect(getEtaArgumentCompletions('reset now')).toBeNull();
    expect(getEtaArgumentCompletions('unknown')).toBeNull();
  });
});

describe('Pi ETA overlay', () => {
  const completedEvents = [
    ...completedTaskEvents(0),
    ...completedTaskEvents(1),
    ...completedTaskEvents(2),
    ...completedTaskEvents(3, { thinkingLevel: 'low', summary: 'Low level task' }),
    ...completedTaskEvents(4, { model: otherModel, summary: 'Other model task' }),
  ];
  const activeStartedAt = '2026-01-09T10:00:00.000Z';
  const activeTask: EtaEvent = {
    version: 1,
    eventId: 'start-active',
    type: 'start',
    at: activeStartedAt,
    taskId: 'eta_task_active_secret',
    taskSummary: 'Active overlay redesign',
    estimate: { lowMinutes: 30, highMinutes: 45 },
    calibratedRange: { lowMinutes: 8, highMinutes: 13 },
    model,
    thinkingLevel: 'xhigh',
    project,
    sessionId: 'active-session',
    startedAt: activeStartedAt,
  };
  const state = buildEtaState([...completedEvents, activeTask]);
  const calibration = buildCalibrationSnapshot(state, model, 'xhigh');
  const lines = buildEtaOverlayLines(
    state,
    profileKey,
    calibration,
    plainTheme,
    98,
    'C:/Users/example/.pi/agent/state/extensions/pi-eta/events.jsonl',
    '2026-01-09T10:04:12.000Z',
  );
  const output = lines.join('\n');

  it('describes multiplier direction using the agreed headline language', () => {
    expect(calibrationRelationship(0.25)).toEqual({ factor: 4, direction: 'higher' });
    expect(calibrationRelationship(2)).toEqual({ factor: 2, direction: 'lower' });
    expect(calibrationRelationship(1.01)).toEqual({ factor: 1 });
    expect(output).toMatch(/Agent ETA is ~\d+\.\d× higher than actual duration/);
  });

  it('shows the three disjoint strata plus the descriptive global total', () => {
    expect(output).toContain('Blended calibration (in use)');
    expect(output).toContain(`Current profile · ${profileKey}`);
    expect(output).toContain('Same model, other levels');
    expect(output).toContain('Other models');
    expect(output).toContain('Global baseline · all evidence');
    expect(output).toContain('3 samples');
    expect(output).toContain('5 samples');
  });

  it('labels blend weights by stratum and never calls the prior global', () => {
    const weightLine = lines.find((line) => line.startsWith('Blend weight'))!;

    expect(weightLine).toMatch(/^Blend weight · Profile \d+% · Model \d+% · Other models \d+%$/);
    expect(weightLine).not.toContain('Global');
  });

  it('keeps overlay blend weights summing to one hundred percent', () => {
    const evenSplit = buildEtaState([
      ...completedTaskEvents(0),
      ...completedTaskEvents(1, { thinkingLevel: 'low' }),
      ...completedTaskEvents(2, { model: otherModel }),
    ]);
    const weightLine = buildEtaOverlayLines(
      evenSplit,
      profileKey,
      buildCalibrationSnapshot(evenSplit, model, 'xhigh'),
      plainTheme,
      98,
      'events.jsonl',
      '2026-01-09T10:04:12.000Z',
    ).find((line) => line.startsWith('Blend weight'))!;
    const percentages = [...weightLine.matchAll(/(\d+)%/g)].map((match) => Number(match[1]));

    expect(percentages).toHaveLength(3);
    expect(percentages.reduce((total, value) => total + value, 0)).toBe(100);
  });

  it('never shows a negative blend weight when other models are absent', () => {
    // 3 profile samples against a capped 5-sample same-model prior: exact weights are
    // 37.5% / 62.5% / 0%, which independent rounding used to show as -1% other models.
    const cappedPrior = buildEtaState([
      ...completedTaskEvents(0),
      ...completedTaskEvents(1),
      ...completedTaskEvents(2),
      ...completedTaskEvents(3, { thinkingLevel: 'low' }),
      ...completedTaskEvents(4, { thinkingLevel: 'low' }),
      ...completedTaskEvents(5, { thinkingLevel: 'low' }),
      ...completedTaskEvents(6, { thinkingLevel: 'low' }),
      ...completedTaskEvents(7, { thinkingLevel: 'low' }),
      ...completedTaskEvents(8, { thinkingLevel: 'low' }),
    ]);
    const weightLine = buildEtaOverlayLines(
      cappedPrior,
      profileKey,
      buildCalibrationSnapshot(cappedPrior, model, 'xhigh'),
      plainTheme,
      98,
      'events.jsonl',
      '2026-01-09T10:04:12.000Z',
    ).find((line) => line.startsWith('Blend weight'))!;

    expect(weightLine).toBe('Blend weight · Profile 38% · Model 62% · Other models 0%');
  });

  it('marks strata the active mode does not read', () => {
    const globalOnly = buildEtaOverlayLines(
      state,
      profileKey,
      buildCalibrationSnapshot(state, model, 'xhigh', {
        calibrationMode: 'global',
        profileSampleThreshold: 3,
      }),
      plainTheme,
      98,
      'events.jsonl',
      '2026-01-09T10:04:12.000Z',
    ).join('\n');

    expect(output).toContain('Global baseline · all evidence · not used');
    expect(output).not.toContain(`Current profile · ${profileKey} · not used`);
    expect(globalOnly).toContain(`Current profile · ${profileKey} · not used`);
    expect(globalOnly).toContain('Other models · not used');
    expect(globalOnly).not.toContain('Global baseline · all evidence · not used');
  });

  it('styles the multiplier, direction, and active mode consistently', () => {
    const styled = buildEtaOverlayLines(
      state,
      profileKey,
      calibration,
      taggedTheme,
      98,
      'events.jsonl',
      '2026-01-09T10:04:12.000Z',
    ).join('\n');

    expect(styled).toMatch(/<accent><b>~\d+\.\d×<\/b><\/accent>/);
    expect(styled).toContain('<warning><b>higher</b></warning>');
    expect(styled).toContain('<success>(in use)</success>');
  });

  it('explains profile-threshold progress while global calibration is active', () => {
    const thresholdOutput = buildEtaOverlayLines(
      state,
      profileKey,
      buildCalibrationSnapshot(state, model, 'xhigh', {
        calibrationMode: 'profile-threshold',
        profileSampleThreshold: 5,
      }),
      plainTheme,
      98,
      'events.jsonl',
      '2026-01-09T10:04:12.000Z',
    ).join('\n');

    expect(thresholdOutput).toContain('Global calibration (in use)');
    expect(thresholdOutput).toContain('3 of 5 required samples');
    expect(thresholdOutput).toContain('Switches to current-profile calibration after 5 samples');
  });

  it('reports size-effect progress in pairable samples while dormant', () => {
    // Five training records, but only the three sharing test/model:xhigh can form pairs.
    expect(output).toContain('Size effect');
    expect(output).toContain('Not enough comparable samples yet · 3 of 12');
    expect(output).not.toContain('slope');
  });

  it('reports narrow within-profile spread as the dormancy reason when samples suffice', () => {
    const narrow = buildEtaState(
      Array.from({ length: 12 }, (_, index) =>
        completedTaskEvents(index, { estimateMinutes: 15 + (index % 6) }),
      ).flat(),
    );
    const narrowOutput = buildEtaOverlayLines(
      narrow,
      profileKey,
      buildCalibrationSnapshot(narrow, model, 'xhigh'),
      plainTheme,
      98,
      'events.jsonl',
      '2026-01-09T10:04:12.000Z',
    ).join('\n');

    expect(narrowOutput).toContain(
      'Estimate sizes too similar within profiles to measure a size effect',
    );
    expect(narrowOutput).not.toContain('Not enough comparable samples');
  });

  it('shows one grouped active task without exposing its id', () => {
    expect(output).toContain('Active ETA');
    expect(output).toContain('┌─ Active overlay redesign');
    expect(output).toContain('└─ Running 4m12s │ Calibrated ETA 8m – 13m │ Agent ETA 30m – 45m');
    expect(output).not.toContain('eta_task_active_secret');
  });

  it('shows only three grouped recent tasks without ids or legacy counters', () => {
    expect(output).toContain('┌─ Other model task');
    expect(output).toContain('┌─ Low level task');
    expect(output).toContain('┌─ Completed task 2');
    expect(output).not.toContain('Completed task 0');
    expect(output).not.toContain('eta_task_secret');
    expect(output).not.toContain('Verbose tool output');
    expect(output).not.toContain('Checks:');
    expect(output).not.toContain('Resets:');
  });

  it('tags completed tasks whose execution profile changed mid-flight', () => {
    const mixedState = buildEtaState(
      completedTaskEvents(5, { summary: 'Mixed profile task', profileChanged: true }),
    );
    const mixedOutput = buildEtaOverlayLines(
      mixedState,
      profileKey,
      buildCalibrationSnapshot(mixedState, model, 'xhigh'),
      plainTheme,
      98,
      'events.jsonl',
      '2026-01-09T10:04:12.000Z',
    ).join('\n');

    expect(mixedOutput).toContain('┌─ Mixed profile task · mixed profile');
    expect(mixedOutput).toContain('No calibration data yet');
    expect(mixedOutput).toContain('Not enough comparable samples yet · 0 of 12');
  });

  it('hides the active section when no task is open and left-truncates the store footer', () => {
    const withoutActive = buildEtaOverlayLines(
      { ...state, openRecords: [] },
      profileKey,
      calibration,
      plainTheme,
      55,
      'C:/Users/example/.pi/agent/state/extensions/pi-eta/events.jsonl',
      '2026-01-09T10:04:12.000Z',
    ).join('\n');

    expect(withoutActive).not.toContain('Active ETA');
    expect(withoutActive).toContain('Store: …');
    expect(withoutActive).toContain('events.jsonl');
    expect(withoutActive).toContain('Esc to close');
  });
});

describe('Pi ETA overlay size effect', () => {
  const sizedEvents = [1, 2, 3, 5, 8, 12, 20, 30, 45, 60, 90, 120, 180, 240].flatMap(
    (estimate, index) =>
      completedTaskEvents(index, {
        estimateMinutes: estimate,
        actualMinutes: 0.5 * estimate ** 1.2,
        summary: `Sized task ${index}`,
      }),
  );
  const state = buildEtaState(sizedEvents);
  const calibration = buildCalibrationSnapshot(state, model, 'xhigh');
  const output = buildEtaOverlayLines(
    state,
    profileKey,
    calibration,
    plainTheme,
    98,
    'events.jsonl',
    '2026-01-09T10:04:12.000Z',
  ).join('\n');

  it('states the fitted correction at both ends of the observed range', () => {
    expect(calibration.duration).toBeDefined();
    expect(output).toMatch(/~\d+\.\d× .+ at .+ {2}→ {2}~\d+\.\d× .+ at .+ · slope \d\.\d\d/);
  });

  it('lists observed bands with round boundaries and sample counts', () => {
    const bandLines = output
      .split('\n')
      .filter((line) => /^(≤|>|\d)/.test(line.trim()) && line.includes('sample'));

    expect(bandLines).toHaveLength(3);
    expect(bandLines[0]).toMatch(/^≤\S+\s+~\d+\.\d× .+ · \d+ samples?$/);
    expect(bandLines[1]).toMatch(/^\S+ – \S+\s+~\d+\.\d× .+ · \d+ samples?$/);
    expect(bandLines[2]).toMatch(/^>\S+\s+~\d+\.\d× .+ · \d+ samples?$/);
  });

  it('reports a fitted but unused size model when no calibration is selected', () => {
    const profileOnly = buildCalibrationSnapshot(state, model, 'low', {
      calibrationMode: 'profile',
      profileSampleThreshold: 3,
    });
    const unusedOutput = buildEtaOverlayLines(
      state,
      'test/model:low',
      profileOnly,
      plainTheme,
      98,
      'events.jsonl',
      '2026-01-09T10:04:12.000Z',
    ).join('\n');

    expect(profileOnly.duration).toBeDefined();
    expect(profileOnly.selected).toBeUndefined();
    expect(unusedOutput).toMatch(/Measured slope \d\.\d\d · unused without a selected calibration/);
    expect(unusedOutput).not.toContain('Estimate sizes too similar');
  });

  it('estimates a shrunk slope above one for the seeded super-linear history', () => {
    expect(calibration.duration!.slope).toBeGreaterThan(1);
    expect(calibration.duration!.slope).toBeLessThan(1.2);
  });
});
