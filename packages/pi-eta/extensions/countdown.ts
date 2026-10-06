import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth } from '@earendil-works/pi-tui';
import type { EstimateRange, EtaTaskRecord } from './types';
import { formatDuration, formatRange } from './util';

const REFRESH_INTERVAL_MS = 120_000;
const TICK_INTERVAL_MS = 1_000;

function latestEstimate(record: EtaTaskRecord): { at: number; range: EstimateRange } {
  const update = record.latestUpdate;
  return {
    at: Date.parse(update?.updatedAt ?? record.startedAt),
    range: update
      ? (update.calibratedRange ?? update.estimate)
      : (record.calibratedRange ?? record.estimate),
  };
}

/** Request refresh halfway to the early bound, or every two minutes for longer work. */
export function nextEtaRefreshAt(record: EtaTaskRecord): number {
  const { at, range } = latestEstimate(record);
  return at + Math.min(REFRESH_INTERVAL_MS, range.lowMinutes * 60_000 * 0.5);
}

export function remainingEtaRange(record: EtaTaskRecord, now: number): EstimateRange {
  const { at, range } = latestEstimate(record);
  const elapsedMinutes = Math.max(0, now - at) / 60_000;
  return {
    lowMinutes: Math.max(0, range.lowMinutes - elapsedMinutes),
    highMinutes: Math.max(0, range.highMinutes - elapsedMinutes),
  };
}

function cleanSummary(summary: string): string {
  return Array.from(summary, (character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countdownLabel(record: EtaTaskRecord, now: number): string {
  const remaining = remainingEtaRange(record, now);
  if (remaining.highMinutes === 0) return 'ETA exceeded · update needed';
  if (remaining.lowMinutes === 0)
    return `ETA up to ${formatDuration(remaining.highMinutes)} · update due`;
  return `ETA ${formatRange(remaining)} remaining`;
}

/** The clock only paints UI. Reminders are consumed by the next ordinary LLM call. */
export class EtaCountdown {
  private ctx: ExtensionContext | undefined;
  private sessionId: string | undefined;
  private record: EtaTaskRecord | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active = false;
  private revision: string | undefined;
  private nextReminderAt = Infinity;
  private refreshPending = false;
  private backgroundRuns = new Set<string>();

  sync(ctx: ExtensionContext, record: EtaTaskRecord | undefined): void {
    if (record && record.sessionId !== ctx.sessionManager.getSessionId()) return;
    if (this.sessionId && this.sessionId !== ctx.sessionManager.getSessionId()) {
      this.stop();
    }
    this.ctx = ctx;
    this.sessionId = ctx.sessionManager.getSessionId();
    if (!record || record.finish) {
      this.record = undefined;
      this.revision = undefined;
      this.backgroundRuns.clear();
      this.clearTimer();
      this.clearUI();
      return;
    }
    const revision = `${record.taskId}:${record.latestUpdate?.eventId ?? record.startedAt}`;
    if (revision !== this.revision) {
      this.nextReminderAt = nextEtaRefreshAt(record);
      this.refreshPending = false;
      this.revision = revision;
    }
    this.record = record;
    this.paint();
    this.startTimer();
  }

  resume(): void {
    if (!this.active && this.record && this.backgroundRuns.size === 0) {
      // A paused estimate must be checked again; idle time does not imply progress.
      this.nextReminderAt = Date.now();
    }
    this.active = true;
    this.paint();
    this.startTimer();
  }

  pause(): void {
    this.active = false;
    if (this.backgroundRuns.size === 0) this.clearTimer();
    this.paint();
  }

  backgroundStarted(runId: string, sessionId: string): void {
    if (!this.record || !this.ctx) return;
    const identity =
      this.ctx.sessionManager.getSessionFile() ?? this.ctx.sessionManager.getSessionId();
    if (sessionId !== identity && sessionId !== this.record.sessionId) return;
    if (this.backgroundRuns.has(runId)) return;
    this.backgroundRuns.add(runId);
    this.nextReminderAt = Date.now();
    this.paint();
    this.startTimer();
  }

  backgroundCompleted(runId: string): void {
    if (!this.backgroundRuns.delete(runId)) return;
    this.nextReminderAt = Date.now();
    if (!this.active && this.backgroundRuns.size === 0) this.clearTimer();
    this.paint();
  }

  takeReminder(): string | undefined {
    if (!this.record || !this.active || Date.now() < this.nextReminderAt) return undefined;
    this.nextReminderAt = Date.now() + REFRESH_INTERVAL_MS;
    this.refreshPending = true;
    this.paint();
    return `Pi ETA refresh for task ${this.record.taskId}: before continuing substantial work, call eta_update with a fresh honest estimate of the work remaining from now, including outstanding subagent waiting, sequential dependencies, and integration. Parallel work uses the longest critical path. Update delegatedTasks with still-pending work, or [] when all subagents are done. If the promised task has ended, call eta_finish instead. Do not infer or repeat hidden calibrated values.`;
  }

  stop(): void {
    this.clearTimer();
    this.clearUI();
    this.ctx = undefined;
    this.sessionId = undefined;
    this.record = undefined;
    this.active = false;
    this.revision = undefined;
    this.nextReminderAt = Infinity;
    this.refreshPending = false;
    this.backgroundRuns.clear();
  }

  private startTimer(): void {
    if (
      this.timer ||
      !this.record ||
      !this.ctx?.hasUI ||
      (!this.active && this.backgroundRuns.size === 0)
    )
      return;
    this.timer = setInterval(() => this.paint(), TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private clearUI(): void {
    if (!this.ctx?.hasUI) return;
    this.ctx.ui.setStatus('pi-eta', undefined);
    this.ctx.ui.setWidget('pi-eta', undefined);
  }

  private paint(): void {
    if (!this.ctx?.hasUI || !this.record) return;
    if (this.ctx.sessionManager.getSessionId() !== this.sessionId) {
      this.stop();
      return;
    }
    const { ui } = this.ctx;
    const running = this.active || this.backgroundRuns.size > 0;
    const now = Date.now();
    const label = running ? countdownLabel(this.record, now) : 'ETA paused · re-estimate on resume';
    const warning = !running || now >= nextEtaRefreshAt(this.record);
    const suffix = this.refreshPending
      ? ' · refresh requested'
      : this.backgroundRuns.size > 0
        ? ' · subagents running'
        : running && warning && !label.includes('update')
          ? ' · update due'
          : '';
    const lines = [
      `${ui.theme.fg(warning ? 'warning' : 'accent', label + suffix)} · ${ui.theme.fg('muted', cleanSummary(this.record.taskSummary))}`,
    ];
    const delegated = this.record.delegatedTasks ?? [];
    if (delegated.length > 0) {
      const summaries = delegated
        .slice(0, 2)
        .map(
          (task) => `${cleanSummary(task.taskSummary)} ~${formatDuration(task.estimateMinutes)}`,
        );
      const more = delegated.length > 2 ? `; +${delegated.length - 2} more` : '';
      lines.push(
        ui.theme.fg('dim', `Subagents (latest estimates): ${summaries.join('; ')}${more}`),
      );
    }
    ui.setStatus('pi-eta', ui.theme.fg(warning ? 'warning' : 'accent', label));
    ui.setWidget(
      'pi-eta',
      () => ({
        render: (width) => lines.map((line) => truncateToWidth(line, width)),
        invalidate() {},
      }),
      { placement: 'aboveEditor' },
    );
  }
}
