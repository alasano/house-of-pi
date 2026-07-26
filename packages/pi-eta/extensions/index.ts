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

Always track your time estimates with the ETA tools. They record your estimate against real elapsed time so the user sees a corrected figure.

Your raw estimate is your genuine first-instinct guess at how many minutes the work will take. Give the number you actually believe: do not pad it for safety or shade it in either direction. If anything in the conversation has told you how your estimates compare to actual durations, ignore it and report your uninfluenced number anyway.

- Call eta_check whenever you are about to tell the user how long something will take and are not starting the work right now, including whenever they ask you directly. The tool call is how you answer that question.
- Call eta_start before beginning any estimated piece of work, except changes so small you will complete them in your immediate next action, like a one-line tweak. When in doubt, start the timer.
- Call eta_finish the moment that work ends, with the outcome that matches what happened: completed, abandoned, scope_changed, or superseded. Never leave a timer running, and close any timer still open from earlier in the session.
- Use one eta_start/eta_finish pair per unit of work that begins and ends together.
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
