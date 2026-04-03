import { visibleWidth } from '@mariozechner/pi-tui';

export { visibleWidth };

export const GOLD_FG = '\x1b[38;2;212;162;46m';
export const GREEN_FG = '\x1b[38;2;96;176;88m';
export const GREEN_DARK_FG = '\x1b[38;2;62;124;66m';
export const RESET_FG = '\x1b[39m';

export function tint(text: string, color: string): string {
  return `${color}${text}${RESET_FG}`;
}

export function gold(text: string): string {
  return tint(text, GOLD_FG);
}

export function padVisible(text: string, width: number): string {
  const deficit = width - visibleWidth(text);
  if (deficit <= 0) return text;
  return `${text}${' '.repeat(deficit)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function formatCompactTokens(tokens: number | null | undefined): string {
  if (tokens == null || Number.isNaN(tokens)) return '?';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}k`;
  return `${tokens}`;
}

export function usageColor(percent: number | null): string {
  if (percent == null) return '\x1b[38;2;160;160;160m';
  if (percent < 40) return '\x1b[38;2;88;172;98m'; // green
  if (percent < 60) return '\x1b[38;2;145;182;78m'; // lime
  if (percent < 75) return '\x1b[38;2;213;176;68m'; // yellow
  if (percent < 90) return '\x1b[38;2;214;140;52m'; // orange
  return '\x1b[38;2;200;84;74m'; // red
}

export function maxVisibleWidth(lines: string[]): number {
  return lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
}
