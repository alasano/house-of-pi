import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Static } from 'typebox';
import { EtaStartParamsSchema } from '../schemas';
import { buildEtaState, commitEtaEvent, findOpenTaskForSession, findTaskById } from '../storage';
import type { EtaSettingsStore } from '../settings';
import type { EtaStartEvent, EtaTaskRecord, EtaToolDetails } from '../types';
import { renderEtaCall, renderEtaResult } from '../render';
import { baseEtaEvent, newEventId, nowIso } from '../util';
import {
  agentHiddenCalibrationMessage,
  buildErrorDetails,
  buildPreview,
  estimateRangeFromParams,
  sessionMetadata,
  type EtaTaskChanged,
} from './helpers';

export type EtaStartParams = Static<typeof EtaStartParamsSchema>;

export function createEtaStartTool(settings: EtaSettingsStore, onTaskChanged?: EtaTaskChanged) {
  return defineTool<typeof EtaStartParamsSchema, EtaToolDetails>({
    name: 'eta_start',
    label: 'ETA Start',
    description:
      'Start a wall-clock ETA timer for one estimated task. Pass your own honest estimate; calibrated ETA details are shown only to the user.',
    promptSnippet: 'Start a wall-clock ETA timer with your own honest estimate',
    promptGuidelines: [
      'Start before substantial work, usually more than a minute. Include delegated work and waiting: parallel branches use the longest critical path; sequential work and integration add together.',
    ],
    parameters: EtaStartParamsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const range = estimateRangeFromParams(params);
        const meta = sessionMetadata(ctx);
        const taskId = newEventId('eta_task');
        const startedAt = nowIso();

        let startedRecord: EtaTaskRecord | undefined;
        const details = await commitEtaEvent<EtaToolDetails>((state) => {
          const open = findOpenTaskForSession(state, meta.sessionId);
          if (open) {
            return {
              value: {
                kind: 'error',
                message: `This session already has open ETA task ${open.taskId}. Finish it with eta_finish before starting another.`,
              },
            };
          }

          const preview = buildPreview(range, state, ctx, settings.get());
          const startEvent: EtaStartEvent = {
            ...baseEtaEvent('start'),
            type: 'start',
            taskId,
            taskSummary: params.taskSummary,
            estimate: range,
            ...(preview.calibratedRange ? { calibratedRange: preview.calibratedRange } : {}),
            model: meta.model,
            ...(meta.thinkingLevel ? { thinkingLevel: meta.thinkingLevel } : {}),
            project: meta.project,
            sessionId: meta.sessionId,
            ...(meta.sessionFile ? { sessionFile: meta.sessionFile } : {}),
            startedAt,
            ...(params.delegatedTasks ? { delegatedTasks: params.delegatedTasks } : {}),
          };
          startedRecord = findTaskById(buildEtaState([...state.events, startEvent]), taskId);
          return {
            event: startEvent,
            value: {
              kind: 'start',
              taskId,
              taskSummary: params.taskSummary,
              model: meta.model,
              project: meta.project,
              preview,
              startedAt,
              ...(params.delegatedTasks ? { delegatedTasks: params.delegatedTasks } : {}),
            },
          };
        });

        if (details.kind === 'error') {
          return {
            content: [{ type: 'text', text: `ETA start failed: ${details.message}` }],
            isError: true,
            details,
          };
        }

        if (details.kind !== 'start') {
          throw new Error('ETA start produced an unexpected result.');
        }

        if (onTaskChanged) onTaskChanged(ctx, startedRecord);
        else if (ctx.mode === 'rpc')
          ctx.ui.setStatus('pi-eta', ctx.ui.theme.fg('accent', `ETA ${details.taskId}`));
        else if (ctx.mode === 'tui') ctx.ui.setStatus('pi-eta', undefined);

        return {
          content: [
            { type: 'text', text: agentHiddenCalibrationMessage('started', details.taskId) },
          ],
          details,
        };
      } catch (error) {
        const details = buildErrorDetails(error);
        return {
          content: [{ type: 'text', text: `ETA start failed: ${details.message}` }],
          isError: true,
          details,
        };
      }
    },
    renderCall(args, theme) {
      return renderEtaCall('eta_start', args, theme);
    },
    renderResult(result, options, theme) {
      return renderEtaResult(result, options, theme, settings.get());
    },
  });
}
