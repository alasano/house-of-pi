import { truncateToWidth, visibleWidth, type Component, type TUI } from '@earendil-works/pi-tui';
import type { TrackedAgentRun } from './agent-tracker';

const GOLD_FG = '\x1b[38;2;212;162;46m';
const GREEN_FG = '\x1b[38;2;96;176;88m';
const RESET_FG = '\x1b[39m';
const SEPARATOR = ' │ ';
const MIN_INNER = 34;
const MAX_INNER = 96;

function tint(text: string, color: string): string {
  return `${color}${text}${RESET_FG}`;
}

function gold(text: string): string {
  return tint(text, GOLD_FG);
}

function padVisible(text: string, width: number): string {
  const deficit = width - visibleWidth(text);
  return deficit <= 0 ? text : `${text}${' '.repeat(deficit)}`;
}

function panelHeaderLeft(title: string): string {
  return `─ ${title} `;
}

function formatElapsed(createdAt: string | undefined): string | undefined {
  if (!createdAt) return undefined;
  const startedAt = Date.parse(createdAt);
  if (!Number.isFinite(startedAt)) return undefined;

  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function runLabel(runs: TrackedAgentRun[]): string {
  if (runs.length !== 1) return `${runs.length} running`;

  const run = runs[0]!;
  const status = run.lastStatus || 'running';
  const elapsed = formatElapsed(run.createdAt);
  return elapsed ? `${status} ${elapsed}` : status;
}

function taskText(runs: TrackedAgentRun[]): string {
  const first = runs[0];
  const base = first?.query || '(no query)';
  return runs.length > 1 ? `${base} (+${runs.length - 1} more)` : base;
}

function renderRow(label: string, content: string, contentWidth: number): string {
  const labelText = tint(label, GREEN_FG);
  const valueWidth = Math.max(1, contentWidth - visibleWidth(label) - visibleWidth(SEPARATOR));
  return `${labelText}${SEPARATOR}${truncateToWidth(content, valueWidth, '…', true)}`;
}

function framePanel(title: string, rightText: string, bodyLine: string, inner: number): string[] {
  const leftHeader = panelHeaderLeft(title);
  const rightSegment = rightText ? ` ${rightText} ` : '';
  const fill = Math.max(1, inner - visibleWidth(leftHeader) - visibleWidth(rightSegment));
  const top =
    gold('╭') +
    gold(leftHeader) +
    gold('─'.repeat(fill)) +
    (rightSegment ? gold(rightSegment) : '') +
    gold('╮');
  const bottom = gold('╰') + gold('─'.repeat(inner)) + gold('╯');
  const contentWidth = Math.max(8, inner - 2);
  return [top, gold('│ ') + padVisible(bodyLine, contentWidth) + gold(' │'), bottom];
}

function computeInnerWidth({
  title,
  rightText,
  bodyWidth,
  maxInner,
}: {
  title: string;
  rightText: string;
  bodyWidth: number;
  maxInner: number;
}): number {
  const headerWidth = visibleWidth(panelHeaderLeft(title)) + visibleWidth(` ${rightText} `) + 1;
  const naturalInner = Math.max(headerWidth, bodyWidth + 2);
  return Math.max(Math.min(maxInner, naturalInner), Math.min(maxInner, MIN_INNER));
}

export class AgentRunsWidget implements Component {
  private runs: TrackedAgentRun[];
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly tui: TUI,
    runs: TrackedAgentRun[],
  ) {
    this.runs = runs.map((run) => ({ ...run }));
    this.timer = setInterval(() => this.tui.requestRender(), 1000);
  }

  setRuns(runs: TrackedAgentRun[]): void {
    this.runs = runs.map((run) => ({ ...run }));
    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (this.runs.length === 0) return [];

    const safeWidth = Math.max(1, width);
    const title = 'EXA AGENT';
    const rightText = runLabel(this.runs);
    const label = this.runs.length === 1 ? 'task' : 'tasks';
    const content = taskText(this.runs).replace(/\s+/g, ' ').trim();
    const naturalBodyWidth = visibleWidth(label) + visibleWidth(SEPARATOR) + visibleWidth(content);
    const maxInner = Math.max(8, Math.min(safeWidth - 2, MAX_INNER));
    const inner = computeInnerWidth({
      title,
      rightText,
      bodyWidth: naturalBodyWidth,
      maxInner,
    });
    const bodyLine = renderRow(label, content, Math.max(8, inner - 2));

    return framePanel(title, rightText, bodyLine, inner).map((line) =>
      truncateToWidth(line, safeWidth, '', true),
    );
  }

  invalidate(): void {}

  dispose(): void {
    clearInterval(this.timer);
  }
}
