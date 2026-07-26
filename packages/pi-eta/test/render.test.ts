import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { renderEtaCall, renderEtaResult } from '../extensions/render';
import type {
  CalibrationScope,
  CalibrationSnapshot,
  CalibrationStats,
  EtaModelInfo,
  EtaProjectInfo,
  EtaToolDetails,
} from '../extensions/types';

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const colorTheme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => text,
} as unknown as Theme;

const model: EtaModelInfo = {
  provider: 'openai-codex',
  id: 'gpt-5.6-sol',
  key: 'openai-codex/gpt-5.6-sol',
};

const profileKey = 'openai-codex/gpt-5.6-sol:xhigh';

const project: EtaProjectInfo = {
  cwd: '/tmp/project',
  name: 'project',
};

function stats(scope: CalibrationScope, sampleCount: number, multiplier: number): CalibrationStats {
  return {
    scope,
    ...(scope === 'profile' ? { profileKey } : {}),
    sampleCount,
    multiplier,
    medianLogRatio: Math.log(multiplier),
    madLogRatio: 0.2,
    robustSigma: 0.29652,
    spreadFactor: 1.25,
    standardErrorOfMedian: 0.05,
    multiplierCi95: { low: multiplier * 0.8, high: multiplier * 1.2 },
    confidence: sampleCount >= 10 ? 'medium' : 'low',
  };
}

function snapshot(sampleCount: number): CalibrationSnapshot {
  const profileStats = stats('profile', sampleCount, 0.16);
  return {
    profile: profileStats,
    modelOtherLevels: stats('model-other-levels', sampleCount + 2, 0.18),
    otherModels: stats('other-models', sampleCount + 4, 0.2),
    global: stats('global', sampleCount * 3 + 6, 0.19),
    mode: 'profile',
    profileSampleThreshold: 3,
    selected: profileStats,
  };
}

const startedAt = new Date(2026, 6, 25, 13, 42, 58).toISOString();
const finishedAt = new Date(2026, 6, 25, 13, 54, 58).toISOString();

function startDetails(sampleCount: number): EtaToolDetails {
  return {
    kind: 'start',
    taskId: 'eta_task_test',
    taskSummary: 'Test rendering',
    model,
    project,
    preview: {
      rawRange: { lowMinutes: 120, highMinutes: 120 },
      calibratedRange: { lowMinutes: 19.2, highMinutes: 19.2 },
      estimateCenterMinutes: 120,
      calibration: snapshot(sampleCount),
    },
    startedAt,
  };
}

function finishDetails(
  sampleCount: number,
  outcome: 'completed' | 'scope_changed',
  mixedProfile = false,
): EtaToolDetails {
  return {
    kind: 'finish',
    taskId: 'eta_task_test',
    taskSummary: 'Test rendering',
    model,
    project,
    estimate: { lowMinutes: 120, highMinutes: 120 },
    calibratedRange: { lowMinutes: 19.2, highMinutes: 19.2 },
    outcome,
    mixedProfile,
    startedAt,
    finishedAt,
    actualWallMs: 12 * 60_000,
    calibration: snapshot(sampleCount),
  };
}

function render(
  details: EtaToolDetails,
  options: { verbose: boolean; expanded?: boolean },
  renderTheme: Theme = theme,
): string {
  const result: AgentToolResult<EtaToolDetails> = {
    content: [{ type: 'text', text: 'hidden agent result' }],
    details,
  };
  const renderOptions: ToolRenderResultOptions = {
    expanded: options.expanded ?? false,
    isPartial: false,
  };
  return renderEtaResult(result, renderOptions, renderTheme, { verbose: options.verbose })
    .render(1000)
    .join('\n');
}

describe('pi-eta rendering', () => {
  it('renders human-readable start and finish call headers', () => {
    const start = renderEtaCall(
      'eta_start',
      { taskSummary: 'Test rendering', estimateMinutes: 2 },
      theme,
    )
      .render(1000)
      .join('\n')
      .trimEnd();
    const finish = renderEtaCall(
      'eta_finish',
      { taskId: 'eta_task_test', outcome: 'completed' },
      theme,
    )
      .render(1000)
      .join('\n')
      .trimEnd();

    expect(start).toBe('ETA started  "Test rendering"');
    expect(finish).toBe('ETA completed');
    expect(finish).not.toContain('eta_task_test');
    expect(
      renderEtaCall('eta_finish', { outcome: 'scope_changed' }, theme)
        .render(1000)
        .join('\n')
        .trimEnd(),
    ).toBe('ETA scope changed');
  });

  it('keeps default start output minimal', () => {
    const output = render(startDetails(12), { verbose: false });

    expect(output).not.toContain('ETA timer started');
    expect(output).toContain('Agent ETA:');
    expect(output).toContain('Calibrated ETA:');
    expect(output).toContain('Started: 2026-07-25 13:42:58');
    expect(output).not.toContain('Typical historical variation:');
    expect(output).not.toContain('Variation factor σg:');
    expect(output).not.toContain('Calibration:');
    expect(output).not.toContain('Size adjustment:');
    expect(output).not.toContain('Multiplier confidence range:');
    expect(output).not.toContain('eta_task_test');
  });

  it('makes Ctrl+O expansion identical to persistent verbose mode', () => {
    const verbose = render(startDetails(12), { verbose: true, expanded: false });
    const expanded = render(startDetails(12), { verbose: false, expanded: true });

    expect(expanded).toBe(verbose);
  });

  it('shows variation only after three samples', () => {
    expect(render(startDetails(2), { verbose: true })).not.toContain(
      'Typical historical variation:',
    );
    expect(render(startDetails(3), { verbose: true })).toContain('Typical historical variation:');
  });

  it('shows the clean confidence range only after ten samples', () => {
    const nine = render(startDetails(9), { verbose: true });
    const ten = render(startDetails(10), { verbose: true });

    expect(nine).not.toContain('Multiplier confidence range:');
    expect(ten).toContain('Multiplier confidence range:');
    expect(ten).toContain('(95%)');
    expect(ten).not.toContain('multiplier CI');
  });

  it('names the exact profile as the effective calibration in strict mode', () => {
    const output = render(startDetails(12), { verbose: true });

    expect(output).toContain(`Calibration: profile ${profileKey} | 12 samples | medium confidence`);
    expect(output).not.toContain('Model:');
    expect(output).not.toContain('Global:');
  });

  it('describes blended calibration using the three stratum weights', () => {
    const details = startDetails(12);
    if (details.kind !== 'start') throw new Error('Expected start details.');
    details.preview.calibration = {
      ...snapshot(12),
      selected: stats('blended', 14, 0.19),
      mode: 'blended',
      blend: { profileWeight: 4 / 9, modelWeight: 10 / 27, otherModelsWeight: 5 / 27 },
    };

    expect(render(details, { verbose: true })).toContain(
      'Calibration: blended | 44% profile / 37% model / 19% other | medium confidence',
    );
  });

  it('keeps blend percentages summing to one hundred', () => {
    const details = startDetails(12);
    if (details.kind !== 'start') throw new Error('Expected start details.');
    details.preview.calibration = {
      ...snapshot(12),
      selected: stats('blended', 14, 0.19),
      mode: 'blended',
      blend: { profileWeight: 1 / 3, modelWeight: 1 / 3, otherModelsWeight: 1 / 3 },
    };

    const line = render(details, { verbose: true })
      .split('\n')
      .find((candidate) => candidate.startsWith('Calibration:'))!;
    const percentages = [...line.matchAll(/(\d+)%/g)].map((match) => Number(match[1]));

    expect(percentages.reduce((total, value) => total + value, 0)).toBe(100);
  });

  it('never renders a negative blend percentage', () => {
    const details = startDetails(3);
    if (details.kind !== 'start') throw new Error('Expected start details.');
    // 3 profile samples against a capped 5-sample prior and no other models: exact
    // weights 37.5% / 62.5% / 0%, which independent rounding used to show as -1% other.
    details.preview.calibration = {
      ...snapshot(3),
      selected: stats('blended', 8, 0.19),
      mode: 'blended',
      blend: { profileWeight: 3 / 8, modelWeight: 5 / 8, otherModelsWeight: 0 },
    };

    const line = render(details, { verbose: true })
      .split('\n')
      .find((candidate) => candidate.startsWith('Calibration:'))!;

    expect(line).toContain('38% profile / 62% model / 0% other');
    expect(line).not.toContain('-1%');
  });

  it('mentions the size adjustment only when it materially changes the correction', () => {
    const details = startDetails(12);
    if (details.kind !== 'start') throw new Error('Expected start details.');

    details.preview.sizeAdjustmentFactor = 1.02;
    expect(render(details, { verbose: true })).not.toContain('Size adjustment:');

    details.preview.sizeAdjustmentFactor = 0.7;
    expect(render(details, { verbose: true })).toContain(
      'Size adjustment: estimates this size are corrected 1.429× stronger than average',
    );

    details.preview.sizeAdjustmentFactor = 1.4;
    expect(render(details, { verbose: true })).toContain(
      'Size adjustment: estimates this size are corrected 1.4× weaker than average',
    );
  });

  it('keeps completed finish output minimal unless verbose', () => {
    const minimal = render(finishDetails(12, 'completed'), { verbose: false });
    const verbose = render(finishDetails(12, 'completed'), { verbose: true });

    expect(minimal).toContain('Actual duration: 12m');
    expect(minimal).toContain('Calibrated ETA: 19m12s');
    expect(minimal).toContain('Agent ETA: 2h');
    expect(minimal.indexOf('Actual duration:')).toBeLessThan(minimal.indexOf('Calibrated ETA:'));
    expect(minimal.indexOf('Calibrated ETA:')).toBeLessThan(minimal.indexOf('Agent ETA:'));
    expect(minimal).toContain('Finished: 13:54:58');
    expect(minimal).not.toContain('ETA timer closed');
    expect(minimal).not.toContain('Actual/Agent ETA ratio:');
    expect(minimal).not.toContain('Updated calibration:');
    expect(verbose).toContain('Actual/Agent ETA ratio:');
    expect(verbose).toContain(`Updated calibration: profile ${profileKey}`);
    expect(verbose).not.toContain('Updated model:');
    expect(verbose).not.toContain('Updated global:');
    expect(verbose).not.toContain('eta_task_test');
  });

  it('colors the completed comparison consistently with the start output', () => {
    const output = render(finishDetails(12, 'completed'), { verbose: false }, colorTheme);

    expect(output).toContain('<success>12m</success>');
    expect(output).toContain('<success>19m12s</success>');
    expect(output).toContain('<accent>2h</accent>');
  });

  it('marks a zero-duration completed finish as excluded instead of trained', () => {
    const details = finishDetails(12, 'completed');
    if (details.kind !== 'finish') throw new Error('Expected finish details.');
    details.actualWallMs = 0;

    const verbose = render(details, { verbose: true });

    expect(verbose).toContain('No usable duration was recorded; excluded from calibration.');
    expect(verbose).not.toContain('This outcome is excluded from calibration.');
    expect(verbose).not.toContain('Updated calibration:');
    expect(verbose).not.toContain('Actual/Agent ETA ratio:');
  });

  it('marks non-training outcomes as excluded', () => {
    const output = render(finishDetails(12, 'scope_changed'), { verbose: false });
    expect(output).toContain('This outcome is excluded from calibration.');
  });

  it('explains why a mixed execution profile was excluded, even without verbose', () => {
    const output = render(finishDetails(12, 'completed', true), { verbose: false });
    const verbose = render(finishDetails(12, 'completed', true), { verbose: true });

    expect(output).toContain(
      'Model or thinking level changed during this task; excluded from calibration.',
    );
    expect(output).not.toContain('This outcome is excluded from calibration.');
    expect(verbose).not.toContain('Updated calibration:');
    expect(verbose).not.toContain('Actual/Agent ETA ratio:');
  });
});
