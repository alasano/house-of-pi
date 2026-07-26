import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatRange,
  formatTimestamp,
  formatTimestampRelativeTo,
  profileKeyFor,
  snapDuration,
} from '../extensions/util';

describe('duration formatting', () => {
  it('uses whole seconds, minutes with seconds, and hours with minutes', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(0.2)).toBe('12s');
    expect(formatDuration(1)).toBe('1m');
    expect(formatDuration(1.2)).toBe('1m12s');
    expect(formatDuration(59 + 59 / 60)).toBe('59m59s');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(125)).toBe('2h5m');
    expect(formatDuration(24 * 60)).toBe('24h');
  });

  it('uses a spaced en dash and collapses equal rendered endpoints', () => {
    expect(formatRange({ lowMinutes: 1.2, highMinutes: 2 + 7 / 60 })).toBe('1m12s – 2m7s');
    expect(formatRange({ lowMinutes: 1, highMinutes: 1.001 })).toBe('1m');
  });
});

describe('size band boundaries', () => {
  it('snaps to the nearest round reporting duration in log space', () => {
    expect(snapDuration(13.2)).toBe(15);
    expect(snapDuration(7.7)).toBe(10);
    expect(snapDuration(6.9)).toBe(5);
    expect(snapDuration(77.9)).toBe(90);
    expect(snapDuration(0.4)).toBe(1);
    expect(snapDuration(10_000)).toBe(720);
  });
});

describe('execution profile keys', () => {
  it('keeps unknown thinking levels in their own profile', () => {
    expect(profileKeyFor('openai-codex/gpt-5.6-sol', 'xhigh')).toBe(
      'openai-codex/gpt-5.6-sol:xhigh',
    );
    expect(profileKeyFor('openai-codex/gpt-5.6-sol', undefined)).toBe(
      'openai-codex/gpt-5.6-sol:unknown',
    );
    expect(profileKeyFor('a/b', undefined)).not.toBe(profileKeyFor('a/b', 'low'));
  });
});

describe('timestamp formatting', () => {
  it('uses a locale-independent ISO-style local date and 24-hour time', () => {
    const timestamp = new Date(2026, 6, 25, 13, 42, 58).toISOString();
    expect(formatTimestamp(timestamp)).toBe('2026-07-25 13:42:58');
  });

  it('omits the repeated date on the same local day', () => {
    const started = new Date(2026, 6, 25, 23, 58, 0).toISOString();
    const sameDay = new Date(2026, 6, 25, 23, 59, 30).toISOString();
    const nextDay = new Date(2026, 6, 26, 0, 1, 0).toISOString();

    expect(formatTimestampRelativeTo(sameDay, started)).toBe('23:59:30');
    expect(formatTimestampRelativeTo(nextDay, started)).toBe('2026-07-26 00:01:00');
  });
});
