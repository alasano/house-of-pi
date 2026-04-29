import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';
import {
  accentStyle,
  asString,
  cleanOneLine,
  dimStyle,
  expandedJson,
  shouldShowJson,
  LinearListResultComponent,
  mutedStyle,
  renderLinearToolCall,
  renderResponsiveTable,
  toolOutputStyle,
  truncate,
  truncateLine,
  type LinearToolRenderContext,
  type TableColumn,
  type ToolArgs,
} from './common';

type WorkflowStateTeam = {
  id?: string | null;
  key?: string | null;
  name?: string | null;
};

type WorkflowStateLike = {
  id?: string | null;
  name?: string | null;
  type?: string | null;
  color?: string | null;
  position?: number | null;
  description?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  team?: WorkflowStateTeam | null;
};

type WorkflowStateResultDetails = {
  states?: WorkflowStateLike[];
};

const STATUS_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 90;
const DESCRIPTION_LIMIT = 120;
const TABLE_NAME_MIN_WIDTH = 24;

function workflowStateDetails(result: AgentToolResult<any>): WorkflowStateResultDetails {
  return (result.details ?? {}) as WorkflowStateResultDetails;
}

function stateName(state: WorkflowStateLike): string {
  return truncate(cleanOneLine(asString(state.name) ?? '(unnamed status)'), NAME_LIMIT);
}

function stateType(state: WorkflowStateLike): string | undefined {
  return asString(state.type);
}

function teamText(state: WorkflowStateLike): string | undefined {
  return asString(state.team?.key) ?? asString(state.team?.name) ?? asString(state.team?.id);
}

function positionText(state: WorkflowStateLike): string | undefined {
  const position = state.position;
  if (typeof position !== 'number' || !Number.isFinite(position)) return undefined;
  return Number.isInteger(position) ? String(position) : position.toFixed(2);
}

function descriptionSnippet(state: WorkflowStateLike): string | undefined {
  const description = asString(state.description);
  if (!description) return undefined;
  return truncate(cleanOneLine(description), DESCRIPTION_LIMIT);
}

function metadataParts(state: WorkflowStateLike): string[] {
  const team = teamText(state);
  const type = stateType(state);
  const position = positionText(state);
  const color = asString(state.color);
  const description = descriptionSnippet(state);

  return [
    team ? `team: ${team}` : undefined,
    type ? `type: ${type}` : undefined,
    position ? `pos: ${position}` : undefined,
    color ? `color: ${color}` : undefined,
    description,
  ].filter((part): part is string => !!part);
}

function formatWorkflowStateListLine(
  state: WorkflowStateLike,
  theme: Theme,
  width: number,
): string {
  const metadata = metadataParts(state);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', stateName(state))}${suffix}`, width);
}

function stateTypeStyle(theme: Theme, value: string): (text: string) => string {
  const normalized = value.toLowerCase();
  if (normalized === 'done' || normalized === 'completed') {
    return (text) => theme.fg('success', text);
  }
  if (normalized === 'canceled' || normalized === 'cancelled') {
    return (text) => theme.fg('error', text);
  }
  if (normalized === 'started') {
    return (text) => theme.fg('warning', text);
  }
  if (normalized === 'unstarted') {
    return mutedStyle(theme);
  }
  if (normalized === 'backlog' || value === '—') {
    return dimStyle(theme);
  }
  return mutedStyle(theme);
}

const WORKFLOW_STATE_TABLE_COLUMNS: TableColumn<WorkflowStateLike>[] = [
  {
    id: 'team',
    label: 'Team',
    width: 16,
    value: (state) => teamText(state) ?? '—',
    style: (theme) => accentStyle(theme),
  },
  {
    id: 'type',
    label: 'Type',
    width: 12,
    value: (state) => stateType(state) ?? '—',
    style: stateTypeStyle,
  },
  {
    id: 'position',
    label: 'Position',
    width: 9,
    value: (state) => positionText(state) ?? '—',
    style: (theme) => dimStyle(theme),
  },
];

function renderWorkflowStateTable(
  states: WorkflowStateLike[],
  theme: Theme,
  width: number,
): string[] {
  return renderResponsiveTable(states, theme, width, {
    columns: WORKFLOW_STATE_TABLE_COLUMNS,
    primary: {
      label: 'Name',
      minWidth: TABLE_NAME_MIN_WIDTH,
      value: stateName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['position', 'type', 'team'],
    fallback: formatWorkflowStateListLine,
  });
}

export function renderLinearIssueStatusListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_issue_statuses', args, theme, [
    ['first', 'first'],
    ['orderBy', 'order'],
    ['filter', 'filter'],
    ['includeArchived', 'archived'],
  ]);
}

export function renderLinearIssueStatusListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<WorkflowStateLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading issue statuses…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const states = Array.isArray(workflowStateDetails(result).states)
    ? (workflowStateDetails(result).states as WorkflowStateLike[])
    : [];

  return new LinearListResultComponent(states, theme, {
    noun: 'status',
    pluralNoun: 'statuses',
    emptyLabel: 'No statuses found',
    previewLimit: STATUS_LIST_PREVIEW_LIMIT,
    renderItems: renderWorkflowStateTable,
  });
}
