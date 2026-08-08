import { expect } from 'vitest';
import { initTheme, type Theme } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences } from '@earendil-works/pi-tui';

// keyHint/jsonHint render through the global theme, so it must be initialized
// before any renderer runs.
initTheme('light');

// pi-coding-agent's export map exposes no live Theme instance, so renderers get
// an identity double; stripTerminalSequences removes the ANSI that global-theme
// helpers like keyHint still emit.
export const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const renderOpts = { isPartial: false, expanded: false };
const okContext = { isError: false };

type Renderable = { render: (width: number) => string[] };

export function renderPlain(
  tool: { renderResult?: unknown },
  result: unknown,
  context: { isError: boolean; args?: Record<string, unknown> } = okContext,
  width = 120,
): string {
  const renderer = tool.renderResult as
    | ((r: unknown, o: unknown, t: unknown, c: unknown) => Renderable | undefined)
    | undefined;
  const component = renderer?.(result, renderOpts, theme, context);
  return stripTerminalSequences(component?.render(width).join('\n') ?? '');
}

export function renderCallPlain(
  tool: { renderCall?: unknown },
  args: Record<string, unknown>,
  width = 120,
): string {
  const renderer = tool.renderCall as
    | ((args: Record<string, unknown>, theme: unknown) => Renderable)
    | undefined;
  return stripTerminalSequences(renderer?.(args, theme).render(width).join('\n') ?? '');
}

export function toolByName<T extends { name: string }>(tools: T[], name: string): T {
  const tool = tools.find((t) => t.name === name);
  expect(tool, `expected tool ${name} to exist`).toBeDefined();
  return tool as T;
}

type ExecutableTool = {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<unknown>;
};

export function executeTool(tool: unknown, params: Record<string, unknown>): Promise<unknown> {
  return (tool as ExecutableTool).execute('tool-call-1', params, undefined, undefined, {});
}

export function agentText(result: unknown): string {
  return (result as { content: Array<{ text?: string }> }).content[0]?.text ?? '';
}

export const emptyPageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};
