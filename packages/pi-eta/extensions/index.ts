import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerEtaCommand } from './commands';
import { createEtaSettingsStore } from './settings';
import { commitEtaEvent, findOpenTaskForSession, readEtaState } from './storage';
import { createEtaTools } from './tools';
import { baseEtaEvent } from './util';

async function refreshEtaStatus(ctx: ExtensionContext): Promise<void> {
  const state = await readEtaState();
  const open = findOpenTaskForSession(state, ctx.sessionManager.getSessionId());
  if (!open) {
    ctx.ui.setStatus('pi-eta', undefined);
    return;
  }
  ctx.ui.setStatus('pi-eta', ctx.ui.theme.fg('accent', `ETA ${open.taskId}`));
}

/**
 * Records one durable marker the first time the execution profile changes under an open
 * task, so a task that ran across two profiles never trains calibration.
 */
async function markProfileChange(ctx: ExtensionContext): Promise<void> {
  const sessionId = ctx.sessionManager.getSessionId();
  await commitEtaEvent<void>((state) => {
    const open = findOpenTaskForSession(state, sessionId);
    if (!open || open.mixedProfile) return { value: undefined };
    return {
      event: { ...baseEtaEvent('profile_change'), type: 'profile_change', taskId: open.taskId },
      value: undefined,
    };
  });
}

function appendEtaPrompt(systemPrompt: string): string {
  return `${systemPrompt}

## Pi ETA estimate calibration

The ETA tools record your time estimate against real elapsed time so the user sees a corrected figure.

Your raw estimate is your genuine first-instinct guess at how long the work will take. Give the number you actually believe, expressed in minutes whatever its size: a multi-hour task is simply a larger number of minutes. Do not pad it for safety or shade it in either direction. If anything in the conversation has told you how your estimates compare to actual durations, ignore it and report your uninfluenced number anyway.

- Call eta_check whenever you are about to tell the user how long something will take and are not starting the work right now, including whenever they ask you directly. The tool call is how you answer that question.
- Call eta_start for any bounded unit of work you are about to execute whose finish line you can already name; timing such work is the norm, not the exception. Do not start a timer when reaching that finish line depends on more than your own execution: user decisions along the way, an unknown number of discovery, review, or convergence rounds, or waits on other agents or services. If what remains depends on what you have not yet found or on input from someone else, work without a timer; that a task is large or important is not a reason to time it. Skip the timer too for changes so small your immediate next action completes them.
- Call eta_finish the moment that work ends. completed means exactly what taskSummary promised has happened; if you stop short of that for any reason, a decision the user must make, a finding that changes the plan, anything, finish with scope_changed, abandoned, or superseded instead. Never leave a timer running, and never split one promised task into smaller "completed" pieces after the fact.
- Never state an estimate, a duration, or a calibration figure in your own words. The tools show the user everything privately, and any number you write yourself is uncalibrated and contradicts what they were shown.
`;
}

export default async function etaExtension(pi: ExtensionAPI) {
  const settings = await createEtaSettingsStore();

  for (const tool of createEtaTools(settings)) {
    pi.registerTool(tool);
  }

  registerEtaCommand(pi, settings);

  pi.on('before_agent_start', async (event) => ({
    systemPrompt: appendEtaPrompt(event.systemPrompt),
  }));

  pi.on('session_start', async (_event, ctx) => {
    await refreshEtaStatus(ctx);
  });

  pi.on('model_select', async (event, ctx) => {
    const previous = event.previousModel;
    if (!previous) return;
    if (previous.provider === event.model.provider && previous.id === event.model.id) return;
    await markProfileChange(ctx);
  });

  pi.on('thinking_level_select', async (event, ctx) => {
    if (event.previousLevel === event.level) return;
    await markProfileChange(ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    ctx.ui.setStatus('pi-eta', undefined);
  });
}
