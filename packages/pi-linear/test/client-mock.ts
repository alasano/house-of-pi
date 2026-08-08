import { vi } from 'vitest';

export const linearGraphQL = vi.fn();
export const resolveTeamId = vi.fn();
export const withLinearAuth = vi.fn(
  async (
    _ctx: unknown,
    _signal: AbortSignal | undefined,
    handler: (apiKey: string) => Promise<unknown>,
  ) => handler('lin_api_test'),
);
