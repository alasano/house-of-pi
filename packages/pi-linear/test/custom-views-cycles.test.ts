import { describe, it, expect, vi, beforeAll } from 'vitest';
import { customViewTools } from '../extensions/tools/custom-views';
import { cycleTools } from '../extensions/tools/cycles';
import { initTheme } from '@earendil-works/pi-coding-agent';

beforeAll(() => {
  initTheme('light');
});

function fakeTheme() {
  const fg = vi.fn((_color: string, text: string) => text);
  return {
    fg,
    bold: vi.fn((text: string) => text),
  };
}

const renderOpts = { isPartial: false };
const renderCtx = {};

function renderResult(tool: { renderResult?: unknown }, result: unknown) {
  const renderer = tool.renderResult as
    | ((r: unknown, o: unknown, t: unknown, c: unknown) => unknown)
    | undefined;
  return renderer?.(result, renderOpts, fakeTheme(), renderCtx);
}

function toolByName(tools: Array<{ name: string }>, name: string) {
  const tool = tools.find((t) => t.name === name);
  expect(tool, `expected tool ${name} to exist`).toBeDefined();
  return tool;
}

describe('custom view tools', () => {
  const tools = customViewTools();

  it('exposes list/create/update/delete/preferences tools', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'linear_list_views',
      'linear_create_view',
      'linear_update_view',
      'linear_delete_view',
      'linear_set_view_preferences',
    ]);
  });

  it('create_view requires a name', async () => {
    const tool = toolByName(tools, 'linear_create_view');
    const schema = tool.parameters;
    // typebox: name is required (no default, non-optional)
    expect(schema.properties.name.type).toBe('string');
    expect(schema.required).toContain('name');
  });

  it('renders create view success with view details', () => {
    const tool = toolByName(tools, 'linear_create_view');
    const result = {
      content: [{ type: 'text' as const, text: '{}' }],
      details: {
        view: { id: 'v1', name: '本周执行', team: { key: 'BES' } },
      },
    };
    const text = renderResult(tool, result);
    expect(text).toBeDefined();
  });

  it('renders list result empty state', () => {
    const tool = toolByName(tools, 'linear_list_views');
    const result = { content: [{ type: 'text' as const, text: '{}' }], details: { views: [] } };
    const text = renderResult(tool, result);
    expect(text).toBeDefined();
  });

  it('delete_view renders success message', () => {
    const tool = toolByName(tools, 'linear_delete_view');
    const result = { content: [{ type: 'text' as const, text: '{}' }], details: { success: true } };
    const text = renderResult(tool, result);
    expect(text).toBeDefined();
  });
});

describe('cycle tools', () => {
  const tools = cycleTools();

  it('exposes list/create/update tools', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'linear_list_cycles',
      'linear_create_cycle',
      'linear_update_cycle',
    ]);
  });

  it('create_cycle requires startsAt and endsAt', () => {
    const tool = toolByName(tools, 'linear_create_cycle');
    expect(tool.parameters.required).toContain('startsAt');
    expect(tool.parameters.required).toContain('endsAt');
  });

  it('renders cycle mutation success', () => {
    const tool = toolByName(tools, 'linear_create_cycle');
    const result = {
      content: [{ type: 'text' as const, text: '{}' }],
      details: {
        cycle: { id: 'c1', name: 'W33', startsAt: '2026-08-10T00:00:00.000Z' },
      },
    };
    const text = renderResult(tool, result);
    expect(text).toBeDefined();
  });
});
