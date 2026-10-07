export type EtaBootstrapStatus = 'pending' | 'unavailable' | 'missing';

const START_EXAMPLE = '{"taskSummary":"Complete the requested work","estimateMinutes":3}';

/** At most two reminders in an ordinary run; successful timing or closure latches it off. */
export class EtaBootstrap {
  private sessionId: string | undefined;
  private closed = true;
  private reminders = 0;
  private businessToolFinished = false;

  begin(sessionId: string): void {
    this.sessionId = sessionId;
    this.closed = false;
    this.reminders = 0;
    this.businessToolFinished = false;
  }

  close(): void {
    this.closed = true;
  }

  businessToolEnded(toolName: string): void {
    if (!this.closed && !toolName.startsWith('eta_')) this.businessToolFinished = true;
  }

  status(toolActive: boolean): EtaBootstrapStatus | undefined {
    if (this.closed) return undefined;
    if (!toolActive) return 'unavailable';
    return this.reminders >= 2 ? 'missing' : 'pending';
  }

  takeReminder(sessionId: string, toolActive: boolean): string | undefined {
    if (sessionId !== this.sessionId || this.closed || !toolActive) return undefined;
    if (this.reminders === 0) {
      this.reminders += 1;
      return `Pi ETA start reminder: if the requested work is substantial (normally more than about one minute), call eta_start before doing that work with a named finish line and your own honest duration estimate. Trivial immediate tasks may skip it. Valid JSON shape example: ${START_EXAMPLE}. Replace the example summary and number with your actual task and honest estimate; estimateLowMinutes/estimateHighMinutes can be used instead for a range. Include delegated work and waiting in the total critical path. After estimating, continue the original user's requested task; this timing reminder does not replace it.`;
    }
    if (this.reminders === 1 && this.businessToolFinished) {
      this.reminders += 1;
      return `Pi ETA start follow-up: work has already begun without an ETA. If substantial work (normally more than about one minute) still remains, call eta_start now for only the work remaining from now, using your honest estimate and a named finish line. Valid JSON shape example: ${START_EXAMPLE}. Replace the example values; a low/high range is also supported. Include outstanding delegated work, waits, and integration. Do not repeat completed work, count elapsed work in this estimate, or delay a trivial finish just to start a timer. Continue the original user's requested task; this is the last start reminder for this run.`;
    }
    return undefined;
  }
}
