import { defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { switchWorkspace, type WorkspaceCredentials } from '../client';

export function workspaceTools(creds: WorkspaceCredentials) {
  const names = Object.keys(creds.workspaces);
  if (names.length < 2) return [];

  return [
    defineTool({
      name: 'linear_switch_workspace',
      label: 'Linear Switch Workspace',
      description: `Switch active Linear workspace. Available: ${names.join(', ')}. Currently active: ${creds.activeWorkspace || 'none'}.`,
      parameters: Type.Object({
        name: Type.String({
          description: `Workspace name to switch to. One of: ${names.join(', ')}`,
        }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const updated = await switchWorkspace(params.name);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ active: updated.activeWorkspace }, null, 2),
            },
          ],
          details: { active: updated.activeWorkspace },
        };
      },
    }),
  ];
}
