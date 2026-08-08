import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cycleTools } from '../extensions/tools/cycles';
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

describe('cycle tools', () => {
  const tools = cycleTools();

  beforeEach(() => {
    linearGraphQL.mockReset();
    resolveTeamId.mockReset();
  });

  it('archive_cycle description forbids automatic archiving', () => {
    const tool = toolByName(tools, 'linear_archive_cycle');
    expect(tool.description).toContain('Never call this tool automatically');
    expect(tool.description).toContain('explicitly requests');
  });

  it('gets a cycle by ID or slug and renders a labeled detail card', async () => {
    const tool = toolByName(tools, 'linear_get_cycle');
    const cycle = {
      id: 'cycle-1',
      name: 'PI Cycle 42',
      description: 'Ship the cycle tools.',
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-08-08T00:00:00.000Z',
      completedAt: '2026-08-08T00:00:00.000Z',
      archivedAt: '2026-09-01T12:00:00.000Z',
      autoArchivedAt: '2026-09-01T12:00:00.000Z',
      isPast: true,
      isPrevious: true,
      progress: 0.78,
      team: { id: 'team-1', key: 'PI', name: 'Pi' },
    };
    linearGraphQL.mockResolvedValue({ cycle });

    const result = await executeTool(tool, { id: 'pi-cycle-42' });

    const [, query, variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(query).toContain('query GetCycle($id: String!)');
    expect(query).toContain('cycle(id: $id)');
    expect(variables).toEqual({ id: 'pi-cycle-42' });
    expect(agentText(result)).toContain('"name": "PI Cycle 42"');

    expect(renderCallPlain(tool, { id: 'pi-cycle-42' })).toContain(
      'linear_get_cycle id=pi-cycle-42',
    );
    const text = renderPlain(tool, result);
    expect(text).toContain('✓ Cycle PI Cycle 42');
    expect(text).toMatch(/Team\s+PI/);
    expect(text).toMatch(/Status\s+completed · previous/);
    expect(text).toMatch(/Progress\s+78%/);
    expect(text).toMatch(/Range\s+2026-08-01 → 2026-08-08/);
    expect(text).toMatch(/Archived\s+2026-09-01 \(auto\)/);
    expect(text).toMatch(/Description\s+Ship the cycle tools\./);
    expect(text).not.toContain('all assigned issues unlinked');
  });

  it('archives a cycle, returns its details, and renders the unlink consequence', async () => {
    const tool = toolByName(tools, 'linear_archive_cycle');
    const cycle = {
      id: 'cycle-1',
      name: 'PI Cycle 42',
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-08-08T00:00:00.000Z',
      completedAt: '2026-08-08T00:00:00.000Z',
      archivedAt: '2026-09-01T12:00:00.000Z',
      autoArchivedAt: null,
      isPast: true,
      isPrevious: true,
      progress: 0.78,
      team: { id: 'team-1', key: 'PI', name: 'Pi' },
    };
    linearGraphQL.mockResolvedValue({
      cycleArchive: { success: true, entity: cycle },
    });

    const result = await executeTool(tool, { id: 'cycle-1' });

    const [, query, variables] = linearGraphQL.mock.calls[0] ?? [];
    expect(query).toContain('mutation ArchiveCycle($id: String!)');
    expect(query).toContain('cycleArchive(id: $id)');
    expect(query).toContain('success');
    expect(query).toContain('entity {');
    expect(variables).toEqual({ id: 'cycle-1' });
    expect(agentText(result)).toContain('"success": true');

    expect(renderCallPlain(tool, { id: 'cycle-1' })).toContain('linear_archive_cycle id=cycle-1');
    const text = renderPlain(tool, result);
    expect(text).toContain('✓ Archived PI Cycle 42');
    expect(text).toMatch(/Team\s+PI/);
    expect(text).toMatch(/Status\s+completed · previous/);
    expect(text).toMatch(/Progress\s+78%/);
    expect(text).toMatch(/Range\s+2026-08-01 → 2026-08-08/);
    expect(text).toMatch(/Archived\s+2026-09-01/);
    expect(text).toMatch(/Issues\s+all assigned issues unlinked/);
  });

  it.each([
    {
      payload: { success: false, entity: null },
      message: 'Linear failed to archive the cycle.',
    },
    {
      payload: { success: true, entity: null },
      message: 'Linear reported that it archived the cycle but returned no cycle.',
    },
  ])('archive_cycle rejects an invalid payload: $message', async ({ payload, message }) => {
    const tool = toolByName(tools, 'linear_archive_cycle');
    linearGraphQL.mockResolvedValue({ cycleArchive: payload });

    await expect(executeTool(tool, { id: 'cycle-1' })).rejects.toThrow(message);
  });

  it('scopes cycles by resolved teamKey', async () => {
    const tool = toolByName(tools, 'linear_list_cycles');
    resolveTeamId.mockResolvedValue('team-1');
    linearGraphQL.mockResolvedValue({ cycles: { nodes: [], pageInfo: emptyPageInfo } });

    await executeTool(tool, { teamKey: 'PI' });

    expect(resolveTeamId).toHaveBeenCalledWith('lin_api_test', { teamKey: 'PI' }, undefined);
    const variables = linearGraphQL.mock.calls[0]?.[2];
    expect(variables?.filter).toEqual({ team: { id: { eq: 'team-1' } } });
  });

  it('preserves a caller-supplied filter, with explicit team params taking precedence', async () => {
    const tool = toolByName(tools, 'linear_list_cycles');
    linearGraphQL.mockResolvedValue({ cycles: { nodes: [], pageInfo: emptyPageInfo } });

    await executeTool(tool, {
      filter: { isActive: { eq: true }, team: { id: { eq: 'team-from-filter' } } },
    });
    expect(linearGraphQL.mock.calls[0]?.[2]?.filter).toEqual({
      isActive: { eq: true },
      team: { id: { eq: 'team-from-filter' } },
    });

    linearGraphQL.mockClear();
    await executeTool(tool, {
      teamId: 'team-param',
      filter: { team: { id: { eq: 'team-from-filter' } } },
    });
    expect(linearGraphQL.mock.calls[0]?.[2]?.filter).toEqual({
      team: { id: { eq: 'team-param' } },
    });
  });

  it('create_cycle rejects a call without teamId or teamKey', async () => {
    const tool = toolByName(tools, 'linear_create_cycle');

    await expect(
      executeTool(tool, {
        startsAt: '2026-08-10T00:00:00.000Z',
        endsAt: '2026-08-24T00:00:00.000Z',
      }),
    ).rejects.toThrow('Provide either teamId or teamKey.');
    expect(linearGraphQL).not.toHaveBeenCalled();
  });

  it('create_cycle resolves teamKey into the mutation input', async () => {
    const tool = toolByName(tools, 'linear_create_cycle');
    resolveTeamId.mockResolvedValue('team-1');
    linearGraphQL.mockResolvedValue({ cycleCreate: { success: true, cycle: { id: 'c1' } } });

    await executeTool(tool, {
      teamKey: 'PI',
      name: 'W33',
      startsAt: '2026-08-10T00:00:00.000Z',
      endsAt: '2026-08-24T00:00:00.000Z',
    });

    expect(linearGraphQL.mock.calls[0]?.[2]).toEqual({
      input: {
        teamId: 'team-1',
        name: 'W33',
        startsAt: '2026-08-10T00:00:00.000Z',
        endsAt: '2026-08-24T00:00:00.000Z',
      },
    });
  });

  it('renders cycle mutation results with action verbs', () => {
    const createTool = toolByName(tools, 'linear_create_cycle');
    const updateTool = toolByName(tools, 'linear_update_cycle');
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
    const text = renderPlain(createTool, result);
    expect(text).toContain('✓ Created W33');
    expect(text).toContain('upcoming · next');
    expect(text).toContain('progress 25%');
    expect(text).toContain('show full JSON');
    expect(renderPlain(updateTool, result)).toContain('✓ Updated W33');
  });

  it('renders update call arguments including id and completedAt', () => {
    const tool = toolByName(tools, 'linear_update_cycle');
    const call = renderCallPlain(tool, {
      id: 'cycle-1',
      name: 'W33',
      completedAt: '2026-08-24T12:34:56.000Z',
    });
    expect(call).toContain('id=cycle-1');
    expect(call).toContain('completed=2026-08-24T12:34:56.000Z');
  });

  it('renders list errors instead of an empty state', () => {
    const tool = toolByName(tools, 'linear_list_cycles');
    const text = renderPlain(
      tool,
      { content: [{ type: 'text' as const, text: 'Linear GraphQL error: rate limited' }] },
      { isError: true },
    );

    expect(text).toContain('✗ Linear GraphQL error: rate limited');
    expect(text).not.toContain('No cycles found');
  });

  it('requests Linear authoritative cycle status and archive fields', async () => {
    const tool = toolByName(tools, 'linear_list_cycles');
    linearGraphQL.mockResolvedValue({
      cycles: {
        nodes: [
          {
            id: 'cycle-1',
            name: 'Archived cycle',
            archivedAt: '2026-07-12T18:30:00.000Z',
            autoArchivedAt: '2026-07-12T18:30:00.000Z',
          },
        ],
        pageInfo: emptyPageInfo,
      },
    });

    const result = await executeTool(tool, {});

    const query = linearGraphQL.mock.calls[0]?.[1] as string;
    expect(query).toMatch(/\barchivedAt\b/);
    expect(query).toMatch(/\bautoArchivedAt\b/);
    expect(query).toMatch(/\bisActive\b/);
    expect(query).toMatch(/\bisFuture\b/);
    expect(query).toMatch(/\bisPast\b/);
    expect(query).toMatch(/\bisNext\b/);
    expect(query).toMatch(/\bisPrevious\b/);
    expect(query).toMatch(/\bprogress\b/);
    expect(agentText(result)).toContain('2026-07-12T18:30:00.000Z');
  });

  it('renders cycle archive state immediately before the cycle name only when present', () => {
    const tool = toolByName(tools, 'linear_list_cycles');
    const result = {
      content: [{ type: 'text' as const, text: '{}' }],
      details: {
        cycles: [
          {
            id: 'current-cycle',
            name: 'Current cycle',
            startsAt: '2026-08-01T00:00:00.000Z',
            endsAt: '2026-08-08T00:00:00.000Z',
            isActive: true,
            progress: 0.42,
            archivedAt: null,
            team: { key: 'PI' },
          },
          {
            id: 'manually-archived-cycle',
            name: 'Manually archived cycle',
            startsAt: '2026-06-01T00:00:00.000Z',
            endsAt: '2026-06-08T00:00:00.000Z',
            completedAt: '2026-06-08T00:00:00.000Z',
            isPast: true,
            progress: 0.64,
            archivedAt: '2026-07-02T12:00:00.000Z',
            autoArchivedAt: null,
            team: { key: 'PI' },
          },
          {
            id: 'archived-cycle',
            name: 'Archived cycle',
            startsAt: '2026-07-01T00:00:00.000Z',
            endsAt: '2026-07-08T00:00:00.000Z',
            completedAt: '2026-07-08T00:00:00.000Z',
            isPast: true,
            progress: 0.78,
            archivedAt: '2026-08-02T12:00:00.000Z',
            autoArchivedAt: '2026-08-02T12:00:00.000Z',
            team: { key: 'PI' },
          },
        ],
      },
    };

    const text = renderPlain(tool, result, { isError: false }, 160);
    const lines = text.split('\n');
    const header = lines.find((line) => line.includes('Archived') && line.includes('Cycle'));
    const currentLine = lines.find((line) => line.includes('Current cycle'));
    const manuallyArchivedLine = lines.find((line) => line.includes('Manually archived cycle'));
    const archivedLine = lines.find((line) => line.includes('Archived cycle'));
    expect(header?.indexOf('Archived')).toBeLessThan(header?.indexOf('Cycle') ?? -1);
    expect(currentLine).toContain('\u2014');
    expect(manuallyArchivedLine).toContain('2026-07-02');
    expect(manuallyArchivedLine).not.toContain('(auto)');
    expect(archivedLine).toContain('2026-08-02 (auto)');

    const responsiveText = renderPlain(tool, result, { isError: false }, 70);
    expect(responsiveText).toContain('Archived');
    expect(responsiveText).toContain('2026-08-02 (auto)');

    const currentOnly = {
      content: [{ type: 'text' as const, text: '{}' }],
      details: { cycles: [{ id: 'current-cycle', name: 'Current cycle', isActive: true }] },
    };
    expect(renderPlain(tool, currentOnly)).not.toContain('Archived');
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

    const text = renderPlain(tool, result);
    expect(text).toContain('active');
    expect(text).toContain('upcoming · next');
    expect(text).toContain('completed · previous');
    expect(text).toContain('42%');
    expect(text).toContain('0%');
    expect(text).toContain('78%');
    expect(text).not.toContain('past');

    const narrowText = renderPlain(tool, result, { isError: false }, 60);
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
      linearGraphQL.mockResolvedValue({
        [payloadName]: { success: false, cycle: null },
      });

      await expect(executeTool(tool, params)).rejects.toThrow(
        `Linear failed to ${operation} the cycle.`,
      );

      const query = linearGraphQL.mock.calls[0]?.[1];
      expect(query).toContain('success');
    },
  );

  it('rejects a successful payload that returns no cycle', async () => {
    const tool = toolByName(tools, 'linear_create_cycle');
    linearGraphQL.mockResolvedValue({
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
    const text = renderPlain(
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
