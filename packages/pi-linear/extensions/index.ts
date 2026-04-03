import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  readCredentials,
  addWorkspace,
  removeWorkspace,
  switchWorkspace,
  listWorkspaceNames,
  getActiveWorkspaceName,
  resolveApiKey,
} from './client';
import { asString } from './util';
import { teamTools } from './tools/teams';
import { userTools } from './tools/users';
import { issueStatusTools } from './tools/issue-statuses';
import { projectLabelTools } from './tools/project-labels';
import { milestoneTools } from './tools/milestones';
import { commentTools } from './tools/comments';
import { documentTools } from './tools/documents';
import { initiativeTools } from './tools/initiatives';
import { issueLabelTools } from './tools/issue-labels';
import { projectTools } from './tools/projects';
import { issueTools } from './tools/issues';
import { issueRelationTools } from './tools/issue-relations';
import { projectRelationTools } from './tools/project-relations';
import { workspaceTools } from './tools/workspaces';
import { registerLinearSettings } from './settings';

export default async function linearExtension(pi: ExtensionAPI) {
  pi.registerCommand('linear-auth', {
    description: 'Manage Linear workspace auth (usage: /linear-auth [add|remove|switch|status])',
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() || '';
      const name = parts.slice(1).join(' ').trim();

      switch (subcommand) {
        case 'add': {
          const workspaceName =
            asString(name) || asString(await ctx.ui.input('Workspace name', 'my-workspace'));
          if (!workspaceName) {
            ctx.ui.notify('No workspace name provided', 'warning');
            return;
          }

          const keyInput = await ctx.ui.input('Linear API key', 'lin_api_...');
          const apiKey = asString(keyInput);
          if (!apiKey) {
            ctx.ui.notify('No API key provided', 'warning');
            return;
          }

          const credsBefore = await readCredentials();
          const countBefore = Object.keys(credsBefore.workspaces).length;
          const isFirst = countBefore === 0;

          await addWorkspace(workspaceName, apiKey);

          if (isFirst) {
            ctx.ui.notify(`Workspace "${workspaceName}" saved and set as active`, 'info');
          } else {
            const shouldSwitch = await ctx.ui.confirm(
              'Switch workspace',
              `Switch to "${workspaceName}" now?`,
            );
            if (shouldSwitch) {
              await switchWorkspace(workspaceName);
              ctx.ui.notify(`Switched to workspace "${workspaceName}"`, 'info');
            }

            if (countBefore === 1) {
              ctx.ui.notify('Workspace added. Run /reload to enable workspace switching.', 'info');
            } else {
              ctx.ui.notify('Workspace added.', 'info');
            }
          }
          return;
        }

        case 'remove': {
          const creds = await readCredentials();
          const names = listWorkspaceNames(creds);
          if (names.length === 0) {
            ctx.ui.notify('No workspaces configured', 'warning');
            return;
          }

          const rawSelection =
            asString(name) ||
            (await ctx.ui.select(
              'Select workspace to remove',
              names.map((n) => (n === creds.activeWorkspace ? `${n} (active)` : n)),
            ));
          const workspaceName = rawSelection?.replace(/ \(active\)$/, '');
          if (!workspaceName) {
            ctx.ui.notify('No workspace selected', 'warning');
            return;
          }

          if (!creds.workspaces[workspaceName]) {
            ctx.ui.notify(`Workspace "${workspaceName}" not found`, 'warning');
            return;
          }

          const countBefore = names.length;
          const updated = await removeWorkspace(workspaceName);

          if (creds.activeWorkspace === workspaceName && updated.activeWorkspace) {
            ctx.ui.notify(
              `Removed "${workspaceName}". Switched to "${updated.activeWorkspace}".`,
              'info',
            );
          } else {
            ctx.ui.notify(`Removed workspace "${workspaceName}"`, 'info');
          }

          if (countBefore === 2) {
            ctx.ui.notify('Workspace removed. Run /reload to update workspace tools.', 'info');
          }
          return;
        }

        case 'switch': {
          const creds = await readCredentials();
          const names = listWorkspaceNames(creds);
          if (names.length === 0) {
            ctx.ui.notify('No workspaces configured', 'warning');
            return;
          }

          const rawSelection =
            asString(name) ||
            (await ctx.ui.select(
              'Select workspace',
              names.map((n) => (n === creds.activeWorkspace ? `${n} (active)` : n)),
            ));
          const workspaceName = rawSelection?.replace(/ \(active\)$/, '');
          if (!workspaceName) {
            ctx.ui.notify('No workspace selected', 'warning');
            return;
          }

          if (!creds.workspaces[workspaceName]) {
            ctx.ui.notify(`Workspace "${workspaceName}" not found`, 'warning');
            return;
          }

          await switchWorkspace(workspaceName);
          ctx.ui.notify(`Active workspace: ${workspaceName}`, 'info');
          return;
        }

        case 'status':
        case '': {
          const creds = await readCredentials();
          const { source } = await resolveApiKey(ctx, {
            promptIfMissing: false,
          });
          const names = listWorkspaceNames(creds);
          const active = getActiveWorkspaceName(creds);

          let sourceLabel: string;
          if (source === 'workspace') {
            sourceLabel = `workspace: ${active}`;
          } else if (source === 'env') {
            sourceLabel = 'env: LINEAR_API_KEY';
          } else {
            sourceLabel = 'none';
          }

          const lines = [`Auth source: ${sourceLabel}`];
          if (names.length > 0) {
            lines.push(
              `Workspaces: ${names.map((n) => (n === active ? `${n} (active)` : n)).join(', ')}`,
            );
          } else {
            lines.push('No workspaces configured');
          }

          ctx.ui.notify(lines.join('\n'), source === 'none' ? 'warning' : 'info');
          return;
        }

        default: {
          ctx.ui.notify('Usage: /linear-auth [add|remove|switch|status]', 'warning');
        }
      }
    },
  });

  const creds = await readCredentials();

  const allTools = [
    ...teamTools(),
    ...userTools(),
    ...issueStatusTools(),
    ...projectLabelTools(),
    ...milestoneTools(),
    ...commentTools(),
    ...documentTools(),
    ...initiativeTools(),
    ...issueLabelTools(),
    ...projectTools(),
    ...issueTools(),
    ...issueRelationTools(),
    ...projectRelationTools(),
    ...workspaceTools(creds),
  ];

  for (const tool of allTools) {
    pi.registerTool(tool);
  }

  registerLinearSettings(pi);
}
