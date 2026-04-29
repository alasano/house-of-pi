import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';
import {
  asString,
  cleanOneLine,
  expandedJson,
  shouldShowJson,
  jsonHint,
  LinearListResultComponent,
  renderLinearToolCall,
  renderResponsiveTable,
  toolOutputStyle,
  truncate,
  truncateLine,
  type LinearToolRenderContext,
  type TableColumn,
  type ToolArgs,
} from './common';

type WorkflowStateLike = {
  id?: string | null;
  name?: string | null;
  type?: string | null;
};

type TeamLike = {
  id?: string | null;
  key?: string | null;
  name?: string | null;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  private?: boolean | null;
  states?: { nodes?: WorkflowStateLike[] | null } | null;
};

type TeamResultDetails = {
  team?: TeamLike | null;
  teams?: TeamLike[];
};

const TEAM_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 90;
const DESCRIPTION_LIMIT = 160;
const TABLE_NAME_MIN_WIDTH = 24;
const STATE_TYPE_ORDER = ['backlog', 'unstarted', 'started', 'completed', 'canceled', 'cancelled'];

function teamDetails(result: AgentToolResult<any>): TeamResultDetails {
  return (result.details ?? {}) as TeamResultDetails;
}

function teamName(team: TeamLike): string {
  return truncate(cleanOneLine(asString(team.name) ?? '(unnamed team)'), NAME_LIMIT);
}

function teamKey(team: TeamLike): string {
  return asString(team.key) ?? asString(team.id) ?? '—';
}

function privateText(team: TeamLike): string | undefined {
  if (typeof team.private !== 'boolean') return undefined;
  return team.private ? 'yes' : 'no';
}

function stateNodes(team: TeamLike): WorkflowStateLike[] {
  const nodes = team.states?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

function stateTypeRank(type: string): number {
  const index = STATE_TYPE_ORDER.indexOf(type.toLowerCase());
  return index === -1 ? STATE_TYPE_ORDER.length : index;
}

function statesSummary(team: TeamLike): string | undefined {
  const states = stateNodes(team);
  if (states.length === 0) return undefined;

  const counts = new Map<string, number>();
  for (const state of states) {
    const type = asString(state.type);
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  if (counts.size === 0) return `${states.length} states`;

  return [...counts.entries()]
    .sort(
      ([left], [right]) => stateTypeRank(left) - stateTypeRank(right) || left.localeCompare(right),
    )
    .map(([type, count]) => `${type} ${count}`)
    .join(' · ');
}

function descriptionSnippet(team: TeamLike): string | undefined {
  const description = asString(team.description);
  if (!description) return undefined;
  return truncate(cleanOneLine(description), DESCRIPTION_LIMIT);
}

function metadataParts(team: TeamLike): string[] {
  const privacy = privateText(team);
  const states = statesSummary(team);
  const color = asString(team.color);
  const icon = asString(team.icon);
  const description = descriptionSnippet(team);

  return [
    privacy ? `private: ${privacy}` : undefined,
    states ? `states: ${states}` : undefined,
    color ? `color: ${color}` : undefined,
    icon ? `icon: ${icon}` : undefined,
    description,
  ].filter((part): part is string => !!part);
}

function formatTeamListLine(team: TeamLike, theme: Theme, width: number): string {
  const key = teamKey(team);
  const keyPrefix = key === '—' ? '' : `${theme.fg('accent', key)} `;
  const metadata = metadataParts(team);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${keyPrefix}${theme.fg('toolOutput', teamName(team))}${suffix}`, width);
}

function privateStyle(theme: Theme, value: string): (text: string) => string {
  if (value === 'yes') return (text) => theme.fg('warning', text);
  if (value === 'no' || value === '—') return (text) => theme.fg('dim', text);
  return (text) => theme.fg('muted', text);
}

const TEAM_TABLE_COLUMNS: TableColumn<TeamLike>[] = [
  {
    id: 'key',
    label: 'Key',
    width: 10,
    value: teamKey,
    style: (theme, value) =>
      value === '—' ? (text) => theme.fg('dim', text) : (text) => theme.fg('accent', text),
  },
  {
    id: 'private',
    label: 'Private',
    width: 8,
    value: (team) => privateText(team) ?? '—',
    style: privateStyle,
  },
  {
    id: 'states',
    label: 'States',
    width: 36,
    value: (team) => statesSummary(team) ?? '—',
    style: (theme) => (text) => theme.fg('dim', text),
  },
];

function renderTeamTable(teams: TeamLike[], theme: Theme, width: number): string[] {
  return renderResponsiveTable(teams, theme, width, {
    columns: TEAM_TABLE_COLUMNS,
    primary: {
      label: 'Name',
      minWidth: TABLE_NAME_MIN_WIDTH,
      value: teamName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['states', 'private', 'key'],
    fallback: formatTeamListLine,
  });
}

function formatTeamTitle(team: TeamLike, theme: Theme): string {
  const key = teamKey(team);
  const prefix = key === '—' ? '' : `${theme.fg('accent', key)} `;
  return `${prefix}${theme.fg('toolOutput', teamName(team))}`;
}

function renderTeamCard(
  actionLabel: string,
  team: TeamLike | null | undefined,
  theme: Theme,
): Text {
  if (!team) {
    return new Text(`\n${theme.fg('dim', 'Team not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const metadata = metadataParts(team);

  let text = `\n${theme.fg('success', `✓ ${actionLabel}`)} ${formatTeamTitle(team, theme)}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

export function renderLinearTeamListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_teams', args, theme, [
    ['first', 'first'],
    ['orderBy', 'order'],
    ['filter', 'filter'],
    ['includeArchived', 'archived'],
  ]);
}

export function renderLinearGetTeamCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_get_team', args, theme, [['teamId', 'teamId']]);
}

export function renderLinearTeamListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<TeamLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading teams…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const teams = Array.isArray(teamDetails(result).teams)
    ? (teamDetails(result).teams as TeamLike[])
    : [];

  return new LinearListResultComponent(teams, theme, {
    noun: 'team',
    emptyLabel: 'No teams found',
    previewLimit: TEAM_LIST_PREVIEW_LIMIT,
    renderItems: renderTeamTable,
  });
}

export function renderLinearTeamResult(actionLabel: string) {
  return (
    result: AgentToolResult<any>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: LinearToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text(theme.fg('warning', `${actionLabel}…`), 0, 0);
    if (shouldShowJson(options, context)) return expandedJson(result, theme);

    return renderTeamCard(actionLabel, teamDetails(result).team, theme);
  };
}
