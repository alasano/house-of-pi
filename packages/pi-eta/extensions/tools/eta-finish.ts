import { defineTool } from '@earendil-works/pi-coding-agent';
import type { Static } from 'typebox';
import { EtaFinishParamsSchema } from '../schemas';
import { buildEtaState, commitEtaEvent, findOpenTaskForSession, findTaskById } from '../storage';
import { buildCalibrationSnapshot } from '../stats';
import type { EtaSettingsStore } from '../settings';
import type { EtaFinishEvent, EtaToolDetails } from '../types';
import { renderEtaCall, renderEtaResult } from '../render';
import { actualWallMinutes, baseEtaEvent, nowIso } from '../util';
import { agentHiddenCalibrationMessage, buildErrorDetails, sessionMetadata } from './helpers';

export type EtaFinishParams = Static<typeof EtaFinishParamsSchema>;

export function createEtaFinishTool(settings: EtaSettingsStore) {
  return defineTool<typeof EtaFinishParamsSchema, EtaToolDetails>({
    name: 'eta_finish',
    label: 'ETA Finish',
    description:
      'Finish the open ETA timer for this session, or a specific ETA task id. Completed tasks update calibration; abandoned/scope_changed/superseded tasks are recorded but excluded from calibration.',
    promptSnippet: 'Finish an ETA timer and record completed/abandoned/scope-changed outcome',
    promptGuidelines: [
      'Use eta_finish as soon as eta_start work ends, whatever the outcome; stopping short of the promised task is scope_changed, not completed.',
    ],
    parameters: EtaFinishParamsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const outcome = params.outcome ?? 'completed';
        const meta = sessionMetadata(ctx);
        const finishedAt = nowIso();

        let closedThisSessionTask = false;
        const details = await commitEtaEvent<EtaToolDetails>((state) => {
          const record = params.taskId
            ? findTaskById(state, params.taskId)
            : findOpenTaskForSession(state, meta.sessionId);

          if (!record) {
            return {
              value: {
                kind: 'error',
                message: params.taskId
                  ? `ETA task ${params.taskId} was not found.`
                  : 'This session has no open ETA task to finish.',
              },
            };
          }

          if (record.finish) {
            return {
              value: {
                kind: 'error',
                message: `ETA task ${record.taskId} is already closed with outcome ${record.finish.outcome}.`,
              },
            };
          }

          closedThisSessionTask = record.sessionId === meta.sessionId;
          const wallMinutes = actualWallMinutes(record.startedAt, finishedAt);
          const actualWallMs = wallMinutes !== undefined ? wallMinutes * 60000 : undefined;
          const finishEvent: EtaFinishEvent = {
            ...baseEtaEvent('finish'),
            type: 'finish',
            taskId: record.taskId,
            outcome,
            model: meta.model,
            ...(meta.thinkingLevel ? { thinkingLevel: meta.thinkingLevel } : {}),
            project: meta.project,
            sessionId: meta.sessionId,
            ...(meta.sessionFile ? { sessionFile: meta.sessionFile } : {}),
            finishedAt,
            ...(params.note?.trim() ? { note: params.note.trim() } : {}),
            ...(actualWallMs !== undefined ? { actualWallMs } : {}),
          };
          const updatedState = buildEtaState([...state.events, finishEvent]);
          const calibration = buildCalibrationSnapshot(
            updatedState,
            meta.model,
            meta.thinkingLevel,
            settings.get(),
          );

          return {
            event: finishEvent,
            value: {
              kind: 'finish',
              taskId: record.taskId,
              taskSummary: record.taskSummary,
              model: record.model,
              project: record.project,
              estimate: record.estimate,
              ...(record.calibratedRange ? { calibratedRange: record.calibratedRange } : {}),
              outcome,
              mixedProfile: findTaskById(updatedState, record.taskId)?.mixedProfile ?? false,
              startedAt: record.startedAt,
              finishedAt,
              ...(actualWallMs !== undefined ? { actualWallMs } : {}),
              calibration,
            },
          };
        });

        if (details.kind === 'error') {
          return {
            content: [{ type: 'text', text: `ETA finish failed: ${details.message}` }],
            details,
          };
        }

        if (details.kind !== 'finish') {
          throw new Error('ETA finish produced an unexpected result.');
        }

        // Finishing another session's task by explicit id must not clear this session's
        // own open-task status.
        if (closedThisSessionTask) ctx.ui.setStatus('pi-eta', undefined);

        return {
          content: [
            { type: 'text', text: agentHiddenCalibrationMessage('finished', details.taskId) },
          ],
          details,
        };
      } catch (error) {
        const details = buildErrorDetails(error);
        return {
          content: [{ type: 'text', text: `ETA finish failed: ${details.message}` }],
          details,
        };
      }
    },
    renderCall(args, theme) {
      return renderEtaCall('eta_finish', args, theme);
    },
    renderResult(result, options, theme) {
      return renderEtaResult(result, options, theme, settings.get());
    },
  });
}
