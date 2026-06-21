import type { ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { formatToolError } from '../client';
import { resolveApiKey } from '../auth';

export async function withExaApiKey<T>(
  ctx: ExtensionContext,
  callback: (apiKey: string) => Promise<T>,
): Promise<T> {
  const { apiKey } = await resolveApiKey(ctx, { promptIfMissing: true });
  if (!apiKey) {
    throw new Error(
      'No Exa API key configured. Set EXA_API_KEY before starting pi or run /exa-auth set.',
    );
  }
  return callback(apiKey);
}

export function errorResult(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: formatToolError(error) }],
    details: undefined,
    isError: true,
  };
}

export type AnyExaTool = ToolDefinition<any, any, any>;
