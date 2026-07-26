export const ETA_EVENT_VERSION = 1 as const;

export const ETA_OUTCOMES = ['completed', 'abandoned', 'scope_changed', 'superseded'] as const;
export type EtaOutcome = (typeof ETA_OUTCOMES)[number];

export const ETA_CALIBRATION_MODES = ['blended', 'profile', 'global', 'profile-threshold'] as const;
export type EtaCalibrationMode = (typeof ETA_CALIBRATION_MODES)[number];

export type EtaCalibrationPolicy = {
  calibrationMode: EtaCalibrationMode;
  profileSampleThreshold: number;
};

export type EstimateRange = {
  lowMinutes: number;
  highMinutes: number;
};

export type EtaModelInfo = {
  provider: string;
  id: string;
  name?: string;
  key: string;
};

export type EtaProjectInfo = {
  cwd: string;
  name: string;
};

export type EtaBaseEvent = {
  version: typeof ETA_EVENT_VERSION;
  eventId: string;
  type: string;
  at: string;
};

export type EtaCheckEvent = EtaBaseEvent & {
  type: 'check';
  taskSummary: string;
  estimate: EstimateRange;
  model: EtaModelInfo;
  thinkingLevel?: string;
  project: EtaProjectInfo;
  sessionId: string;
  sessionFile?: string;
};

export type EtaStartEvent = EtaBaseEvent & {
  type: 'start';
  taskId: string;
  taskSummary: string;
  estimate: EstimateRange;
  calibratedRange?: EstimateRange;
  model: EtaModelInfo;
  thinkingLevel?: string;
  project: EtaProjectInfo;
  sessionId: string;
  sessionFile?: string;
  startedAt: string;
};

export type EtaFinishEvent = EtaBaseEvent & {
  type: 'finish';
  taskId: string;
  outcome: EtaOutcome;
  note?: string;
  model: EtaModelInfo;
  thinkingLevel?: string;
  project: EtaProjectInfo;
  sessionId: string;
  sessionFile?: string;
  finishedAt: string;
  actualWallMs?: number;
};

/** Marks that the model or thinking level changed while an ETA task was open. */
export type EtaProfileChangeEvent = EtaBaseEvent & {
  type: 'profile_change';
  taskId: string;
};

export type EtaResetEvent = EtaBaseEvent & {
  type: 'reset';
  reason?: string;
};

export type EtaEvent =
  | EtaCheckEvent
  | EtaStartEvent
  | EtaFinishEvent
  | EtaProfileChangeEvent
  | EtaResetEvent;

export type EtaTaskRecord = {
  taskId: string;
  taskSummary: string;
  estimate: EstimateRange;
  calibratedRange?: EstimateRange;
  model: EtaModelInfo;
  thinkingLevel?: string;
  project: EtaProjectInfo;
  sessionId: string;
  sessionFile?: string;
  startedAt: string;
  finish?: EtaFinishEvent;
  mixedProfile: boolean;
};

export type CompletedEtaRecord = EtaTaskRecord & {
  finish: EtaFinishEvent & { outcome: 'completed' };
  actualWallMs: number;
};

export type EtaState = {
  events: EtaEvent[];
  checks: EtaCheckEvent[];
  records: EtaTaskRecord[];
  openRecords: EtaTaskRecord[];
  closedRecords: EtaTaskRecord[];
  completedRecords: CompletedEtaRecord[];
  /** Completed records eligible to train calibration: single execution profile only. */
  trainingRecords: CompletedEtaRecord[];
  resetCount: number;
};

export type CalibrationConfidence = 'none' | 'low' | 'medium' | 'high';

export type CalibrationScope =
  | 'profile'
  | 'model-other-levels'
  | 'other-models'
  | 'global'
  | 'blended';

export type CalibrationStats = {
  scope: CalibrationScope;
  profileKey?: string;
  sampleCount: number;
  multiplier?: number;
  medianLogRatio?: number;
  madLogRatio?: number;
  robustSigma?: number;
  spreadFactor?: number;
  standardErrorOfMedian?: number;
  multiplierCi95?: {
    low: number;
    high: number;
  };
  confidence: CalibrationConfidence;
};

/** Flattened weights of the three disjoint strata; sums to 1. */
export type CalibrationBlend = {
  profileWeight: number;
  modelWeight: number;
  otherModelsWeight: number;
};

export type DurationModel = {
  /** Shrunk log-log slope actually in use; 1 means no size effect. */
  slope: number;
  refCenterMinutes: number;
  minCenterMinutes: number;
  maxCenterMinutes: number;
  sampleCount: number;
};

export type EtaSizeBand = {
  lowMinutes?: number;
  highMinutes?: number;
  multiplier: number;
  sampleCount: number;
};

export type CalibrationSnapshot = {
  profile: CalibrationStats;
  modelOtherLevels: CalibrationStats;
  otherModels: CalibrationStats;
  global: CalibrationStats;
  mode: EtaCalibrationMode;
  profileSampleThreshold: number;
  selected?: CalibrationStats;
  blend?: CalibrationBlend;
  duration?: DurationModel;
};

export type EtaPreviewDetails = {
  rawRange: EstimateRange;
  calibratedRange?: EstimateRange;
  estimateCenterMinutes: number;
  sizeAdjustmentFactor?: number;
  calibration: CalibrationSnapshot;
};

export type EtaToolDetails =
  | {
      kind: 'check';
      taskSummary: string;
      model: EtaModelInfo;
      project: EtaProjectInfo;
      preview: EtaPreviewDetails;
      checkedAt: string;
    }
  | {
      kind: 'start';
      taskId: string;
      taskSummary: string;
      model: EtaModelInfo;
      project: EtaProjectInfo;
      preview: EtaPreviewDetails;
      startedAt: string;
    }
  | {
      kind: 'finish';
      taskId: string;
      taskSummary: string;
      model: EtaModelInfo;
      project: EtaProjectInfo;
      estimate: EstimateRange;
      calibratedRange?: EstimateRange;
      outcome: EtaOutcome;
      mixedProfile: boolean;
      startedAt: string;
      finishedAt: string;
      actualWallMs?: number;
      calibration: CalibrationSnapshot;
    }
  | {
      kind: 'error';
      message: string;
    };
