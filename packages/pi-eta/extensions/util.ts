import { randomBytes } from 'node:crypto';
import { basename, resolve } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { EstimateRange, EtaBaseEvent, EtaEvent, EtaModelInfo, EtaProjectInfo } from './types';
import { ETA_EVENT_VERSION } from './types';

export const UNKNOWN_THINKING_LEVEL = 'unknown';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newEventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

export function baseEtaEvent(
  type: EtaEvent['type'],
): Pick<EtaBaseEvent, 'version' | 'eventId' | 'at'> {
  return {
    version: ETA_EVENT_VERSION,
    eventId: newEventId(`eta_${type}`),
    at: nowIso(),
  };
}

export function profileKeyFor(modelKey: string, thinkingLevel: string | undefined): string {
  return `${modelKey}:${thinkingLevel ?? UNKNOWN_THINKING_LEVEL}`;
}

export function normalizeEstimateRange(params: {
  estimateMinutes?: number;
  estimateLowMinutes?: number;
  estimateHighMinutes?: number;
}): EstimateRange {
  const single = params.estimateMinutes;
  const low = params.estimateLowMinutes;
  const high = params.estimateHighMinutes;

  if (single !== undefined && (low !== undefined || high !== undefined)) {
    throw new Error(
      'Provide either estimateMinutes or estimateLowMinutes/estimateHighMinutes, not both.',
    );
  }

  if (single !== undefined) {
    if (single <= 0) throw new Error('estimateMinutes must be greater than zero.');
    return { lowMinutes: single, highMinutes: single };
  }

  if (low === undefined || high === undefined) {
    throw new Error('Provide estimateMinutes or both estimateLowMinutes and estimateHighMinutes.');
  }

  if (low <= 0 || high <= 0) {
    throw new Error('Estimate range values must be greater than zero.');
  }

  if (low > high) {
    throw new Error('estimateLowMinutes must be less than or equal to estimateHighMinutes.');
  }

  return { lowMinutes: low, highMinutes: high };
}

export function estimateCenterMinutes(range: EstimateRange): number {
  if (range.lowMinutes === range.highMinutes) return range.lowMinutes;
  return Math.sqrt(range.lowMinutes * range.highMinutes);
}

export function scaleRange(range: EstimateRange, multiplier: number): EstimateRange {
  return {
    lowMinutes: range.lowMinutes * multiplier,
    highMinutes: range.highMinutes * multiplier,
  };
}

export function modelInfoFromContext(ctx: ExtensionContext): EtaModelInfo {
  const provider = ctx.model?.provider || 'unknown';
  const id = ctx.model?.id || 'unknown';
  const name = ctx.model?.name;
  return {
    provider,
    id,
    ...(name ? { name } : {}),
    key: `${provider}/${id}`,
  };
}

export function projectInfoFromContext(ctx: ExtensionContext): EtaProjectInfo {
  const cwd = resolve(ctx.cwd);
  return {
    cwd,
    name: basename(cwd) || cwd,
  };
}

export function sessionFileFromContext(ctx: ExtensionContext): string | undefined {
  return ctx.sessionManager.getSessionFile();
}

const NICE_DURATION_MINUTES = [
  1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720,
];

/** Snaps a duration to the nearest round reporting boundary in log space. */
export function snapDuration(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return NICE_DURATION_MINUTES[0]!;
  let best = NICE_DURATION_MINUTES[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of NICE_DURATION_MINUTES) {
    const distance = Math.abs(Math.log(candidate / minutes));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return 'unknown';

  const roundedSeconds = minutes > 0 ? Math.max(1, Math.round(minutes * 60)) : 0;
  if (roundedSeconds < 60) return `${roundedSeconds}s`;

  if (roundedSeconds < 60 * 60) {
    const wholeMinutes = Math.floor(roundedSeconds / 60);
    const remainingSeconds = roundedSeconds % 60;
    return remainingSeconds > 0 ? `${wholeMinutes}m${remainingSeconds}s` : `${wholeMinutes}m`;
  }

  const roundedMinutes = Math.round(roundedSeconds / 60);
  const wholeHours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  return remainingMinutes > 0 ? `${wholeHours}h${remainingMinutes}m` : `${wholeHours}h`;
}

export function formatRange(range: EstimateRange): string {
  const low = formatDuration(range.lowMinutes);
  const high = formatDuration(range.highMinutes);
  return low === high ? low : `${low} – ${high}`;
}

export function formatMultiplier(multiplier: number | undefined): string {
  if (multiplier === undefined || !Number.isFinite(multiplier)) return 'n/a';
  if (multiplier >= 0.01 && multiplier < 100)
    return `${multiplier.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}×`;
  return `${multiplier.toExponential(2)}×`;
}

function padTimestampPart(value: number): string {
  return value.toString().padStart(2, '0');
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${padTimestampPart(date.getMonth() + 1)}-${padTimestampPart(
    date.getDate(),
  )}`;
}

function localTime(date: Date): string {
  return `${padTimestampPart(date.getHours())}:${padTimestampPart(
    date.getMinutes(),
  )}:${padTimestampPart(date.getSeconds())}`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${localDateKey(date)} ${localTime(date)}`;
}

export function formatTimestampRelativeTo(iso: string, referenceIso: string): string {
  const date = new Date(iso);
  const reference = new Date(referenceIso);
  if (Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) {
    return formatTimestamp(iso);
  }
  return localDateKey(date) === localDateKey(reference)
    ? localTime(date)
    : `${localDateKey(date)} ${localTime(date)}`;
}

export function actualWallMinutes(startedAt: string, finishedAt: string): number | undefined {
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return undefined;
  return (finish - start) / 60000;
}
