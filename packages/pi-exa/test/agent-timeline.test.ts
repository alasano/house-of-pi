import type { Theme } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TIMELINE_MAX_EVENTS,
  AgentTimeline,
  type AgentTimelineSnapshot,
} from '../extensions/agent-timeline';
import { renderExaResult } from '../extensions/render';

const theme = {
  fg: (_color: string, text: string) => text,
} as Theme;

function renderTimeline(snapshot: AgentTimelineSnapshot, expanded: boolean): string {
  const component = renderExaResult(
    {
      content: [{ type: 'text', text: snapshot.events.at(-1) || '' }],
      details: {
        monitor: 'stream',
        preview: {
          kind: 'agent',
          summary: `${snapshot.status} | ${snapshot.totalEvents} events`,
          lines: snapshot.events,
        },
      },
    },
    { expanded, isPartial: true },
    theme,
    'Running Exa Agent...',
  );

  return component.render(120).join('\n');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Exa Agent timeline', () => {
  it('retains only the latest events while tracking the total count', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const snapshots: AgentTimelineSnapshot[] = [];
    const timeline = new AgentTimeline((snapshot) => snapshots.push(snapshot));

    for (let index = 1; index <= 10; index += 1) {
      timeline.append(`event-${index}`);
    }
    timeline.flush();

    const latest = snapshots.at(-1);
    expect(latest).toEqual({
      events: ['event-5', 'event-6', 'event-7', 'event-8', 'event-9', 'event-10'],
      totalEvents: 10,
      status: 'running',
    });
    expect(latest?.events).toHaveLength(AGENT_TIMELINE_MAX_EVENTS);
    timeline.dispose();
  });

  it('emits immutable snapshots', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const snapshots: AgentTimelineSnapshot[] = [];
    const timeline = new AgentTimeline((snapshot) => snapshots.push(snapshot));

    timeline.append('first');
    const firstSnapshot = snapshots[0];
    timeline.append('second');
    timeline.flush();

    expect(firstSnapshot).toEqual({ events: ['first'], totalEvents: 1, status: 'running' });
    timeline.dispose();
  });

  it('coalesces burst updates and flushes the latest snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const snapshots: AgentTimelineSnapshot[] = [];
    const timeline = new AgentTimeline((snapshot) => snapshots.push(snapshot));

    timeline.append('first');
    timeline.append('second');
    timeline.append('third', 'completed');

    expect(snapshots).toHaveLength(1);
    vi.advanceTimersByTime(99);
    expect(snapshots).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual({
      events: ['first', 'second', 'third'],
      totalEvents: 3,
      status: 'completed',
    });
    timeline.dispose();
  });

  it('renders only the bounded active window even when expanded', () => {
    const snapshot: AgentTimelineSnapshot = {
      events: ['recent-1', 'recent-2', 'recent-3', 'recent-4', 'recent-5', 'recent-6'],
      totalEvents: 12,
      status: 'running',
    };

    const rendered = renderTimeline(snapshot, true);
    expect(rendered).toContain('running | 12 events');
    expect(rendered).toContain('Latest streaming events:');
    expect(rendered).toContain('recent-1');
    expect(rendered).toContain('recent-6');
  });

  it('keeps polling progress compact', () => {
    const component = renderExaResult(
      {
        content: [{ type: 'text', text: 'polling' }],
        details: {
          monitor: 'poll',
          preview: {
            kind: 'agent',
            summary: 'running | elapsed 4s',
            lines: ['Run ID: agent_run_test', 'Status: running'],
            expandedLines: ['Run ID: agent_run_test', 'Status: running'],
          },
        },
      },
      { expanded: false, isPartial: true },
      theme,
      'Running Exa Agent...',
    );
    const rendered = component.render(120).join('\n');

    expect(rendered).toContain('Polling status:');
    expect(rendered).toContain('Run ID: agent_run_test');
    expect(rendered).toContain('Status: running');
  });

  it('respects the collapsed preview during partial rendering', () => {
    const component = renderExaResult(
      {
        content: [{ type: 'text', text: 'recent' }],
        details: {
          monitor: 'stream',
          preview: {
            kind: 'agent',
            summary: 'running',
            lines: ['recent'],
            expandedLines: ['oldest-only', 'recent'],
          },
        },
      },
      { expanded: false, isPartial: true },
      theme,
      'Running Exa Agent...',
    );
    const rendered = component.render(120).join('\n');

    expect(rendered).toContain('recent');
    expect(rendered).not.toContain('oldest-only');
  });
});
