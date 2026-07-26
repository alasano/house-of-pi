import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Static } from 'typebox';
import type {
  EtaCalibrationPolicy,
  EtaPreviewDetails,
  EtaToolDetails,
  EstimateRange,
  EtaState,
} from '../types';
import type { EtaCheckParamsSchema, EtaStartParamsSchema } from '../schemas';
import { buildCalibrationSnapshot, calibrateRange, sizeAdjustmentFactor } from '../stats';
import {
  estimateCenterMinutes,
  modelInfoFromContext,
  normalizeEstimateRange,
  projectInfoFromContext,
  sessionFileFromContext,
} from '../util';

export type EstimateParams =
  | Static<typeof EtaCheckParamsSchema>
  | Static<typeof EtaStartParamsSchema>;

export function buildErrorDetails(error: unknown): Extract<EtaToolDetails, { kind: 'error' }> {
  return {
    kind: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}

export function agentHiddenCalibrationMessage(
  action: 'checked' | 'started' | 'finished',
  taskId?: string,
): string {
  const idText = taskId ? ` Task ID: ${taskId}.` : '';
  return `ETA ${action}.${idText} The user has been shown the ETA information privately. Do not infer, restate, or apply hidden calibration multipliers yourself.`;
}

export function buildPreview(
  range: EstimateRange,
  state: EtaState,
  ctx: ExtensionContext,
  policy: EtaCalibrationPolicy,
): EtaPreviewDetails {
  const calibration = buildCalibrationSnapshot(
    state,
    modelInfoFromContext(ctx),
    ctx.thinkingLevel,
    policy,
  );
  const estimateCenter = estimateCenterMinutes(range);
  const calibratedRange = calibrateRange(range, calibration);
  return {
    rawRange: range,
    ...(calibratedRange ? { calibratedRange } : {}),
    estimateCenterMinutes: estimateCenter,
    ...(calibration.duration
      ? { sizeAdjustmentFactor: sizeAdjustmentFactor(estimateCenter, calibration.duration) }
      : {}),
    calibration,
  };
}

export function estimateRangeFromParams(params: EstimateParams): EstimateRange {
  return normalizeEstimateRange({
    estimateMinutes: params.estimateMinutes,
    estimateLowMinutes: params.estimateLowMinutes,
    estimateHighMinutes: params.estimateHighMinutes,
  });
}

export function sessionMetadata(ctx: ExtensionContext) {
  return {
    model: modelInfoFromContext(ctx),
    thinkingLevel: ctx.thinkingLevel,
    project: projectInfoFromContext(ctx),
    sessionId: ctx.sessionManager.getSessionId(),
    sessionFile: sessionFileFromContext(ctx),
  };
}
