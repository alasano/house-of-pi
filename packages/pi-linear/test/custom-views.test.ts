import { describe, it, expect, vi, beforeEach } from 'vitest';
import { customViewTools } from '../extensions/tools/custom-views';
import { linearGraphQL, resolveTeamId } from './client-mock';
import {
  agentText,
  emptyPageInfo,
  executeTool,
  renderCallPlain,
  renderPlain,
  toolByName,
} from './harness';

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

  it('gets a view by ID or slug and renders a labeled detail card', async () => {
    const tool = toolByName(tools, 'linear_get_view');
    linearGraphQL.mockResolvedValue({
      customView: {
        id: 'v1',
        name: 'Triage',
        modelName: 'Issue',
        filterData: { state: { name: { eq: 'Triage' } } },
        team: { key: 'PI' },
        shared: false,
        icon: 'Search',
        slugId: 'abc123def456',
        description: 'Triage queue for PI',
      },
    });

    const result = await executeTool(tool, { id: 'triage-slug' });

    const [, query, variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(query).toContain('query GetCustomView($id: String!)');
    expect(query).toContain('customView(id: $id)');
    expect(variables).toEqual({ id: 'triage-slug' });
    expect(agentText(result)).toContain('"name": "Triage"');

    expect(renderCallPlain(tool, { id: 'triage-slug' })).toContain(
      'linear_get_view id=triage-slug',
    );
    const text = renderPlain(tool, result);
    expect(text).toContain('✓ View Triage');
    expect(text).toMatch(/Type\s+issues view/);
    expect(text).toMatch(/Scope\s+team: PI/);
    expect(text).toMatch(/Shared\s+private/);
    expect(text).toMatch(/Icon\s+Search/);
    expect(text).toMatch(/Filter\s+state/);
    expect(text).toMatch(/Slug\s+abc123def456/);
    expect(text).toMatch(/Description\s+Triage queue for PI/);
    expect(text).toContain('show full JSON');

    const projectView = {
      content: [{ type: 'text' as const, text: '{}' }],
      details: {
        view: {
          id: 'v2',
          name: 'Roadmap',
          modelName: 'Project',
          projectFilterData: { state: { eq: 'started' } },
        },
      },
    };
    const projectText = renderPlain(tool, projectView);
    expect(projectText).toMatch(/Type\s+projects view/);
    expect(projectText).toMatch(/Filter\s+state/);
    expect(projectText).toMatch(/Scope\s+workspace/);
  });

  it('lists non-issue views with their type instead of "no filter"', () => {
    const tool = toolByName(tools, 'linear_list_views');
    const result = {
      content: [{ type: 'text' as const, text: '{}' }],
      details: {
        views: [
          {
            id: 'v1',
            name: 'Triage view',
            modelName: 'Issue',
            filterData: { state: { name: { eq: 'Triage' } } },
          },
          {
            id: 'v2',
            name: 'Roadmap view',
            modelName: 'Project',
            filterData: {},
            projectFilterData: { state: { eq: 'started' } },
          },
          {
            id: 'v3',
            name: 'Digest view',
            modelName: 'FeedItem',
            filterData: {},
            feedItemFilterData: { type: { eq: 'post' } },
          },
        ],
      },
    };

    const text = renderPlain(tool, result);
    const lines = text.split('\n');
    const header = lines.find((line) => line.includes('Type') && line.includes('Name'));
    expect(header).toBeDefined();
    expect(lines.find((line) => line.includes('Triage view'))).toContain('issues');
    expect(lines.find((line) => line.includes('Roadmap view'))).toContain('projects');
    expect(lines.find((line) => line.includes('Digest view'))).toContain('updates');

    const issueOnly = {
      content: [{ type: 'text' as const, text: '{}' }],
      details: { views: [{ id: 'v1', name: 'Only issues', modelName: 'Issue' }] },
    };
    expect(renderPlain(tool, issueOnly)).not.toContain('Type');
  });

  it('creates a projects view with projectFilterData', async () => {
    const tool = toolByName(tools, 'linear_create_view');
    linearGraphQL.mockResolvedValue({
      customViewCreate: {
        success: true,
        customView: {
          id: 'v2',
          name: 'Roadmap',
          modelName: 'Project',
          projectFilterData: { state: { eq: 'started' } },
        },
      },
    });

    const result = await executeTool(tool, {
      name: 'Roadmap',
      projectFilterData: { state: { eq: 'started' } },
    });

    const [, , variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(variables).toEqual({
      input: { name: 'Roadmap', projectFilterData: { state: { eq: 'started' } } },
    });

    const text = renderPlain(tool, result);
    expect(text).toContain('✓ Created Roadmap');
    expect(text).toContain('projects view');
    expect(text).toContain('filter: state');
  });

  it('updates a view filter of any type', async () => {
    const tool = toolByName(tools, 'linear_update_view');
    linearGraphQL.mockResolvedValue({
      customViewUpdate: {
        success: true,
        customView: { id: 'v3', name: 'Digest', modelName: 'FeedItem' },
      },
    });

    await executeTool(tool, { id: 'v3', feedItemFilterData: { type: { eq: 'post' } } });

    const [, , variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(variables).toEqual({
      id: 'v3',
      input: { feedItemFilterData: { type: { eq: 'post' } } },
    });
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
    expect(text).toContain('✓ Created 本周执行');
    expect(text).toContain('team: BES');
    expect(text).toContain('shared');
  });

  it('renders create call arguments including team key, shared flag, and filters', () => {
    const tool = toolByName(tools, 'linear_create_view');
    const call = renderCallPlain(tool, {
      name: 'Roadmap',
      teamKey: 'BES',
      shared: false,
      projectFilterData: { state: { eq: 'started' } },
    });
    expect(call).toContain('team=BES');
    expect(call).toContain('shared=false');
    expect(call).toContain('projectFilter={…}');
  });

  it('renders list errors instead of an empty state', () => {
    const tool = toolByName(tools, 'linear_list_views');
    const text = renderPlain(
      tool,
      { content: [{ type: 'text' as const, text: 'Linear GraphQL error: rate limited' }] },
      { isError: true },
    );

    expect(text).toContain('✗ Linear GraphQL error: rate limited');
    expect(text).not.toContain('No custom views found');
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
    expect(renderPlain(tool, result)).toContain('✓ Updated Renamed');
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
    expect(renderCallPlain(tool, { id: 'v1' })).toContain('id=v1');
    expect(renderPlain(tool, result, { isError: false, args: { id: 'v1' } })).toContain(
      '✓ Deleted view v1',
    );
  });

  it('renders a delete failure when Linear reports no success', async () => {
    const tool = toolByName(tools, 'linear_delete_view');
    linearGraphQL.mockResolvedValue({ customViewDelete: { success: false } });

    const result = await executeTool(tool, { id: 'v1' });

    expect(renderPlain(tool, result, { isError: false, args: { id: 'v1' } })).toContain(
      '✗ Failed to delete view v1',
    );
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
    const text = renderPlain(tool, result, { isError: false, args: { viewId: 'v1' } });
    expect(text).toContain('✓ View preferences updated');
    expect(text).toContain('view v1');
    expect(text).toContain('issueGrouping: assignee');
    expect(text).toContain('fieldPriority: true');
  });
});
