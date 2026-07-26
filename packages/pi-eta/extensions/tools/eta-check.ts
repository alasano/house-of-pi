import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Static } from 'typebox';
import { EtaCheckParamsSchema } from '../schemas';
import { commitEtaEvent } from '../storage';
import type { EtaSettingsStore } from '../settings';
import type { EtaToolDetails } from '../types';
import { renderEtaCall, renderEtaResult } from '../render';
import { baseEtaEvent, nowIso } from '../util';
import {
  agentHiddenCalibrationMessage,
  buildErrorDetails,
  buildPreview,
  estimateRangeFromParams,
  sessionMetadata,
} from './helpers';

export type EtaCheckParams = Static<typeof EtaCheckParamsSchema>;

export function createEtaCheckTool(settings: EtaSettingsStore) {
  return defineTool<typeof EtaCheckParamsSchema, EtaToolDetails>({
    name: 'eta_check',
    label: 'ETA Check',
    description:
      'Privately show the user a calibrated ETA for your estimate without starting a timer. The agent only receives confirmation, not the calibrated estimate or multiplier.',
    promptSnippet: 'Privately calibrate a time estimate for the user without starting a timer',
    promptGuidelines: [
      'Use eta_check when you are about to give the user a time estimate without starting the work.',
    ],
    parameters: EtaCheckParamsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const range = estimateRangeFromParams(params);
        const meta = sessionMetadata(ctx);
        const checkedAt = nowIso();

        const details = await commitEtaEvent<EtaToolDetails>((state) => {
          const preview = buildPreview(range, state, ctx, settings.get());
          return {
            event: {
              ...baseEtaEvent('check'),
              type: 'check',
              taskSummary: params.taskSummary,
              estimate: range,
              model: meta.model,
              ...(meta.thinkingLevel ? { thinkingLevel: meta.thinkingLevel } : {}),
              project: meta.project,
              sessionId: meta.sessionId,
              ...(meta.sessionFile ? { sessionFile: meta.sessionFile } : {}),
            },
            value: {
              kind: 'check',
              taskSummary: params.taskSummary,
              model: meta.model,
              project: meta.project,
              preview,
              checkedAt,
            },
          };
        });

        return {
          content: [{ type: 'text', text: agentHiddenCalibrationMessage('checked') }],
          details,
        };
      } catch (error) {
        const details = buildErrorDetails(error);
        return {
          content: [{ type: 'text', text: `ETA check failed: ${details.message}` }],
          details,
        };
      }
    },
    renderCall(args, theme) {
      return renderEtaCall('eta_check', args, theme);
    },
    renderResult(result, options, theme) {
      return renderEtaResult(result, options, theme, settings.get());
    },
  });
}
