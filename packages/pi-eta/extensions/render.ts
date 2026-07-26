import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from '@earendil-works/pi-coding-agent';
import { Text, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type {
  CalibrationSnapshot,
  CalibrationStats,
  EstimateRange,
  EtaPreviewDetails,
  EtaToolDetails,
} from './types';
import {
  formatDuration,
  formatMultiplier,
  formatRange,
  formatTimestamp,
  formatTimestampRelativeTo,
} from './util';

const GOLD_FG = '\x1b[38;2;212;162;46m';
const RESET_FG = '\x1b[39m';

/** Below this the size correction is not worth a line of its own. */
const SIZE_ADJUSTMENT_MIN_FACTOR = 1.05;

export type EtaToolArgs = {
  taskSummary?: string;
  estimateMinutes?: number;
  estimateLowMinutes?: number;
  estimateHighMinutes?: number;
  taskId?: string;
  outcome?: string;
};

export type EtaRenderPreferences = {
  verbose: boolean;
};

function gold(text: string): string {
  return `${GOLD_FG}${text}${RESET_FG}`;
}

export function centerToWidth(text: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(text));
  return `${' '.repeat(Math.floor(padding / 2))}${text}`;
}

function padVisible(text: string, width: number): string {
  const deficit = width - visibleWidth(text);
  return deficit > 0 ? `${text}${' '.repeat(deficit)}` : text;
}

export function frameLines(title: string, bodyLines: string[], inner: number): string[] {
  const leftHeader = `─ ${title} `;
  const fill = Math.max(1, inner - leftHeader.length);
  const top = gold('╭') + gold(leftHeader) + gold('─'.repeat(fill)) + gold('╮');
  const bottom = gold('╰') + gold('─'.repeat(inner)) + gold('╯');
  const contentWidth = Math.max(8, inner - 2);
  return [
    top,
    ...bodyLines.map((line) => {
      const truncated = truncateToWidth(line, contentWidth);
      return gold('│ ') + padVisible(truncated, contentWidth) + gold(' │');
    }),
    bottom,
  ];
}

export function computeFrameInner(
  bodyLines: string[],
  title: string,
  availableWidth: number,
): number {
  const maxInner = Math.max(24, Math.min(availableWidth - 2, 84));
  const natural = Math.max(
    visibleWidth(`─ ${title} `) + 1,
    ...bodyLines.map((line) => visibleWidth(line) + 2),
  );
  return Math.max(24, Math.min(maxInner, natural));
}

export function renderEtaCall(toolName: string, args: EtaToolArgs, theme: Theme): Text {
  if (toolName === 'eta_check') {
    let text = theme.fg('success', theme.bold('ETA check'));
    if (args.taskSummary) text += `  ${theme.fg('accent', `"${args.taskSummary}"`)}`;
    return new Text(text, 0, 0);
  }

  if (toolName === 'eta_start') {
    let text = theme.fg('success', theme.bold('ETA started'));
    if (args.taskSummary) text += `  ${theme.fg('accent', `"${args.taskSummary}"`)}`;
    return new Text(text, 0, 0);
  }

  if (toolName === 'eta_finish') {
    const outcomeLabels: Record<string, string> = {
      completed: 'ETA completed',
      abandoned: 'ETA abandoned',
      scope_changed: 'ETA scope changed',
      superseded: 'ETA superseded',
    };
    const label = outcomeLabels[args.outcome ?? 'completed'] ?? 'ETA finished';
    return new Text(theme.fg('success', theme.bold(label)), 0, 0);
  }

  let text = theme.fg('toolTitle', theme.bold(`${toolName} `));
  if (args.taskSummary) text += theme.fg('accent', `"${args.taskSummary}"`);
  return new Text(text, 0, 0);
}

function hasVariationStats(stats: CalibrationStats | undefined): stats is CalibrationStats & {
  spreadFactor: number;
} {
  return (
    stats !== undefined &&
    stats.sampleCount >= 3 &&
    stats.spreadFactor !== undefined &&
    Number.isFinite(stats.spreadFactor)
  );
}

function variationRange(calibratedRange: EstimateRange, spreadFactor: number): EstimateRange {
  return {
    lowMinutes: calibratedRange.lowMinutes / spreadFactor,
    highMinutes: calibratedRange.highMinutes * spreadFactor,
  };
}

function formatVariationFactor(spreadFactor: number): string {
  return `${spreadFactor.toFixed(2)}×`;
}

function calibrationScopeLabel(stats: CalibrationStats): string {
  if (stats.scope === 'profile') return `profile ${stats.profileKey ?? 'unknown'}`;
  if (stats.scope === 'model-other-levels') return 'model, other levels';
  if (stats.scope === 'other-models') return 'other models';
  if (stats.scope === 'blended') return 'blended';
  return 'global';
}

/**
 * Rounds the three stratum weights to whole percentages via largest remainder, so they
 * stay non-negative and always sum to 100.
 */
export function blendPercentages(
  snapshot: CalibrationSnapshot,
): [number, number, number] | undefined {
  const blend = snapshot.blend;
  if (!blend) return undefined;
  const exact = [blend.profileWeight * 100, blend.modelWeight * 100, blend.otherModelsWeight * 100];
  const percentages = exact.map(Math.floor);
  const order = exact
    .map((value, index) => ({ index, fraction: value - percentages[index]! }))
    .sort((a, b) => b.fraction - a.fraction);
  let remaining = 100 - percentages.reduce((total, value) => total + value, 0);
  for (const { index } of order) {
    if (remaining <= 0) break;
    percentages[index] = percentages[index]! + 1;
    remaining -= 1;
  }
  return [percentages[0]!, percentages[1]!, percentages[2]!];
}

function effectiveCalibrationLine(
  snapshot: CalibrationSnapshot,
  label: 'Calibration' | 'Updated calibration',
): string | undefined {
  const selected = snapshot.selected;
  if (!selected || selected.sampleCount === 0 || selected.multiplier === undefined)
    return undefined;

  const percentages = blendPercentages(snapshot);
  if (percentages) {
    const [profile, model, other] = percentages;
    return `${label}: blended | ${profile}% profile / ${model}% model / ${other}% other | ${selected.confidence} confidence`;
  }

  return `${label}: ${calibrationScopeLabel(selected)} | ${selected.sampleCount} sample${
    selected.sampleCount === 1 ? '' : 's'
  } | ${selected.confidence} confidence`;
}

function multiplierConfidenceRangeLine(stats: CalibrationStats | undefined): string | undefined {
  if (!stats || stats.sampleCount < 10 || !stats.multiplierCi95) return undefined;
  return `Multiplier confidence range: ${formatMultiplier(
    stats.multiplierCi95.low,
  )} – ${formatMultiplier(stats.multiplierCi95.high)} (95%)`;
}

/**
 * States how this estimate's size correction differs from the flat multiplier. Direction is
 * read from the corrected multipliers, since a slope above 1 strengthens or weakens the
 * correction depending on whether the agent over- or under-estimates.
 */
function sizeAdjustmentLine(preview: EtaPreviewDetails): string | undefined {
  const factor = preview.sizeAdjustmentFactor;
  const multiplier = preview.calibration.selected?.multiplier;
  if (factor === undefined || multiplier === undefined || !Number.isFinite(factor))
    return undefined;

  const magnitude = Math.exp(Math.abs(Math.log(factor)));
  if (magnitude < SIZE_ADJUSTMENT_MIN_FACTOR) return undefined;

  const stronger = Math.abs(Math.log(multiplier * factor)) > Math.abs(Math.log(multiplier));
  return `Size adjustment: estimates this size are corrected ${formatMultiplier(magnitude)} ${
    stronger ? 'stronger' : 'weaker'
  } than average`;
}

function previewLines(preview: EtaPreviewDetails, theme: Theme, showVerbose: boolean): string[] {
  const lines = [
    `${theme.fg('muted', 'Agent ETA:')} ${theme.fg('accent', formatRange(preview.rawRange))}`,
  ];

  if (!preview.calibratedRange) {
    lines.push(theme.fg('warning', 'Calibrated ETA appears after your first completed task.'));
    return lines;
  }

  lines.push(
    `${theme.fg('muted', 'Calibrated ETA:')} ${theme.fg(
      'success',
      formatRange(preview.calibratedRange),
    )}`,
  );

  if (!showVerbose) return lines;

  const selected = preview.calibration.selected;
  if (hasVariationStats(selected)) {
    lines.push(
      `${theme.fg('muted', 'Typical historical variation:')} ${theme.fg(
        'accent',
        formatRange(variationRange(preview.calibratedRange, selected.spreadFactor)),
      )}`,
      `${theme.fg('muted', 'Variation factor σg:')} ${formatVariationFactor(
        selected.spreadFactor,
      )}`,
    );
  }

  const sizeAdjustment = sizeAdjustmentLine(preview);
  if (sizeAdjustment) lines.push(theme.fg('dim', sizeAdjustment));

  const calibration = effectiveCalibrationLine(preview.calibration, 'Calibration');
  if (calibration) lines.push(theme.fg('dim', calibration));

  const confidenceRange = multiplierConfidenceRangeLine(selected);
  if (confidenceRange) lines.push(theme.fg('dim', confidenceRange));

  return lines;
}

function textContent(result: AgentToolResult<EtaToolDetails | undefined>): string {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}

export function renderEtaResult(
  result: AgentToolResult<EtaToolDetails | undefined>,
  options: ToolRenderResultOptions,
  theme: Theme,
  preferences: EtaRenderPreferences,
): Text {
  if (options.isPartial)
    return new Text(theme.fg('warning', textContent(result) || 'Recording ETA…'), 0, 0);

  const showVerbose = preferences.verbose || options.expanded;
  const details = result.details;
  if (!details) return new Text(textContent(result), 0, 0);

  if (details.kind === 'error') {
    return new Text(theme.fg('error', `ETA error: ${details.message}`), 0, 0);
  }

  if (details.kind === 'check') {
    return new Text(previewLines(details.preview, theme, showVerbose).join('\n'), 0, 0);
  }

  if (details.kind === 'start') {
    const lines = [
      ...previewLines(details.preview, theme, showVerbose),
      `${theme.fg('dim', 'Started:')} ${formatTimestamp(details.startedAt)}`,
    ];
    return new Text(lines.join('\n'), 0, 0);
  }

  const wall =
    details.actualWallMs !== undefined ? formatDuration(details.actualWallMs / 60000) : 'n/a';
  const lines = [
    `${theme.fg('muted', 'Actual duration:')} ${theme.fg('success', wall)}`,
    ...(details.calibratedRange
      ? [
          `${theme.fg('muted', 'Calibrated ETA:')} ${theme.fg(
            'success',
            formatRange(details.calibratedRange),
          )}`,
        ]
      : []),
    `${theme.fg('muted', 'Agent ETA:')} ${theme.fg('accent', formatRange(details.estimate))}`,
  ];

  const trained =
    details.outcome === 'completed' &&
    details.actualWallMs !== undefined &&
    details.actualWallMs > 0 &&
    !details.mixedProfile;

  if (trained) {
    if (showVerbose) {
      const lowRatio = details.actualWallMs! / 60000 / details.estimate.lowMinutes;
      const highRatio = details.actualWallMs! / 60000 / details.estimate.highMinutes;
      const ratioRange =
        lowRatio === highRatio
          ? formatMultiplier(lowRatio)
          : `${formatMultiplier(highRatio)} – ${formatMultiplier(lowRatio)}`;
      lines.push(
        `${theme.fg('muted', 'Actual/Agent ETA ratio:')} ${theme.fg('accent', ratioRange)}`,
      );

      const calibration = effectiveCalibrationLine(details.calibration, 'Updated calibration');
      if (calibration) lines.push(theme.fg('dim', calibration));

      const confidenceRange = multiplierConfidenceRangeLine(details.calibration.selected);
      if (confidenceRange) lines.push(theme.fg('dim', confidenceRange));
    }
  } else if (details.mixedProfile) {
    lines.push(
      theme.fg(
        'dim',
        'Model or thinking level changed during this task; excluded from calibration.',
      ),
    );
  } else if (details.outcome === 'completed') {
    lines.push(theme.fg('dim', 'No usable duration was recorded; excluded from calibration.'));
  } else {
    lines.push(theme.fg('dim', 'This outcome is excluded from calibration.'));
  }

  lines.push(
    `${theme.fg('dim', 'Finished:')} ${formatTimestampRelativeTo(
      details.finishedAt,
      details.startedAt,
    )}`,
  );
  return new Text(lines.join('\n'), 0, 0);
}
