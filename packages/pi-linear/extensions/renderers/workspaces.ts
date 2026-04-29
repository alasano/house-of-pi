import {
  type AgentToolResult,
  type Theme,
  type ToolRenderResultOptions,
} from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';
import {
  asString,
  expandedJson,
  shouldShowJson,
  jsonHint,
  renderLinearToolCall,
  type LinearToolRenderContext,
  type ToolArgs,
} from './common';

type WorkspaceSwitchResultDetails = {
  active?: string | null;
};

function workspaceSwitchDetails(result: AgentToolResult<any>): WorkspaceSwitchResultDetails {
  return (result.details ?? {}) as WorkspaceSwitchResultDetails;
}

export function renderLinearSwitchWorkspaceCall(args: ToolArgs | undefined, theme: Theme): Text {
  return renderLinearToolCall('linear_switch_workspace', args, theme, [['name', 'name']]);
}

export function renderLinearSwitchWorkspaceResult(
  result: AgentToolResult<any>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: LinearToolRenderContext,
): Text {
  if (options.isPartial) return new Text(theme.fg('warning', 'Switching workspace…'), 0, 0);
  if (shouldShowJson(options, context)) return expandedJson(result, theme);

  const active = asString(workspaceSwitchDetails(result).active) ?? 'unknown';
  return new Text(
    `\n${theme.fg('success', `✓ Active Linear workspace: ${active}`)}\n\n${jsonHint()}`,
    0,
    0,
  );
}
