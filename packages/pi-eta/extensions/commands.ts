import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { matchesKey } from '@earendil-works/pi-tui';
import type { EtaSettingsStore } from './settings';
import { appendEtaEvent, getEventsPath, readEtaState } from './storage';
import {
  DURATION_MIN_SAMPLES,
  buildCalibrationSnapshot,
  calculateSizeBands,
  durationGateStatus,
  sizeAdjustmentFactor,
} from './stats';
import type { DurationGateStatus } from './stats';
import type {
  CalibrationScope,
  CalibrationSnapshot,
  CalibrationStats,
  CompletedEtaRecord,
  EtaSizeBand,
  EtaState,
  EtaTaskRecord,
} from './types';
import { blendPercentages, centerToWidth, frameLines } from './render';
import {
  actualWallMinutes,
  baseEtaEvent,
  formatDuration,
  formatRange,
  modelInfoFromContext,
  nowIso,
  profileKeyFor,
} from './util';

type EtaOverlayTheme = Pick<Theme, 'fg' | 'bold'>;

const BAND_LABEL_WIDTH = 11;

export type CalibrationRelationship = {
  factor: number;
  direction?: 'higher' | 'lower';
};

export function calibrationRelationship(
  multiplier: number | undefined,
): CalibrationRelationship | undefined {
  if (multiplier === undefined || !Number.isFinite(multiplier) || multiplier <= 0) return undefined;
  const agentToActual = 1 / multiplier;
  if (Math.abs(agentToActual - 1) < 0.05) return { factor: 1 };
  return agentToActual > 1
    ? { factor: agentToActual, direction: 'higher' }
    : { factor: 1 / agentToActual, direction: 'lower' };
}

function factorText(factor: number): string {
  return `~${factor.toFixed(1)}×`;
}

function sampleText(count: number): string {
  return `${count} sample${count === 1 ? '' : 's'}`;
}

function confidenceColor(
  confidence: CalibrationStats['confidence'],
): 'warning' | 'accent' | 'success' | 'dim' {
  if (confidence === 'low') return 'warning';
  if (confidence === 'medium') return 'accent';
  if (confidence === 'high') return 'success';
  return 'dim';
}

function styledRelationship(
  multiplier: number | undefined,
  theme: EtaOverlayTheme,
  includeSubject: boolean,
): string {
  const relationship = calibrationRelationship(multiplier);
  if (!relationship) return theme.fg('dim', 'No completed samples');
  const prefix = includeSubject ? 'Agent ETA is ' : '';
  const factor = theme.fg('accent', theme.bold(factorText(relationship.factor)));
  if (!relationship.direction) return `${prefix}${factor} actual duration`;
  const direction = theme.fg('warning', theme.bold(relationship.direction));
  return `${prefix}${factor} ${direction}${includeSubject ? ' than actual duration' : ''}`;
}

function statsLine(stats: CalibrationStats, theme: EtaOverlayTheme): string {
  if (stats.sampleCount === 0 || stats.multiplier === undefined) {
    return theme.fg('dim', 'No completed samples');
  }
  const separator = theme.fg('dim', ' · ');
  return [
    styledRelationship(stats.multiplier, theme, false),
    theme.fg('muted', sampleText(stats.sampleCount)),
    theme.fg(confidenceColor(stats.confidence), `${stats.confidence} confidence`),
  ].join(separator);
}

function modeTitle(calibration: CalibrationSnapshot): string {
  if (calibration.mode === 'blended') return 'Blended calibration';
  if (calibration.mode === 'profile') return 'Current profile calibration';
  if (calibration.mode === 'global') return 'Global calibration';
  return calibration.selected?.scope === 'profile'
    ? 'Current profile calibration'
    : 'Global calibration';
}

/** Which evidence strata the active mode actually reads. */
function usedScopes(calibration: CalibrationSnapshot): Set<CalibrationScope> {
  switch (calibration.mode) {
    case 'blended':
      return new Set<CalibrationScope>(['profile', 'model-other-levels', 'other-models']);
    case 'profile':
      return new Set<CalibrationScope>(['profile']);
    case 'global':
      return new Set<CalibrationScope>(['global']);
    case 'profile-threshold':
      return calibration.selected
        ? new Set<CalibrationScope>([calibration.selected.scope])
        : new Set<CalibrationScope>();
  }
}

function sectionHeader(
  title: string,
  used: boolean,
  theme: EtaOverlayTheme,
  detail?: string,
): string {
  let header = theme.bold(title);
  if (detail) header += `${theme.fg('dim', ' · ')}${theme.fg('accent', detail)}`;
  return used ? header : `${header}${theme.fg('dim', ' · not used')}`;
}

function thresholdProgressLines(
  calibration: CalibrationSnapshot,
  theme: EtaOverlayTheme,
): string[] {
  if (calibration.mode !== 'profile-threshold') return [];
  const lines = [
    theme.fg(
      'dim',
      `${calibration.profile.sampleCount} of ${calibration.profileSampleThreshold} required samples`,
    ),
  ];
  lines.push(
    theme.fg(
      'dim',
      calibration.profile.sampleCount < calibration.profileSampleThreshold
        ? `Switches to current-profile calibration after ${calibration.profileSampleThreshold} samples`
        : `Profile threshold reached · required ${calibration.profileSampleThreshold} samples`,
    ),
  );
  return lines;
}

function calibrationDetailLines(
  calibration: CalibrationSnapshot,
  profileKey: string,
  theme: EtaOverlayTheme,
): string[] {
  const used = usedScopes(calibration);
  const lines = [
    `${theme.bold(modeTitle(calibration))} ${theme.fg(
      calibration.selected ? 'success' : 'dim',
      calibration.selected ? '(in use)' : '(unavailable)',
    )}`,
  ];

  const percentages = calibration.mode === 'blended' ? blendPercentages(calibration) : undefined;
  if (percentages) {
    const [profile, model, otherModels] = percentages;
    lines.push(
      theme.fg(
        'muted',
        `Blend weight · Profile ${profile}% · Model ${model}% · Other models ${otherModels}%`,
      ),
    );
  }

  lines.push(
    '',
    sectionHeader('Current profile', used.has('profile'), theme, profileKey),
    statsLine(calibration.profile, theme),
    ...thresholdProgressLines(calibration, theme),
    '',
    sectionHeader('Same model, other levels', used.has('model-other-levels'), theme),
    statsLine(calibration.modelOtherLevels, theme),
    '',
    sectionHeader('Other models', used.has('other-models'), theme),
    statsLine(calibration.otherModels, theme),
    '',
    sectionHeader('Global baseline · all evidence', used.has('global'), theme),
    statsLine(calibration.global, theme),
  );

  return lines;
}

function bandLabel(band: EtaSizeBand): string {
  if (band.lowMinutes === undefined) return `≤${formatDuration(band.highMinutes!)}`;
  if (band.highMinutes === undefined) return `>${formatDuration(band.lowMinutes)}`;
  return `${formatDuration(band.lowMinutes)} – ${formatDuration(band.highMinutes)}`;
}

function sizeEffectLines(
  calibration: CalibrationSnapshot,
  bands: EtaSizeBand[] | undefined,
  gate: DurationGateStatus,
  theme: EtaOverlayTheme,
): string[] {
  const lines = ['', theme.bold('Size effect')];
  const duration = calibration.duration;
  const multiplier = calibration.selected?.multiplier;

  if (!duration) {
    lines.push(
      theme.fg(
        'dim',
        gate.pairableSamples < DURATION_MIN_SAMPLES
          ? `Not enough comparable samples yet · ${gate.pairableSamples} of ${DURATION_MIN_SAMPLES}`
          : 'Estimate sizes too similar within profiles to measure a size effect',
      ),
    );
    return lines;
  }

  if (multiplier === undefined) {
    lines.push(
      theme.fg(
        'dim',
        `Measured slope ${duration.slope.toFixed(2)} · unused without a selected calibration`,
      ),
    );
    return lines;
  }

  const low = multiplier * sizeAdjustmentFactor(duration.minCenterMinutes, duration);
  const high = multiplier * sizeAdjustmentFactor(duration.maxCenterMinutes, duration);
  lines.push(
    `${styledRelationship(low, theme, false)} at ${formatDuration(
      duration.minCenterMinutes,
    )}  →  ${styledRelationship(high, theme, false)} at ${formatDuration(
      duration.maxCenterMinutes,
    )}${theme.fg('dim', ` · slope ${duration.slope.toFixed(2)}`)}`,
  );

  for (const band of bands ?? []) {
    lines.push(
      `${theme.fg('muted', bandLabel(band).padEnd(BAND_LABEL_WIDTH))} ${styledRelationship(
        band.multiplier,
        theme,
        false,
      )}${theme.fg('dim', ' · ')}${theme.fg('muted', sampleText(band.sampleCount))}`,
    );
  }

  return lines;
}

function taskTitleLine(summary: string, theme: EtaOverlayTheme, suffix?: string): string {
  const title = `${theme.fg('muted', '┌─')} ${theme.bold(summary)}`;
  return suffix ? `${title}${theme.fg('dim', suffix)}` : title;
}

function metricSeparator(theme: EtaOverlayTheme): string {
  return theme.fg('dim', ' │ ');
}

function calibratedMetric(record: EtaTaskRecord, theme: EtaOverlayTheme): string {
  const value = record.calibratedRange
    ? theme.fg('success', formatRange(record.calibratedRange))
    : theme.fg('dim', '—');
  return `${theme.fg('muted', 'Calibrated ETA')} ${value}`;
}

function activeTaskLines(record: EtaTaskRecord, theme: EtaOverlayTheme, now: string): string[] {
  const age = actualWallMinutes(record.startedAt, now);
  const running = theme.fg('success', age === undefined ? '—' : formatDuration(age));
  return [
    taskTitleLine(record.taskSummary, theme),
    `${theme.fg('muted', '└─ Running')} ${running}${metricSeparator(theme)}${calibratedMetric(
      record,
      theme,
    )}${metricSeparator(theme)}${theme.fg('muted', 'Agent ETA')} ${theme.fg(
      'accent',
      formatRange(record.estimate),
    )}`,
  ];
}

function completedTaskLines(record: CompletedEtaRecord, theme: EtaOverlayTheme): string[] {
  const actual = theme.fg('success', formatDuration(record.actualWallMs / 60000));
  return [
    taskTitleLine(record.taskSummary, theme, record.mixedProfile ? ' · mixed profile' : undefined),
    `${theme.fg('muted', '└─ Actual')} ${actual}${metricSeparator(theme)}${calibratedMetric(
      record,
      theme,
    )}${metricSeparator(theme)}${theme.fg('muted', 'Agent ETA')} ${theme.fg(
      'accent',
      formatRange(record.estimate),
    )}`,
  ];
}

function truncateFromLeft(value: string, width: number): string {
  if (width <= 0) return '';
  if (value.length <= width) return value;
  if (width === 1) return '…';
  return `…${value.slice(-(width - 1))}`;
}

function footerLine(path: string, theme: EtaOverlayTheme, width: number): string {
  const prefix = 'Store: ';
  const close = 'Esc to close';
  const pathWidth = Math.max(1, width - prefix.length - close.length - 2);
  const left = `${prefix}${truncateFromLeft(path, pathWidth)}`;
  const gap = ' '.repeat(Math.max(1, width - left.length - close.length));
  return theme.fg('dim', `${left}${gap}${close}`);
}

export function buildEtaOverlayLines(
  state: EtaState,
  profileKey: string,
  calibration: CalibrationSnapshot,
  theme: EtaOverlayTheme,
  contentWidth: number,
  eventsPath: string,
  now: string,
): string[] {
  const headline = calibration.selected
    ? styledRelationship(calibration.selected.multiplier, theme, true)
    : theme.fg('dim', 'No calibration data yet');
  const lines = [
    '',
    centerToWidth(headline, contentWidth),
    '',
    ...calibrationDetailLines(calibration, profileKey, theme),
    ...sizeEffectLines(
      calibration,
      calibration.duration ? calculateSizeBands(state.trainingRecords) : undefined,
      durationGateStatus(state.trainingRecords),
      theme,
    ),
  ];

  const active = [...state.openRecords]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 3);
  if (active.length > 0) {
    lines.push('', theme.bold('Active ETA'));
    active.forEach((record, index) => {
      if (index > 0) lines.push('');
      lines.push(...activeTaskLines(record, theme, now));
    });
  }

  const recentCompleted = [...state.completedRecords]
    .sort((a, b) => b.finish.finishedAt.localeCompare(a.finish.finishedAt))
    .slice(0, 3);
  lines.push('', theme.bold('Recent completed'));
  if (recentCompleted.length === 0) {
    lines.push(theme.fg('dim', 'No completed ETA tasks yet'));
  } else {
    recentCompleted.forEach((record, index) => {
      if (index > 0) lines.push('');
      lines.push(...completedTaskLines(record, theme));
    });
  }

  lines.push('', footerLine(eventsPath, theme, contentWidth));
  return lines;
}

const plainTheme: EtaOverlayTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

async function showEtaOverlay(ctx: ExtensionContext, settings: EtaSettingsStore): Promise<void> {
  const state = await readEtaState();
  const model = modelInfoFromContext(ctx);
  const profileKey = profileKeyFor(model.key, ctx.thinkingLevel);
  const currentSettings = settings.get();
  const calibration = buildCalibrationSnapshot(state, model, ctx.thinkingLevel, currentSettings);
  const eventsPath = getEventsPath();
  const now = nowIso();

  if (ctx.mode !== 'tui') {
    ctx.ui.notify(
      buildEtaOverlayLines(state, profileKey, calibration, plainTheme, 100, eventsPath, now).join(
        '\n',
      ),
      'info',
    );
    return;
  }

  await ctx.ui.custom(
    (_tui, theme, _kb, done) => ({
      render(width: number) {
        const safeWidth = Math.max(26, width);
        const inner = Math.max(24, Math.min(safeWidth - 2, 100));
        const bodyLines = buildEtaOverlayLines(
          state,
          profileKey,
          calibration,
          theme,
          inner - 2,
          eventsPath,
          now,
        );
        return frameLines('PI ETA', bodyLines, inner);
      },
      invalidate() {},
      handleInput(data: string) {
        if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) done(undefined);
      },
    }),
    {
      overlay: true,
      overlayOptions: {
        anchor: 'center',
        width: 104,
      },
    },
  );
}

async function resetEta(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify('ETA reset requires UI confirmation.', 'warning');
    return;
  }

  const openCount = (await readEtaState()).openRecords.length;
  const openWarning =
    openCount > 0
      ? ` ${openCount} ETA task${openCount === 1 ? ' is' : 's are'} currently open and will become unfinishable.`
      : '';
  const ok = await ctx.ui.confirm(
    'Reset Pi ETA calibration?',
    `This appends a reset marker and excludes previous ETA events from future calibration. The raw event log remains on disk.${openWarning}`,
  );
  if (!ok) return;

  await appendEtaEvent({
    ...baseEtaEvent('reset'),
    type: 'reset',
    reason: 'manual reset from /eta reset',
  });

  ctx.ui.setStatus('pi-eta', undefined);
  ctx.ui.notify('Pi ETA calibration reset.', 'info');
}

export function getEtaArgumentCompletions(prefix: string) {
  const normalized = prefix.trimStart().toLowerCase();
  const verboseMatch = /^verbose\s+(.*)$/.exec(normalized);

  if (verboseMatch) {
    const optionPrefix = verboseMatch[1] ?? '';
    const options = [
      { value: 'verbose on', label: 'on', description: 'Enable persistent verbose output' },
      { value: 'verbose off', label: 'off', description: 'Disable persistent verbose output' },
      { value: 'verbose status', label: 'status', description: 'Show the current setting' },
    ];
    const filtered = options.filter((option) => option.label.startsWith(optionPrefix));
    return filtered.length > 0 ? filtered : null;
  }

  if (normalized.includes(' ')) return null;

  const subcommands = [
    { value: 'stats', label: 'stats', description: 'Open the statistics overlay' },
    { value: 'verbose', label: 'verbose', description: 'Toggle or configure verbose output' },
    { value: 'reset', label: 'reset', description: 'Reset calibration data' },
  ];
  const filtered = subcommands.filter((subcommand) => subcommand.value.startsWith(normalized));
  return filtered.length > 0 ? filtered : null;
}

export function registerEtaCommand(pi: ExtensionAPI, settings: EtaSettingsStore): void {
  pi.registerCommand('eta', {
    description: 'Show Pi ETA stats (usage: /eta [stats|verbose [on|off|status]|reset])',
    getArgumentCompletions: getEtaArgumentCompletions,
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = parts[0]?.toLowerCase() || '';
      switch (subcommand) {
        case '':
        case 'stats':
          await showEtaOverlay(ctx, settings);
          return;
        case 'verbose': {
          const mode = parts[1]?.toLowerCase();
          if (mode === 'status') {
            ctx.ui.notify(
              `Pi ETA verbose mode is ${settings.get().verbose ? 'enabled' : 'disabled'}.`,
              'info',
            );
            return;
          }

          if (mode && mode !== 'on' && mode !== 'off') {
            ctx.ui.notify('Usage: /eta verbose [on|off|status]', 'warning');
            return;
          }

          const verbose = mode === 'on' ? true : mode === 'off' ? false : !settings.get().verbose;
          await settings.setVerbose(verbose);
          ctx.ui.notify(`Pi ETA verbose mode ${verbose ? 'enabled' : 'disabled'}.`, 'info');
          return;
        }
        case 'reset':
          await resetEta(ctx);
          return;
        default:
          ctx.ui.notify('Usage: /eta [stats|verbose [on|off|status]|reset]', 'warning');
      }
    },
  });
}
