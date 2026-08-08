import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { customViewTools } from '../extensions/tools/custom-views';
import { cycleTools } from '../extensions/tools/cycles';
import { initTheme } from '@earendil-works/pi-coding-agent';

const clientMocks = vi.hoisted(() => ({
  linearGraphQL: vi.fn(),
  resolveTeamId: vi.fn(),
  withLinearAuth: vi.fn(
    async (
      _ctx: unknown,
      _signal: AbortSignal | undefined,
      handler: (apiKey: string) => Promise<unknown>,
    ) => handler('lin_api_test'),
  ),
}));

vi.mock('../extensions/client', () => clientMocks);

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

const renderOpts = { isPartial: false, expanded: false };
const renderCtx = { isError: false };

function renderResult(
  tool: { renderResult?: unknown },
  result: unknown,
  context: { isError: boolean } = renderCtx,
) {
  const renderer = tool.renderResult as
    | ((r: unknown, o: unknown, t: unknown, c: unknown) => unknown)
    | undefined;
  return renderer?.(result, renderOpts, fakeTheme(), context);
}

function renderedText(
  tool: { renderResult?: unknown },
  result: unknown,
  context: { isError: boolean } = renderCtx,
  width = 120,
): string {
  const component = renderResult(tool, result, context) as
    | { render: (width: number) => string[] }
    | undefined;
  return component?.render(width).join('\n') ?? '';
}

function toolByName(tools: Array<{ name: string }>, name: string) {
  const tool = tools.find((t) => t.name === name);
  expect(tool, `expected tool ${name} to exist`).toBeDefined();
  return tool;
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

function executeTool(tool: unknown, params: Record<string, unknown>): Promise<unknown> {
  return (tool as ExecutableTool).execute('tool-call-1', params, undefined, undefined, {});
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

  beforeEach(() => {
    clientMocks.linearGraphQL.mockReset();
    clientMocks.resolveTeamId.mockReset();
  });

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
        cycle: {
          id: 'c1',
          name: 'W33',
          startsAt: '2026-08-10T00:00:00.000Z',
          isFuture: true,
          isNext: true,
          progress: 0.25,
        },
      },
    };
    const text = renderedText(tool, result);
    expect(text).toContain('upcoming · next');
    expect(text).toContain('progress 25%');
  });

  it('requests Linear authoritative cycle status fields', async () => {
    const tool = toolByName(tools, 'linear_list_cycles');
    clientMocks.linearGraphQL.mockResolvedValue({
      cycles: {
        nodes: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    });

    await executeTool(tool, {});

    const query = clientMocks.linearGraphQL.mock.calls[0]?.[1] as string;
    expect(query).toMatch(/\bisActive\b/);
    expect(query).toMatch(/\bisFuture\b/);
    expect(query).toMatch(/\bisPast\b/);
    expect(query).toMatch(/\bisNext\b/);
    expect(query).toMatch(/\bisPrevious\b/);
    expect(query).toMatch(/\bprogress\b/);
  });

  it('renders cycle status from Linear fields instead of inferring it from dates', () => {
    const tool = toolByName(tools, 'linear_list_cycles');
    const result = {
      content: [{ type: 'text' as const, text: '{}' }],
      details: {
        cycles: [
          {
            id: 'active-cycle',
            name: 'API says active',
            startsAt: '2999-01-01T00:00:00.000Z',
            endsAt: '2999-01-08T00:00:00.000Z',
            isActive: true,
            isFuture: false,
            isPast: false,
            progress: 0.42,
          },
          {
            id: 'future-cycle',
            name: 'API says future',
            startsAt: '2000-01-01T00:00:00.000Z',
            endsAt: '2000-01-08T00:00:00.000Z',
            isActive: false,
            isFuture: true,
            isPast: false,
            isNext: true,
            progress: 0,
          },
          {
            id: 'previous-cycle',
            name: 'API says previous',
            startsAt: '2999-02-01T00:00:00.000Z',
            endsAt: '2999-02-08T00:00:00.000Z',
            completedAt: '2026-08-01T00:00:00.000Z',
            isActive: false,
            isFuture: false,
            isPast: true,
            isPrevious: true,
            progress: 0.78,
          },
        ],
      },
    };

    const text = renderedText(tool, result);
    expect(text).toContain('active');
    expect(text).toContain('upcoming · next');
    expect(text).toContain('completed · previous');
    expect(text).toContain('42%');
    expect(text).toContain('0%');
    expect(text).toContain('78%');
    expect(text).not.toContain('past');

    const narrowText = renderedText(tool, result, renderCtx, 60);
    expect(narrowText).toContain('42%');
    expect(narrowText).toContain('upcoming · next');
    expect(narrowText).toContain('completed · previous');
  });

  it.each([
    {
      toolName: 'linear_create_cycle',
      payloadName: 'cycleCreate',
      params: {
        teamId: 'team-1',
        startsAt: '2026-08-10T00:00:00.000Z',
        endsAt: '2026-08-24T00:00:00.000Z',
      },
      operation: 'create',
    },
    {
      toolName: 'linear_update_cycle',
      payloadName: 'cycleUpdate',
      params: { id: 'cycle-1', name: 'Updated cycle' },
      operation: 'update',
    },
  ])(
    '$toolName rejects an unsuccessful Linear payload',
    async ({ toolName, payloadName, params, operation }) => {
      const tool = toolByName(tools, toolName);
      clientMocks.linearGraphQL.mockResolvedValue({
        [payloadName]: { success: false, cycle: null },
      });

      await expect(executeTool(tool, params)).rejects.toThrow(
        `Linear failed to ${operation} the cycle.`,
      );

      const query = clientMocks.linearGraphQL.mock.calls[0]?.[1];
      expect(query).toContain('success');
    },
  );

  it('rejects a successful payload that returns no cycle', async () => {
    const tool = toolByName(tools, 'linear_create_cycle');
    clientMocks.linearGraphQL.mockResolvedValue({
      cycleCreate: { success: true, cycle: null },
    });

    await expect(
      executeTool(tool, {
        teamId: 'team-1',
        startsAt: '2026-08-10T00:00:00.000Z',
        endsAt: '2026-08-24T00:00:00.000Z',
      }),
    ).rejects.toThrow('Linear reported that it created the cycle but returned no cycle.');
  });

  it('renders execution errors instead of reporting completion', () => {
    const tool = toolByName(tools, 'linear_update_cycle');
    const text = renderedText(
      tool,
      {
        content: [{ type: 'text' as const, text: 'Linear failed to update the cycle.' }],
      },
      { isError: true },
    );

    expect(text).toContain('Linear failed to update the cycle.');
    expect(text).not.toContain('Cycle operation completed.');
  });
});
