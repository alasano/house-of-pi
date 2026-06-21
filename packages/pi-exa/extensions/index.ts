import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { AgentRunTracker } from './agent-tracker';
import { clearCredentials, readCredentials, resolveApiKey, writeCredentials } from './auth';
import { registerExaSettings } from './settings';
import { createExaTools } from './tools';
import { asString } from './util';

export default async function exaExtension(pi: ExtensionAPI) {
  const tracker = new AgentRunTracker(pi);

  pi.registerCommand('exa-auth', {
    description: 'Manage Exa API auth (usage: /exa-auth [set|clear|status])',
    handler: async (args, ctx) => {
      const subcommand = args.trim().split(/\s+/)[0]?.toLowerCase() || 'status';

      switch (subcommand) {
        case 'set': {
          if (!ctx.hasUI) {
            ctx.ui.notify('Cannot prompt for an Exa API key without UI support', 'warning');
            return;
          }

          const keyInput = await ctx.ui.input('Exa API key', 'exa_...');
          const apiKey = asString(keyInput);
          if (!apiKey) {
            ctx.ui.notify('No Exa API key provided', 'warning');
            return;
          }

          await writeCredentials(apiKey);
          ctx.ui.notify('Exa API key saved for pi-exa', 'info');
          return;
        }

        case 'clear': {
          await clearCredentials();
          ctx.ui.notify('Cleared pi-exa stored credentials', 'info');
          return;
        }

        case 'status':
        case '': {
          const { source } = await resolveApiKey(ctx, { promptIfMissing: false });
          const credentials = await readCredentials();
          const stored = credentials.apiKey ? 'yes' : 'no';
          ctx.ui.notify(`Auth source: ${source}\nStored pi-exa credential: ${stored}`, 'info');
          return;
        }

        default:
          ctx.ui.notify('Usage: /exa-auth [set|clear|status]', 'warning');
      }
    },
  });

  for (const tool of createExaTools(tracker)) {
    pi.registerTool(tool);
  }

  await registerExaSettings(pi);

  pi.on('session_start', async (_event, ctx) => {
    await tracker.resume(ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    tracker.shutdown(ctx);
  });
}
