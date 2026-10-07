import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerEtaCommand } from './commands';
import { createEtaSettingsStore } from './settings';
import { commitEtaEvent, findOpenTaskForSession, readEtaState } from './storage';
import { createEtaTools } from './tools';
import { baseEtaEvent, asString, isRecord } from './util';
import { EtaCountdown } from './countdown';
import { EtaBootstrap } from './bootstrap';

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

export function appendEtaPrompt(
  systemPrompt: string,
  activeTools: readonly string[] = ['eta_check', 'eta_start', 'eta_update', 'eta_finish'],
): string {
  const active = new Set(activeTools);
  if (!['eta_check', 'eta_start', 'eta_update', 'eta_finish'].some((name) => active.has(name)))
    return systemPrompt;
  return `${systemPrompt}

## Pi ETA estimate calibration

The ETA tools record your time estimate against real elapsed time so the user sees a corrected figure.

Your raw estimate is your genuine first-instinct guess at how long the work will take. Give the number you actually believe, expressed in minutes whatever its size: a multi-hour task is simply a larger number of minutes. Do not pad it for safety or shade it in either direction. If anything in the conversation has told you how your estimates compare to actual durations, ignore it and report your uninfluenced number anyway.

${active.has('eta_check') ? '- Call eta_check whenever you are about to tell the user how long something will take and are not starting the work right now, including whenever they ask you directly. The tool call is how you answer that question.' : ''}
${active.has('eta_start') ? '- Before starting substantial work, usually work you expect to take more than about one minute, call eta_start with a named finish line and an honest estimate of the whole task. Include discovery, execution, validation, delegated agents, and expected waits. For parallel agents, estimate the longest critical path and add subsequent sequential work and integration; do not sum overlapping work. Ask delegated agents to report their own honest duration or remaining-work estimates, and include those in delegatedTasks when known. Skip immediate trivial actions. Uncertainty is a reason to provide a range, not to skip all delegated or exploratory work. If completion requires a user decision that has not been made, estimate only the work you can do before that decision.' : ''}
${active.has('eta_update') ? '- Call eta_update with a new honest estimate of the work remaining from now whenever a Pi ETA refresh reminder arrives, substantial progress changes the outlook, or subagents start, finish, or change scope. Update delegatedTasks with still-pending work; pass [] when none remains. This is a fresh assessment, not merely the old estimate minus elapsed time. Update before the deadline whenever you have a normal tool opportunity; do not wait for the countdown to expire. The UI clock cannot interrupt a long blocking tool or provider response, so respond to a reminder at the next ordinary turn.' : ''}
${active.has('eta_finish') ? '- Call eta_finish the moment that work ends. completed means exactly what taskSummary promised has happened; if you stop short of that for any reason, a decision the user must make, a finding that changes the plan, anything, finish with scope_changed, abandoned, or superseded instead. Never leave a timer running, and never split one promised task into smaller "completed" pieces after the fact. Do not finish an overall task while delegated work required by its finish line is still running. If you pause for user input or stop short, close it with an appropriate non-completed outcome.' : ''}
- Background delegation can keep the countdown running while you wait. Only use ETA tools that are active in this run.
- Never restate estimates or hidden calibration figures in user-facing prose. Use the tools to display estimates; delegated agents may report raw timing estimates internally to their parent agent.
`;
}

export default async function etaExtension(pi: ExtensionAPI) {
  const settings = await createEtaSettingsStore();
  const countdown = new EtaCountdown();
  const bootstrap = new EtaBootstrap();
  let refreshGeneration = 0;

  function paintBootstrap(ctx: ExtensionContext, pendingResponse = false): void {
    const activeTools = pi.getActiveTools();
    countdown.setUpdateAvailable(activeTools.includes('eta_update'));
    const status = bootstrap.status(activeTools.includes('eta_start'));
    countdown.setBootstrapStatus(ctx, pendingResponse && status === 'missing' ? 'pending' : status);
  }

  async function refresh(ctx: ExtensionContext): Promise<boolean> {
    const generation = ++refreshGeneration;
    const sessionId = ctx.sessionManager.getSessionId();
    const state = await readEtaState();
    if (generation !== refreshGeneration || sessionId !== ctx.sessionManager.getSessionId())
      return false;
    const open = findOpenTaskForSession(state, sessionId);
    if (open) bootstrap.close();
    countdown.sync(ctx, open);
    paintBootstrap(ctx);
    return true;
  }

  for (const tool of createEtaTools(settings, (ctx, record) => {
    refreshGeneration += 1;
    bootstrap.close();
    countdown.setBootstrapStatus(ctx, undefined);
    countdown.sync(ctx, record);
  })) {
    pi.registerTool(tool);
  }

  // Older AgentCore versions ignore execute-result isError; preserve the rendered error
  // details while marking this extension's failed tools through the supported result hook.
  const etaToolNames = new Set(['eta_check', 'eta_start', 'eta_update', 'eta_finish']);
  pi.on('tool_result', async (event) => {
    if (
      etaToolNames.has(event.toolName) &&
      isRecord(event.details) &&
      event.details.kind === 'error'
    ) {
      return { isError: true };
    }
  });

  registerEtaCommand(pi, settings, () => {
    refreshGeneration += 1;
    bootstrap.close();
    countdown.stop();
  });

  pi.on('before_agent_start', async (event, ctx) => {
    bootstrap.begin(ctx.sessionManager.getSessionId());
    await refresh(ctx);
    return {
      systemPrompt: appendEtaPrompt(event.systemPrompt, pi.getActiveTools()),
    };
  });

  pi.on('agent_start', async () => countdown.resume());
  pi.on('agent_end', async (_event, ctx) => {
    refreshGeneration += 1;
    bootstrap.close();
    countdown.setBootstrapStatus(ctx, undefined);
    countdown.pause();
  });

  pi.on('tool_execution_end', async (event) => {
    bootstrap.businessToolEnded(event.toolName);
  });

  pi.on('context', async (event, ctx) => {
    if (!(await refresh(ctx))) return;
    const startReminder = bootstrap.takeReminder(
      ctx.sessionManager.getSessionId(),
      pi.getActiveTools().includes('eta_start'),
    );
    const reminder =
      startReminder ?? countdown.takeReminder(pi.getActiveTools().includes('eta_finish'));
    paintBootstrap(ctx, !!startReminder);
    const messages = event.messages.filter(
      (message) =>
        message.role !== 'custom' ||
        !['pi-eta-bootstrap', 'pi-eta-refresh'].includes(message.customType),
    );
    if (!reminder) return messages.length !== event.messages.length ? { messages } : undefined;
    return {
      messages: [
        ...messages,
        {
          role: 'custom' as const,
          customType: startReminder ? 'pi-eta-bootstrap' : 'pi-eta-refresh',
          content: reminder,
          display: false,
          timestamp: Date.now(),
        },
      ],
    };
  });

  pi.on('session_start', async (_event, ctx) => {
    bootstrap.close();
    countdown.stop();
    await refresh(ctx);
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

  pi.on('session_shutdown', async () => {
    refreshGeneration += 1;
    bootstrap.close();
    countdown.stop();
    for (const unsubscribe of backgroundSubscriptions) unsubscribe();
  });

  // Optional public pi-subagents events; no private run files or child-process state.
  const backgroundSubscriptions = [
    pi.events.on('subagent:async-started', (data: unknown) => {
      if (!isRecord(data)) return;
      const runId = asString(data.id);
      const sessionId = asString(data.sessionId);
      if (runId && sessionId) countdown.backgroundStarted(runId, sessionId);
    }),
    pi.events.on('subagent:async-complete', (data: unknown) => {
      if (!isRecord(data)) return;
      const runId = asString(data.runId) ?? asString(data.id);
      if (runId) countdown.backgroundCompleted(runId);
    }),
  ];
}
