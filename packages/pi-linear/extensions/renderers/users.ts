import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import {
  asString,
  cleanOneLine,
  dimStyle,
  expandedJson,
  shouldShowJson,
  jsonHint,
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

type UserLike = {
  id?: string | null;
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
  active?: boolean | null;
  admin?: boolean | null;
  guest?: boolean | null;
  isAssignable?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  url?: string | null;
};

type UserResultDetails = {
  user?: UserLike | null;
  users?: UserLike[];
};

const USER_LIST_PREVIEW_LIMIT = 20;
const NAME_LIMIT = 90;
const TABLE_NAME_MIN_WIDTH = 24;

function userDetails(result: AgentToolResult<any>): UserResultDetails {
  return (result.details ?? {}) as UserResultDetails;
}

function userName(user: UserLike): string {
  return truncate(
    cleanOneLine(asString(user.name) ?? asString(user.displayName) ?? '(unnamed user)'),
    NAME_LIMIT,
  );
}

function displayNameText(user: UserLike): string | undefined {
  const displayName = asString(user.displayName);
  const name = asString(user.name);
  if (!displayName || !name || displayName === name) return undefined;
  return displayName;
}

function activeText(user: UserLike): string {
  if (user.active === true) return 'active';
  if (user.active === false) return 'disabled';
  return '—';
}

function roleText(user: UserLike): string {
  if (user.admin === true) return 'admin';
  if (user.guest === true) return 'guest';
  return 'member';
}

function assignableText(user: UserLike): string {
  if (user.isAssignable === true) return 'yes';
  if (user.isAssignable === false) return 'no';
  return '—';
}

function metadataParts(user: UserLike): string[] {
  const displayName = displayNameText(user);
  const email = asString(user.email);

  return [
    displayName ? `display: ${displayName}` : undefined,
    email,
    activeText(user),
    roleText(user),
    `assignable: ${assignableText(user)}`,
  ].filter((part): part is string => !!part);
}

function formatUserListLine(user: UserLike, theme: Theme, width: number): string {
  const metadata = metadataParts(user);
  const suffix = metadata.length ? theme.fg('dim', ` · ${metadata.join(' · ')}`) : '';

  return truncateLine(`  ${theme.fg('toolOutput', userName(user))}${suffix}`, width);
}

function activeStyle(theme: Theme, value: string): (text: string) => string {
  if (value === 'active') return (text) => theme.fg('success', text);
  if (value === 'disabled') return dimStyle(theme);
  return mutedStyle(theme);
}

function roleStyle(theme: Theme, value: string): (text: string) => string {
  if (value === 'admin') return (text) => theme.fg('warning', text);
  if (value === 'guest') return mutedStyle(theme);
  return dimStyle(theme);
}

function assignableStyle(theme: Theme, value: string): (text: string) => string {
  if (value === 'yes') return (text) => theme.fg('success', text);
  if (value === 'no') return dimStyle(theme);
  return mutedStyle(theme);
}

const USER_TABLE_COLUMNS: TableColumn<UserLike>[] = [
  {
    id: 'email',
    label: 'Email',
    width: 30,
    value: (user) => asString(user.email) ?? '—',
    style: (theme) => mutedStyle(theme),
  },
  {
    id: 'active',
    label: 'Active',
    width: 8,
    value: activeText,
    style: activeStyle,
  },
  {
    id: 'role',
    label: 'Role',
    width: 7,
    value: roleText,
    style: roleStyle,
  },
  {
    id: 'assignable',
    label: 'Assignable',
    width: 10,
    value: assignableText,
    style: assignableStyle,
  },
];

function renderUserTable(users: UserLike[], theme: Theme, width: number): string[] {
  return renderResponsiveTable(users, theme, width, {
    columns: USER_TABLE_COLUMNS,
    primary: {
      label: 'Name',
      minWidth: TABLE_NAME_MIN_WIDTH,
      value: userName,
      style: (theme) => toolOutputStyle(theme),
    },
    dropOrder: ['assignable', 'role', 'active', 'email'],
    fallback: formatUserListLine,
  });
}

function formatUserTitle(user: UserLike, theme: Theme): string {
  const displayName = displayNameText(user);
  const name = userName(user);
  const title = displayName ? `${name} (${truncate(cleanOneLine(displayName), NAME_LIMIT)})` : name;
  return theme.fg('toolOutput', title);
}

function renderUserCard(user: UserLike | null | undefined, theme: Theme): Text {
  if (!user) {
    return new Text(`\n${theme.fg('dim', 'User not found')}\n\n${jsonHint()}`, 0, 0);
  }

  const email = asString(user.email);
  const url = asString(user.url);
  const metadata = [
    email,
    activeText(user),
    roleText(user),
    `assignable: ${assignableText(user)}`,
  ].filter((part): part is string => !!part);

  let text = `\n${theme.fg('success', '✓ User')} ${formatUserTitle(user, theme)}`;
  if (metadata.length) text += `\n  ${theme.fg('dim', metadata.join(' · '))}`;
  if (url) text += `\n  ${theme.fg('dim', url)}`;
  text += `\n\n${jsonHint()}`;

  return new Text(text, 0, 0);
}

export function renderLinearUserListCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_list_users', args, theme, [
    ['first', 'first'],
    ['orderBy', 'order'],
    ['filter', 'filter'],
    ['includeArchived', 'includeArchived'],
    ['includeDisabled', 'includeDisabled'],
  ]);
}

export function renderLinearGetUserCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_get_user', args, theme, [['userId', 'userId']]);
}

export function renderLinearUserListResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text | LinearListResultComponent<UserLike> {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading users…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const users = Array.isArray(userDetails(result).users)
    ? (userDetails(result).users as UserLike[])
    : [];

  return new LinearListResultComponent(users, theme, {
    noun: 'user',
    emptyLabel: 'No users found',
    previewLimit: USER_LIST_PREVIEW_LIMIT,
    renderItems: renderUserTable,
  });
}

export function renderLinearUserResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Loading user…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  return renderUserCard(userDetails(result).user, theme);
}
