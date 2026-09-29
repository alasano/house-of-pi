import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { switchWorkspace, writeProjectWorkspace, type WorkspaceCredentials } from '../client';
import { stringEnum } from '../params';
import {
  renderLinearSwitchWorkspaceCall,
  renderLinearSwitchWorkspaceResult,
} from '../renderers/workspaces';

const WORKSPACE_SCOPES = ['project', 'global'] as const;

export function workspaceTools(creds: WorkspaceCredentials) {
  const names = Object.keys(creds.workspaces);
  if (names.length < 2) return [];

  return [
    defineTool({
      name: 'linear_switch_workspace',
      label: 'Linear Switch Workspace',
      description: `Switch Linear workspace. Available: ${names.join(', ')}. Currently active: ${creds.activeWorkspace || 'none'}. Use scope "project" to bind the workspace to the current repository (.pi/pi-linear.json) or "global" (default) to change the active workspace for every project.`,
      parameters: Type.Object({
        name: Type.String({
          description: `Workspace name to switch to. One of: ${names.join(', ')}`,
        }),
        scope: Type.Optional(
          stringEnum(WORKSPACE_SCOPES, {
            description:
              'Where to persist the switch: "project" binds the workspace to the current repository via .pi/pi-linear.json, "global" changes the active workspace for all projects. Defaults to "global".',
          }),
        ),
      }),
      renderCall: renderLinearSwitchWorkspaceCall,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (!names.includes(params.name)) {
          throw new Error(
            `Workspace "${params.name}" is not configured. Available: ${names.join(', ')}.`,
          );
        }

        const scope = params.scope ?? 'global';

        if (scope === 'project') {
          if (!ctx.cwd) {
            throw new Error('Project-scoped switching requires a working directory.');
          }
          const configPath = await writeProjectWorkspace(ctx.cwd, params.name);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ active: params.name, scope, configPath }, null, 2),
              },
            ],
            details: { active: params.name, scope, configPath },
          };
        }

        const updated = await switchWorkspace(params.name);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ active: updated.activeWorkspace, scope }, null, 2),
            },
          ],
          details: { active: updated.activeWorkspace, scope },
        };
      },
      renderResult: renderLinearSwitchWorkspaceResult,
    }),
  ];
}
