export const AGENT_TIMELINE_MAX_EVENTS = 6;
export const AGENT_TIMELINE_UPDATE_THROTTLE_MS = 100;

export interface AgentTimelineSnapshot {
  events: string[];
  totalEvents: number;
  status: string;
}

interface AgentTimelineOptions {
  maxEvents?: number;
  throttleMs?: number;
}

export class AgentTimeline {
  private readonly events: string[] = [];
  private readonly maxEvents: number;
  private readonly throttleMs: number;
  private totalEvents = 0;
  private status = 'running';
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private updateDirty = false;
  private lastUpdateAt = 0;

  constructor(
    private readonly onUpdate: (snapshot: AgentTimelineSnapshot) => void,
    options: AgentTimelineOptions = {},
  ) {
    this.maxEvents = Math.max(1, options.maxEvents ?? AGENT_TIMELINE_MAX_EVENTS);
    this.throttleMs = Math.max(0, options.throttleMs ?? AGENT_TIMELINE_UPDATE_THROTTLE_MS);
  }

  append(event: string, status = 'running'): void {
    this.totalEvents += 1;
    this.status = status;
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    this.scheduleUpdate();
  }

  flush(): void {
    this.clearUpdateTimer();
    this.emitUpdate();
  }

  dispose(): void {
    this.clearUpdateTimer();
  }

  private scheduleUpdate(): void {
    this.updateDirty = true;
    const delay = this.throttleMs - (Date.now() - this.lastUpdateAt);
    if (delay <= 0) {
      this.clearUpdateTimer();
      this.emitUpdate();
      return;
    }

    this.updateTimer ??= setTimeout(() => {
      this.updateTimer = undefined;
      this.emitUpdate();
    }, delay);
  }

  private emitUpdate(): void {
    if (!this.updateDirty) return;
    this.updateDirty = false;
    this.lastUpdateAt = Date.now();
    this.onUpdate({
      events: [...this.events],
      totalEvents: this.totalEvents,
      status: this.status,
    });
  }

  private clearUpdateTimer(): void {
    if (!this.updateTimer) return;
    clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
  }
}
