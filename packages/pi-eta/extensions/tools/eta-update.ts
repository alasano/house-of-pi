import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Static } from 'typebox';
import { EtaUpdateParamsSchema } from '../schemas';
import { buildEtaState, commitEtaEvent, findOpenTaskForSession, findTaskById } from '../storage';
import type { EtaSettingsStore } from '../settings';
import type { EtaTaskRecord, EtaToolDetails, EtaUpdateEvent } from '../types';
import { renderEtaCall, renderEtaResult } from '../render';
import { baseEtaEvent, nowIso } from '../util';
import {
  agentHiddenCalibrationMessage,
  buildErrorDetails,
  buildPreview,
  estimateRangeFromParams,
  sessionMetadata,
  type EtaTaskChanged,
} from './helpers';

export type EtaUpdateParams = Static<typeof EtaUpdateParamsSchema>;

export function createEtaUpdateTool(settings: EtaSettingsStore, onTaskChanged?: EtaTaskChanged) {
  return defineTool<typeof EtaUpdateParamsSchema, EtaToolDetails>({
    name: 'eta_update',
    label: 'ETA Update',
    description:
      'Replace the live countdown with a fresh honest estimate of remaining work, including outstanding subagents. This does not alter the original calibration baseline. Calibrated values are shown only to the user.',
    promptSnippet: 'Update the remaining work estimate before the current ETA expires',
    promptGuidelines: [
      'On an ETA refresh reminder or a material progress/delegation change, estimate the work still remaining from now, not total time since eta_start. Include outstanding subagent waiting and integration; do not merely subtract elapsed time from the old estimate.',
    ],
    parameters: EtaUpdateParamsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const range = estimateRangeFromParams(params);
        const meta = sessionMetadata(ctx);
        const updatedAt = nowIso();
        let updatedRecord: EtaTaskRecord | undefined;
        const details = await commitEtaEvent<EtaToolDetails>((state) => {
          const record = params.taskId
            ? findTaskById(state, params.taskId)
            : findOpenTaskForSession(state, meta.sessionId);
          if (!record || record.finish || record.sessionId !== meta.sessionId) {
            return {
              value: {
                kind: 'error',
                message: 'Only an open ETA task belonging to this session can be updated.',
              },
            };
          }
          const preview = buildPreview(range, state, ctx, settings.get());
          const update: EtaUpdateEvent = {
            ...baseEtaEvent('update'),
            type: 'update',
            taskId: record.taskId,
            sessionId: meta.sessionId,
            estimate: range,
            ...(preview.calibratedRange ? { calibratedRange: preview.calibratedRange } : {}),
            updatedAt,
            ...(params.delegatedTasks ? { delegatedTasks: params.delegatedTasks } : {}),
          };
          updatedRecord = findTaskById(buildEtaState([...state.events, update]), record.taskId);
          return {
            event: update,
            value: {
              kind: 'update',
              taskId: record.taskId,
              taskSummary: record.taskSummary,
              preview,
              updatedAt,
              ...(params.delegatedTasks ? { delegatedTasks: params.delegatedTasks } : {}),
            },
          };
        });
        if (details.kind === 'error') {
          return {
            content: [{ type: 'text', text: `ETA update failed: ${details.message}` }],
            details,
          };
        }
        if (details.kind !== 'update') throw new Error('ETA update produced an unexpected result.');
        onTaskChanged?.(ctx, updatedRecord);
        return {
          content: [
            { type: 'text', text: agentHiddenCalibrationMessage('updated', details.taskId) },
          ],
          details,
        };
      } catch (error) {
        const details = buildErrorDetails(error);
        return {
          content: [{ type: 'text', text: `ETA update failed: ${details.message}` }],
          details,
        };
      }
    },
    renderCall(args, theme) {
      return renderEtaCall('eta_update', args, theme);
    },
    renderResult(result, options, theme) {
      return renderEtaResult(result, options, theme, settings.get());
    },
  });
}
