import type {
  CalibrationBlend,
  CalibrationConfidence,
  CalibrationScope,
  CalibrationSnapshot,
  CalibrationStats,
  CompletedEtaRecord,
  DurationModel,
  EstimateRange,
  EtaCalibrationPolicy,
  EtaModelInfo,
  EtaSizeBand,
  EtaState,
} from './types';
import { estimateCenterMinutes, profileKeyFor, scaleRange, snapDuration } from './util';

const MAD_TO_SIGMA = 1.4826;
const MEDIAN_STANDARD_ERROR_FACTOR = 1.253;
const NORMAL_95 = 1.96;

/** Evidence caps for each partial-pooling step, in prior samples. */
const OTHER_MODELS_PRIOR_CAP = 10;
const PARENT_PRIOR_CAP = 5;

/** Activation gate and shrinkage strength for the size-effect model. */
export const DURATION_MIN_SAMPLES = 12;
export const DURATION_MIN_SPREAD = 4;
const DURATION_SHRINKAGE_SAMPLES = 10;

/** A size band with fewer samples than this is too noisy to display. */
const MIN_BAND_SAMPLES = 3;

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function confidenceFromStats(
  sampleCount: number,
  ciFactor: number | undefined,
): CalibrationConfidence {
  if (sampleCount === 0) return 'none';
  if (sampleCount < 8) return 'low';
  if (ciFactor === undefined || !Number.isFinite(ciFactor)) return 'low';
  if (sampleCount >= 20 && ciFactor <= 1.5) return 'high';
  if (sampleCount >= 8 && ciFactor <= 2) return 'medium';
  return 'low';
}

function emptyStats(scope: CalibrationScope, profileKey?: string): CalibrationStats {
  return {
    scope,
    ...(profileKey ? { profileKey } : {}),
    sampleCount: 0,
    confidence: 'none',
  };
}

/**
 * Log ratio of actual to estimated duration. When a size effect is active, the ratio is
 * detrended to the reference estimate size, so stratum medians stay size-neutral and the
 * size term applied at prediction time is not counted twice.
 */
function logRatioForRecord(
  record: CompletedEtaRecord,
  duration?: DurationModel,
): number | undefined {
  const estimateCenter = estimateCenterMinutes(record.estimate);
  const actualMinutes = record.actualWallMs / 60000;
  if (estimateCenter <= 0 || actualMinutes <= 0) return undefined;
  const raw = Math.log(actualMinutes / estimateCenter);
  if (!duration) return raw;
  return (
    raw - (duration.slope - 1) * (Math.log(estimateCenter) - Math.log(duration.refCenterMinutes))
  );
}

export function calculateCalibrationStats(
  records: CompletedEtaRecord[],
  scope: CalibrationScope,
  profileKey?: string,
  duration?: DurationModel,
): CalibrationStats {
  const logRatios = records
    .map((record) => logRatioForRecord(record, duration))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));

  const sampleCount = logRatios.length;
  if (sampleCount === 0) return emptyStats(scope, profileKey);

  const medianLogRatio = median(logRatios)!;
  const multiplier = Math.exp(medianLogRatio);
  const deviations = logRatios.map((value) => Math.abs(value - medianLogRatio));
  const madLogRatio = median(deviations) ?? 0;
  const robustSigma = MAD_TO_SIGMA * madLogRatio;
  const spreadFactor = Math.exp(robustSigma);
  const standardErrorOfMedian =
    sampleCount > 1
      ? (MEDIAN_STANDARD_ERROR_FACTOR * robustSigma) / Math.sqrt(sampleCount)
      : undefined;
  const ciFactor =
    standardErrorOfMedian !== undefined ? Math.exp(NORMAL_95 * standardErrorOfMedian) : undefined;
  const multiplierCi95 = ciFactor
    ? {
        low: multiplier / ciFactor,
        high: multiplier * ciFactor,
      }
    : undefined;

  return {
    scope,
    ...(profileKey ? { profileKey } : {}),
    sampleCount,
    multiplier,
    medianLogRatio,
    madLogRatio,
    robustSigma,
    spreadFactor,
    standardErrorOfMedian,
    ...(multiplierCi95 ? { multiplierCi95 } : {}),
    confidence: confidenceFromStats(sampleCount, ciFactor),
  };
}

const DEFAULT_POLICY: EtaCalibrationPolicy = {
  calibrationMode: 'blended',
  profileSampleThreshold: 3,
};

function hasMultiplier(stats: CalibrationStats): stats is CalibrationStats & {
  multiplier: number;
  medianLogRatio: number;
} {
  return stats.multiplier !== undefined && stats.medianLogRatio !== undefined;
}

type BlendStep = {
  stats: CalibrationStats;
  childWeight: number;
};

/**
 * Shrinks a child stratum toward an independent parent prior in log space. The parent
 * contributes at most `cap` samples, so the child takes over as its own evidence grows.
 */
function blendStats(
  child: CalibrationStats,
  parent: CalibrationStats,
  cap: number,
): BlendStep | undefined {
  if (!hasMultiplier(child) && !hasMultiplier(parent)) return undefined;
  if (!hasMultiplier(parent)) return { stats: child, childWeight: 1 };
  if (!hasMultiplier(child)) return { stats: parent, childWeight: 0 };

  const priorSamples = Math.min(parent.sampleCount, cap);
  const effectiveSampleCount = child.sampleCount + priorSamples;
  const childWeight = effectiveSampleCount > 0 ? child.sampleCount / effectiveSampleCount : 0;
  const parentWeight = 1 - childWeight;
  const medianLogRatio = childWeight * child.medianLogRatio + parentWeight * parent.medianLogRatio;
  const multiplier = Math.exp(medianLogRatio);

  const childSigma = child.robustSigma ?? 0;
  const parentSigma = parent.robustSigma ?? 0;
  const robustVariance =
    childWeight * (childSigma ** 2 + (child.medianLogRatio - medianLogRatio) ** 2) +
    parentWeight * (parentSigma ** 2 + (parent.medianLogRatio - medianLogRatio) ** 2);
  const robustSigma = Math.sqrt(Math.max(0, robustVariance));

  const childStandardError = child.standardErrorOfMedian;
  const parentStandardError = parent.standardErrorOfMedian;
  const standardErrorOfMedian =
    (childWeight === 0 || childStandardError !== undefined) &&
    (parentWeight === 0 || parentStandardError !== undefined)
      ? Math.sqrt(
          (childWeight * (childStandardError ?? 0)) ** 2 +
            (parentWeight * (parentStandardError ?? 0)) ** 2,
        )
      : undefined;
  const ciFactor =
    standardErrorOfMedian !== undefined ? Math.exp(NORMAL_95 * standardErrorOfMedian) : undefined;
  const multiplierCi95 = ciFactor
    ? { low: multiplier / ciFactor, high: multiplier * ciFactor }
    : undefined;

  return {
    stats: {
      scope: 'blended',
      sampleCount: effectiveSampleCount,
      multiplier,
      medianLogRatio,
      madLogRatio: robustSigma / MAD_TO_SIGMA,
      robustSigma,
      spreadFactor: Math.exp(robustSigma),
      ...(standardErrorOfMedian !== undefined ? { standardErrorOfMedian } : {}),
      ...(multiplierCi95 ? { multiplierCi95 } : {}),
      confidence: confidenceFromStats(effectiveSampleCount, ciFactor),
    },
    childWeight,
  };
}

type Selection = { selected?: CalibrationStats; blend?: CalibrationBlend };

/**
 * Exact profile shrinks toward the same model's other thinking levels, which in turn
 * shrinks toward other models. Every stratum is disjoint, so no sample is counted twice.
 */
function blendedCalibration(
  profile: CalibrationStats,
  modelOtherLevels: CalibrationStats,
  otherModels: CalibrationStats,
): Selection {
  const parent = blendStats(modelOtherLevels, otherModels, OTHER_MODELS_PRIOR_CAP);
  if (!parent) {
    return hasMultiplier(profile)
      ? {
          selected: profile,
          blend: { profileWeight: 1, modelWeight: 0, otherModelsWeight: 0 },
        }
      : {};
  }

  const combined = blendStats(profile, parent.stats, PARENT_PRIOR_CAP);
  if (!combined) return {};

  const profileWeight = combined.childWeight;
  const remainder = 1 - profileWeight;
  return {
    selected: combined.stats,
    blend: {
      profileWeight,
      modelWeight: remainder * parent.childWeight,
      otherModelsWeight: remainder * (1 - parent.childWeight),
    },
  };
}

function selectedCalibration(
  profile: CalibrationStats,
  modelOtherLevels: CalibrationStats,
  otherModels: CalibrationStats,
  global: CalibrationStats,
  policy: EtaCalibrationPolicy,
): Selection {
  switch (policy.calibrationMode) {
    case 'blended':
      return blendedCalibration(profile, modelOtherLevels, otherModels);
    case 'profile':
      return hasMultiplier(profile) ? { selected: profile } : {};
    case 'global':
      return hasMultiplier(global) ? { selected: global } : {};
    case 'profile-threshold':
      if (profile.sampleCount >= policy.profileSampleThreshold && hasMultiplier(profile)) {
        return { selected: profile };
      }
      if (hasMultiplier(global)) return { selected: global };
      return hasMultiplier(profile) ? { selected: profile } : {};
  }
}

type DurationPoint = { x: number; y: number; profileKey: string };

/**
 * Pairwise slopes are taken only within one execution profile, so speed differences
 * between profiles cannot masquerade as a size effect. This is the robust equivalent of a
 * shared slope with per-profile intercepts.
 */
function theilSenSlope(points: DurationPoint[]): number | undefined {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (points[i]!.profileKey !== points[j]!.profileKey) continue;
      const dx = points[j]!.x - points[i]!.x;
      if (dx === 0) continue;
      slopes.push((points[j]!.y - points[i]!.y) / dx);
    }
  }
  return median(slopes);
}

type DurationEvidence = {
  points: DurationPoint[];
  pairable: DurationPoint[];
  maxWithinProfileSpread: number;
};

/**
 * The evidence the slope estimator can actually see: points from profiles with 2+
 * samples, and the widest estimate-size spread inside a single profile.
 */
function collectDurationEvidence(records: CompletedEtaRecord[]): DurationEvidence {
  const points = records
    .map((record) => {
      const center = estimateCenterMinutes(record.estimate);
      const actualMinutes = record.actualWallMs / 60000;
      if (center <= 0 || actualMinutes <= 0) return undefined;
      return {
        x: Math.log(center),
        y: Math.log(actualMinutes),
        profileKey: profileKeyFor(record.model.key, record.thinkingLevel),
      };
    })
    .filter((point): point is DurationPoint => point !== undefined);

  const profileCounts = new Map<string, number>();
  for (const point of points) {
    profileCounts.set(point.profileKey, (profileCounts.get(point.profileKey) ?? 0) + 1);
  }
  const pairable = points.filter((point) => profileCounts.get(point.profileKey)! >= 2);

  const spreadByProfile = new Map<string, { min: number; max: number }>();
  for (const point of pairable) {
    const range = spreadByProfile.get(point.profileKey);
    if (!range) {
      spreadByProfile.set(point.profileKey, { min: point.x, max: point.x });
    } else {
      range.min = Math.min(range.min, point.x);
      range.max = Math.max(range.max, point.x);
    }
  }
  const maxWithinProfileSpread =
    spreadByProfile.size > 0
      ? Math.max(...[...spreadByProfile.values()].map((range) => Math.exp(range.max - range.min)))
      : 1;

  return { points, pairable, maxWithinProfileSpread };
}

export type DurationGateStatus = {
  pairableSamples: number;
  maxWithinProfileSpread: number;
};

/** Why the size-effect model is (or is not) allowed to activate, for display. */
export function durationGateStatus(records: CompletedEtaRecord[]): DurationGateStatus {
  const { pairable, maxWithinProfileSpread } = collectDurationEvidence(records);
  return { pairableSamples: pairable.length, maxWithinProfileSpread };
}

/**
 * Fits ln(actual) = a + b·ln(estimate) with Theil-Sen, then shrinks the slope toward 1 so
 * a thin history degrades to the flat multiplier instead of over-correcting. The sample
 * and spread gates count only pairable evidence. Reference center and clamp range still
 * come from all records, since prediction applies to every stratum.
 */
export function fitDurationModel(records: CompletedEtaRecord[]): DurationModel | undefined {
  const { points, pairable, maxWithinProfileSpread } = collectDurationEvidence(records);
  const sampleCount = pairable.length;
  if (sampleCount < DURATION_MIN_SAMPLES) return undefined;
  if (maxWithinProfileSpread < DURATION_MIN_SPREAD) return undefined;

  const rawSlope = theilSenSlope(pairable);
  if (rawSlope === undefined || !Number.isFinite(rawSlope)) return undefined;

  const xs = points.map((point) => point.x);
  return {
    slope: 1 + (rawSlope - 1) * (sampleCount / (sampleCount + DURATION_SHRINKAGE_SAMPLES)),
    refCenterMinutes: Math.exp(xs.reduce((total, value) => total + value, 0) / points.length),
    minCenterMinutes: Math.exp(Math.min(...xs)),
    maxCenterMinutes: Math.exp(Math.max(...xs)),
    sampleCount,
  };
}

/** Multiplier correction for an estimate of this size, relative to a typical estimate. */
export function sizeAdjustmentFactor(
  centerMinutes: number,
  duration: DurationModel | undefined,
): number {
  if (!duration) return 1;
  const clamped = Math.min(
    Math.max(centerMinutes, duration.minCenterMinutes),
    duration.maxCenterMinutes,
  );
  return (clamped / duration.refCenterMinutes) ** (duration.slope - 1);
}

function bandFor(
  entries: { center: number; logRatio: number }[],
  bounds: { lowMinutes?: number; highMinutes?: number },
): EtaSizeBand {
  return {
    ...bounds,
    multiplier: Math.exp(median(entries.map((entry) => entry.logRatio))!),
    sampleCount: entries.length,
  };
}

/**
 * Descriptive terciles of the observed estimate sizes, snapped to round boundaries.
 * Display only: calibration is driven by the fitted slope, never by these bands.
 */
export function calculateSizeBands(records: CompletedEtaRecord[]): EtaSizeBand[] | undefined {
  const entries = records
    .map((record) => {
      const center = estimateCenterMinutes(record.estimate);
      const actualMinutes = record.actualWallMs / 60000;
      if (center <= 0 || actualMinutes <= 0) return undefined;
      return { center, logRatio: Math.log(actualMinutes / center) };
    })
    .filter((entry): entry is { center: number; logRatio: number } => entry !== undefined);

  if (entries.length === 0) return undefined;

  const centers = entries.map((entry) => entry.center).sort((a, b) => a - b);
  const lowMinutes = snapDuration(quantile(centers, 1 / 3));
  const highMinutes = snapDuration(quantile(centers, 2 / 3));
  if (lowMinutes >= highMinutes) return undefined;

  const groups = [
    entries.filter((entry) => entry.center <= lowMinutes),
    entries.filter((entry) => entry.center > lowMinutes && entry.center <= highMinutes),
    entries.filter((entry) => entry.center > highMinutes),
  ];
  if (groups.some((group) => group.length < MIN_BAND_SAMPLES)) return undefined;

  return [
    bandFor(groups[0]!, { highMinutes: lowMinutes }),
    bandFor(groups[1]!, { lowMinutes, highMinutes }),
    bandFor(groups[2]!, { lowMinutes: highMinutes }),
  ];
}

function partitionRecords(
  records: CompletedEtaRecord[],
  modelKey: string,
  profileKey: string,
): {
  profile: CompletedEtaRecord[];
  modelOtherLevels: CompletedEtaRecord[];
  otherModels: CompletedEtaRecord[];
} {
  const profile: CompletedEtaRecord[] = [];
  const modelOtherLevels: CompletedEtaRecord[] = [];
  const otherModels: CompletedEtaRecord[] = [];

  for (const record of records) {
    if (record.model.key !== modelKey) otherModels.push(record);
    else if (profileKeyFor(record.model.key, record.thinkingLevel) === profileKey) {
      profile.push(record);
    } else modelOtherLevels.push(record);
  }

  return { profile, modelOtherLevels, otherModels };
}

export function buildCalibrationSnapshot(
  state: EtaState,
  model: EtaModelInfo,
  thinkingLevel: string | undefined,
  policy: EtaCalibrationPolicy = DEFAULT_POLICY,
): CalibrationSnapshot {
  const records = state.trainingRecords;
  const profileKey = profileKeyFor(model.key, thinkingLevel);
  const parts = partitionRecords(records, model.key, profileKey);

  const duration = fitDurationModel(records);
  const profile = calculateCalibrationStats(parts.profile, 'profile', profileKey, duration);
  const modelOtherLevels = calculateCalibrationStats(
    parts.modelOtherLevels,
    'model-other-levels',
    undefined,
    duration,
  );
  const otherModels = calculateCalibrationStats(
    parts.otherModels,
    'other-models',
    undefined,
    duration,
  );
  const global = calculateCalibrationStats(records, 'global', undefined, duration);

  return {
    profile,
    modelOtherLevels,
    otherModels,
    global,
    mode: policy.calibrationMode,
    profileSampleThreshold: policy.profileSampleThreshold,
    ...selectedCalibration(profile, modelOtherLevels, otherModels, global, policy),
    ...(duration ? { duration } : {}),
  };
}

export function calibrateRange(
  range: EstimateRange,
  snapshot: CalibrationSnapshot,
): EstimateRange | undefined {
  const multiplier = snapshot.selected?.multiplier;
  if (multiplier === undefined) return undefined;
  const factor = sizeAdjustmentFactor(estimateCenterMinutes(range), snapshot.duration);
  return scaleRange(range, multiplier * factor);
}
