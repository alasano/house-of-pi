import { describe, it, expect, vi, beforeEach } from 'vitest';
import { customViewTools } from '../extensions/tools/custom-views';
import { linearGraphQL, resolveTeamId } from './client-mock';
import { agentText, emptyPageInfo, executeTool, renderPlain, toolByName } from './harness';

vi.mock('../extensions/client', () => import('./client-mock'));

describe('custom view tools', () => {
  const tools = customViewTools();

  beforeEach(() => {
    linearGraphQL.mockReset();
    resolveTeamId.mockReset();
  });

  it('renders an empty list state', () => {
    const tool = toolByName(tools, 'linear_list_views');
    const result = { content: [{ type: 'text' as const, text: '{}' }], details: { views: [] } };
    expect(renderPlain(tool, result)).toContain('No custom views found');
  });

  it('requests and renders custom view archive state only when present', async () => {
    const tool = toolByName(tools, 'linear_list_views');
    linearGraphQL.mockResolvedValue({
      customViews: {
        nodes: [
          {
            id: 'current-view',
            name: 'Current view',
            description: 'Current work',
            icon: 'Search',
            archivedAt: null,
          },
          {
            id: 'archived-view',
            name: 'Archived view',
            description: 'Historical work',
            icon: 'Archive',
            archivedAt: '2026-07-12T18:30:00.000Z',
          },
        ],
        pageInfo: emptyPageInfo,
      },
    });

    const result = await executeTool(tool, { includeArchived: true });
    const [, query, variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(query).toMatch(/\barchivedAt\b/);
    expect(variables).toEqual({ first: 50, includeArchived: true });
    expect(agentText(result)).toContain('2026-07-12T18:30:00.000Z');

    const text = renderPlain(tool, result);
    const lines = text.split('\n');
    const header = lines.find((line) => line.includes('Archived') && line.includes('Name'));
    const currentLine = lines.find((line) => line.includes('Current view'));
    const archivedLine = lines.find((line) => line.includes('Archived view'));
    expect(header?.indexOf('Archived')).toBeLessThan(header?.indexOf('Name') ?? -1);
    expect(currentLine).toContain('\u2014');
    expect(archivedLine).toContain('2026-07-12');

    const currentOnly = {
      content: [{ type: 'text' as const, text: '{}' }],
      details: { views: [{ id: 'current-view', name: 'Current view', archivedAt: null }] },
    };
    expect(renderPlain(tool, currentOnly)).not.toContain('Archived');
  });

  it('creates a view, resolving teamKey and compacting omitted inputs', async () => {
    const tool = toolByName(tools, 'linear_create_view');
    resolveTeamId.mockResolvedValue('team-9');
    linearGraphQL.mockResolvedValue({
      customViewCreate: {
        success: true,
        customView: { id: 'v1', name: '本周执行', shared: true, team: { key: 'BES' } },
      },
    });

    const result = await executeTool(tool, {
      name: '本周执行',
      teamKey: 'BES',
      shared: true,
      filterData: { assignee: { id: { eq: 'user-1' } } },
    });

    expect(resolveTeamId).toHaveBeenCalledWith('lin_api_test', { teamKey: 'BES' }, undefined);
    const [, query, variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(query).toContain('mutation CreateCustomView($input: CustomViewCreateInput!)');
    expect(variables).toEqual({
      input: {
        name: '本周执行',
        shared: true,
        teamId: 'team-9',
        filterData: { assignee: { id: { eq: 'user-1' } } },
      },
    });
    expect(agentText(result)).toContain('"name": "本周执行"');

    const text = renderPlain(tool, result);
    expect(text).toContain('✓ 本周执行');
    expect(text).toContain('team: BES');
    expect(text).toContain('shared');
  });

  it('updates a view with only the provided fields', async () => {
    const tool = toolByName(tools, 'linear_update_view');
    linearGraphQL.mockResolvedValue({
      customViewUpdate: { success: true, customView: { id: 'v1', name: 'Renamed' } },
    });

    const result = await executeTool(tool, { id: 'v1', name: 'Renamed' });

    const [, query, variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(query).toContain(
      'mutation UpdateCustomView($id: String!, $input: CustomViewUpdateInput!)',
    );
    expect(variables).toEqual({ id: 'v1', input: { name: 'Renamed' } });
    expect(renderPlain(tool, result)).toContain('✓ Renamed');
  });

  it.each([
    {
      toolName: 'linear_create_view',
      payloadName: 'customViewCreate',
      params: { name: 'View' },
      payload: { success: false, customView: null },
      message: 'Linear failed to create the view.',
    },
    {
      toolName: 'linear_update_view',
      payloadName: 'customViewUpdate',
      params: { id: 'v1', name: 'View' },
      payload: { success: false, customView: null },
      message: 'Linear failed to update the view.',
    },
    {
      toolName: 'linear_create_view',
      payloadName: 'customViewCreate',
      params: { name: 'View' },
      payload: { success: true, customView: null },
      message: 'Linear reported that it created the view but returned no view.',
    },
    {
      toolName: 'linear_update_view',
      payloadName: 'customViewUpdate',
      params: { id: 'v1', name: 'View' },
      payload: { success: true, customView: null },
      message: 'Linear reported that it updated the view but returned no view.',
    },
  ])(
    '$toolName rejects an invalid payload: $message',
    async ({ toolName, payloadName, params, payload, message }) => {
      const tool = toolByName(tools, toolName);
      linearGraphQL.mockResolvedValue({ [payloadName]: payload });

      await expect(executeTool(tool, params)).rejects.toThrow(message);
      expect(linearGraphQL.mock.calls[0]?.[1]).toContain('success');
    },
  );

  it('renders execution errors instead of reporting completion', () => {
    const tool = toolByName(tools, 'linear_create_view');
    const text = renderPlain(
      tool,
      { content: [{ type: 'text' as const, text: 'Linear failed to create the view.' }] },
      { isError: true },
    );

    expect(text).toContain('✗ Linear failed to create the view.');
    expect(text).not.toContain('Custom view operation completed.');
  });

  it('deletes a view and renders the outcome', async () => {
    const tool = toolByName(tools, 'linear_delete_view');
    linearGraphQL.mockResolvedValue({ customViewDelete: { success: true } });

    const result = await executeTool(tool, { id: 'v1' });

    const [, query, variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(query).toContain('mutation DeleteCustomView($id: String!)');
    expect(variables).toEqual({ id: 'v1' });
    expect(agentText(result)).toContain('"success": true');
    expect(renderPlain(tool, result)).toContain('✓ View deleted');
  });

  it('renders a delete failure when Linear reports no success', async () => {
    const tool = toolByName(tools, 'linear_delete_view');
    linearGraphQL.mockResolvedValue({ customViewDelete: { success: false } });

    const result = await executeTool(tool, { id: 'v1' });

    expect(renderPlain(tool, result)).toContain('✗ Failed to delete view');
  });

  it('sets view preferences with the user/customView envelope', async () => {
    const tool = toolByName(tools, 'linear_set_view_preferences');
    linearGraphQL.mockResolvedValue({
      viewPreferencesCreate: {
        viewPreferences: { id: 'p1', type: 'user', viewType: 'customView' },
      },
    });

    const result = await executeTool(tool, {
      viewId: 'v1',
      preferences: { issueGrouping: 'assignee', fieldPriority: true },
    });

    const [, query, variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(query).toContain('mutation SetViewPreferences($input: ViewPreferencesCreateInput!)');
    expect(variables).toEqual({
      input: {
        type: 'user',
        viewType: 'customView',
        customViewId: 'v1',
        preferences: { issueGrouping: 'assignee', fieldPriority: true },
      },
    });
    expect(agentText(result)).toContain('"issueGrouping": "assignee"');
    expect(renderPlain(tool, result)).toContain('✓ View preferences updated · group: assignee');
  });
});
