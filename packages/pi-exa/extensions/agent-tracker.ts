import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { getAgentRun, isTerminalAgentStatus } from './agent';
import { AgentRunsWidget } from './agent-widget';
import { resolveApiKey } from './auth';
import type { ExaAgentRun } from './types';
import { asString, isRecord, truncateText } from './util';

const TRACKED_RUNS_PATH = join(getAgentDir(), 'state', 'extensions', 'pi-exa', 'agent-runs.json');
const DEFAULT_BACKGROUND_POLL_INTERVAL_MS = 10_000;
const BACKGROUND_FOLLOW_UP_MAX_CHARS = 3000;
const STATUS_KEY = 'pi-exa-agent';
const WIDGET_KEY = 'pi-exa-agent-runs';

export interface TrackedAgentRun {
  runId: string;
  query?: string;
  createdAt?: string;
  lastStatus?: string;
  pollIntervalMs?: number;
}

function normalizeTrackedRun(value: unknown): TrackedAgentRun | undefined {
  if (!isRecord(value)) return undefined;
  const runId = asString(value.runId);
  if (!runId) return undefined;

  return {
    runId,
    query: asString(value.query),
    createdAt: asString(value.createdAt),
    lastStatus: asString(value.lastStatus),
    pollIntervalMs:
      typeof value.pollIntervalMs === 'number' && Number.isFinite(value.pollIntervalMs)
        ? value.pollIntervalMs
        : undefined,
  };
}

async function readTrackedRuns(): Promise<TrackedAgentRun[]> {
  try {
    const raw = JSON.parse(await fs.readFile(TRACKED_RUNS_PATH, 'utf8'));
    const runs = Array.isArray(raw?.runs) ? raw.runs : [];
    const seen = new Set<string>();
    return runs.flatMap((item: unknown) => {
      const normalized = normalizeTrackedRun(item);
      if (!normalized || seen.has(normalized.runId)) return [];
      seen.add(normalized.runId);
      return [normalized];
    });
  } catch {
    return [];
  }
}

async function writeTrackedRuns(runs: TrackedAgentRun[]): Promise<void> {
  await fs.mkdir(dirname(TRACKED_RUNS_PATH), { recursive: true });
  await fs.writeFile(TRACKED_RUNS_PATH, `${JSON.stringify({ runs }, null, 2)}\n`, 'utf8');
}

function makeFollowUp(run: ExaAgentRun): string {
  const terminalLabel =
    run.status === 'completed'
      ? 'Exa Agent background run completed'
      : `Exa Agent background run ${run.status}`;
  const lines = [terminalLabel, `Run ID: ${run.id}`];

  if (run.stopReason) lines.push(`Stop reason: ${run.stopReason}`);
  if (run.costDollars?.total !== undefined) lines.push(`Cost: $${run.costDollars.total}`);
  if (run.output?.text) lines.push(`Summary: ${truncateText(run.output.text, 800)}`);

  const structuredSummary = summarizeStructuredOutput(run.output?.structured);
  if (structuredSummary) lines.push(`Structured: ${structuredSummary}`);

  const sourceUrls = collectSourceUrls(run).slice(0, 6);
  if (sourceUrls.length > 0) {
    lines.push('Sources:');
    lines.push(...sourceUrls.map((url) => `- ${url}`));
  }

  lines.push('');
  lines.push('This is a compact completion notice, not the full Agent result.');
  lines.push(
    `Before answering with details from this run, call web_agent_get_exa with runId "${run.id}". Do not poll unless more detail is needed.`,
  );

  return truncateText(lines.join('\n'), BACKGROUND_FOLLOW_UP_MAX_CHARS);
}

function summarizeStructuredOutput(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return `array with ${value.length} item(s)`;
  if (typeof value !== 'object') return truncateText(String(value), 300);

  const entries = Object.entries(value as Record<string, unknown>);
  const arrayEntry = entries.find(([, item]) => Array.isArray(item));
  if (arrayEntry && Array.isArray(arrayEntry[1])) {
    return `${arrayEntry[0]} has ${arrayEntry[1].length} item(s)`;
  }

  return `object with ${entries.length} field(s): ${entries
    .slice(0, 8)
    .map(([key]) => key)
    .join(', ')}`;
}

function collectSourceUrls(run: ExaAgentRun): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const grounding of run.output?.grounding || []) {
    for (const citation of grounding.citations || []) {
      if (!citation.url || seen.has(citation.url)) continue;
      seen.add(citation.url);
      urls.push(citation.url);
    }
  }

  return urls;
}

export class AgentRunTracker {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private widget: AgentRunsWidget | undefined;
  private widgetContext: ExtensionContext | undefined;
  private shuttingDown = false;

  constructor(private readonly pi: ExtensionAPI) {}

  async track(
    run: ExaAgentRun,
    options?: { pollIntervalMs?: number },
    ctx?: ExtensionContext,
  ): Promise<void> {
    if (isTerminalAgentStatus(run.status)) return;

    const runs = await readTrackedRuns();
    const existing = runs.find((item) => item.runId === run.id);
    const tracked: TrackedAgentRun = {
      runId: run.id,
      query: run.request?.query,
      createdAt: run.createdAt,
      lastStatus: run.status,
      pollIntervalMs: options?.pollIntervalMs,
    };

    if (existing) {
      Object.assign(existing, tracked);
    } else {
      runs.push(tracked);
    }

    await writeTrackedRuns(runs);
    this.updateUi(ctx, runs);
    this.startPolling(tracked, ctx);
  }

  async resume(ctx?: ExtensionContext): Promise<void> {
    this.shuttingDown = false;
    const runs = await readTrackedRuns();
    this.updateUi(ctx, runs);
    for (const run of runs) {
      this.startPolling(run, ctx);
    }
  }

  shutdown(ctx?: ExtensionContext): void {
    this.shuttingDown = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.updateUi(ctx, []);
  }

  private startPolling(run: TrackedAgentRun, ctx?: ExtensionContext): void {
    if (this.shuttingDown || this.timers.has(run.runId)) return;
    this.schedule(run, ctx, 0);
  }

  private updateUi(ctx: ExtensionContext | undefined, runs: TrackedAgentRun[]): void {
    if (!ctx?.hasUI) return;

    if (runs.length === 0) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      this.widget = undefined;
      this.widgetContext = undefined;
      return;
    }

    ctx.ui.setStatus(STATUS_KEY, `Exa Agent: ${runs.length} running`);
    if (this.widget && this.widgetContext === ctx) {
      this.widget.setRuns(runs);
      return;
    }

    if (this.widget) {
      this.widget.dispose();
      this.widget = undefined;
      this.widgetContext = undefined;
    }

    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui, _theme) => {
        this.widget = new AgentRunsWidget(tui, runs);
        this.widgetContext = ctx;
        return this.widget;
      },
      { placement: 'belowEditor' },
    );
  }

  private schedule(run: TrackedAgentRun, ctx: ExtensionContext | undefined, delayMs: number): void {
    if (this.shuttingDown) return;

    const timer = setTimeout(() => {
      this.timers.delete(run.runId);
      void this.poll(run, ctx);
    }, delayMs);
    this.timers.set(run.runId, timer);
  }

  private async poll(run: TrackedAgentRun, ctx?: ExtensionContext): Promise<void> {
    if (this.shuttingDown) return;

    const { apiKey } = await resolveApiKey(ctx, { promptIfMissing: false });
    if (!apiKey) return;

    try {
      const latest = await getAgentRun(apiKey, run.runId);
      if (isTerminalAgentStatus(latest.status)) {
        const runs = (await readTrackedRuns()).filter((item) => item.runId !== run.runId);
        await writeTrackedRuns(runs);
        this.updateUi(ctx, runs);
        this.pi.sendUserMessage(makeFollowUp(latest), { deliverAs: 'followUp' });
        return;
      }

      const runs = await readTrackedRuns();
      const existing = runs.find((item) => item.runId === run.runId);
      if (existing) {
        existing.lastStatus = latest.status;
        await writeTrackedRuns(runs);
        this.updateUi(ctx, runs);
      }
    } catch {
      // Keep the run tracked; transient API/network failures can be retried next interval.
    }

    this.schedule(
      run,
      ctx,
      Math.max(1000, run.pollIntervalMs ?? DEFAULT_BACKGROUND_POLL_INTERVAL_MS),
    );
  }
}
