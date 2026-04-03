import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LinearGraphQLError, LinearIssue } from './types';
import { asString } from './util';
import { ISSUE_SELECTION } from './selections';

const LINEAR_GRAPHQL_ENDPOINT = 'https://api.linear.app/graphql';
const IDENTIFIER_PATTERN = /^([A-Z][A-Z0-9]*)-(\d+)$/i;

export type WorkspaceCredentials = {
  activeWorkspace: string | null;
  workspaces: Record<string, { apiKey: string }>;
};

function emptyCredentials(): WorkspaceCredentials {
  return { activeWorkspace: null, workspaces: {} };
}

export function getCredentialFilePath() {
  const piDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
  return path.join(piDir, 'extensions', 'linear', 'credentials.json');
}

export async function readCredentials(): Promise<WorkspaceCredentials> {
  const filePath = getCredentialFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.workspaces ||
      typeof parsed.workspaces !== 'object'
    ) {
      return emptyCredentials();
    }
    const activeWorkspace =
      typeof parsed.activeWorkspace === 'string' ? parsed.activeWorkspace : null;
    const workspaces: Record<string, { apiKey: string }> = {};
    for (const [name, entry] of Object.entries(parsed.workspaces)) {
      if (
        entry &&
        typeof entry === 'object' &&
        'apiKey' in entry &&
        typeof (entry as { apiKey: unknown }).apiKey === 'string'
      ) {
        workspaces[name] = { apiKey: (entry as { apiKey: string }).apiKey };
      }
    }
    return { activeWorkspace, workspaces };
  } catch {
    return emptyCredentials();
  }
}

export async function writeCredentials(creds: WorkspaceCredentials): Promise<void> {
  const filePath = getCredentialFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => undefined);
}

export function getActiveApiKey(creds: WorkspaceCredentials): string | undefined {
  if (!creds.activeWorkspace) return undefined;
  return creds.workspaces[creds.activeWorkspace]?.apiKey;
}

export async function addWorkspace(name: string, apiKey: string): Promise<WorkspaceCredentials> {
  const creds = await readCredentials();
  creds.workspaces[name] = { apiKey };
  if (!creds.activeWorkspace) {
    creds.activeWorkspace = name;
  }
  await writeCredentials(creds);
  return creds;
}

export async function removeWorkspace(name: string): Promise<WorkspaceCredentials> {
  const creds = await readCredentials();
  delete creds.workspaces[name];
  if (creds.activeWorkspace === name) {
    const remaining = Object.keys(creds.workspaces);
    creds.activeWorkspace = remaining[0] ?? null;
  }
  await writeCredentials(creds);
  return creds;
}

export async function switchWorkspace(name: string): Promise<WorkspaceCredentials> {
  const creds = await readCredentials();
  if (!creds.workspaces[name]) {
    throw new Error(`Workspace "${name}" does not exist.`);
  }
  creds.activeWorkspace = name;
  await writeCredentials(creds);
  return creds;
}

export function listWorkspaceNames(creds: WorkspaceCredentials): string[] {
  return Object.keys(creds.workspaces);
}

export function getActiveWorkspaceName(creds: WorkspaceCredentials): string | null {
  return creds.activeWorkspace;
}

export async function resolveApiKey(
  ctx: ExtensionContext,
  options?: { promptIfMissing?: boolean },
): Promise<{ apiKey?: string; source: 'env' | 'workspace' | 'none' }> {
  const creds = await readCredentials();
  const workspaceKey = getActiveApiKey(creds);
  if (workspaceKey) return { apiKey: workspaceKey, source: 'workspace' };

  const envApiKey = asString(process.env.LINEAR_API_KEY);
  if (envApiKey) return { apiKey: envApiKey, source: 'env' };

  const promptIfMissing = options?.promptIfMissing ?? true;
  if (promptIfMissing && ctx.hasUI) {
    const shouldSetKey = await ctx.ui.confirm(
      'Linear API key required',
      'No configured workspace or LINEAR_API_KEY env var found. Would you like to set one now?',
    );
    if (!shouldSetKey) return { source: 'none' };

    const nameInput = await ctx.ui.input('Workspace name', 'my-workspace');
    const name = asString(nameInput);
    if (!name) return { source: 'none' };

    const keyInput = await ctx.ui.input('Linear API key', 'lin_api_...');
    const apiKey = asString(keyInput);
    if (!apiKey) return { source: 'none' };

    await addWorkspace(name, apiKey);
    ctx.ui.notify(`Workspace "${name}" saved and set as active`, 'info');
    return { apiKey, source: 'workspace' };
  }

  return { source: 'none' };
}

export async function linearGraphQL<TData>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TData> {
  const response = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  const body = (await response.json()) as {
    data?: TData;
    errors?: LinearGraphQLError[];
  };

  if (!response.ok) {
    const message =
      body.errors?.map((error) => error.message).join('; ') ||
      `${response.status} ${response.statusText}`;
    throw new Error(`Linear API request failed: ${message}`);
  }

  if (body.errors?.length) {
    throw new Error(
      `Linear GraphQL error: ${body.errors.map((error) => error.message).join('; ')}`,
    );
  }

  if (!body.data) {
    throw new Error('Linear GraphQL response did not include data.');
  }

  return body.data;
}

export function parseIdentifier(issueRef: string): { teamKey: string; number: number } | undefined {
  const match = issueRef.trim().match(IDENTIFIER_PATTERN);
  if (!match) return undefined;

  return {
    teamKey: match[1]!.toUpperCase(),
    number: Number(match[2]!),
  };
}

export async function fetchIssueByIdentifier(
  apiKey: string,
  identifier: string,
  signal?: AbortSignal,
): Promise<LinearIssue | undefined> {
  const parsed = parseIdentifier(identifier);
  if (!parsed) return undefined;

  const data = await linearGraphQL<{ issues: { nodes: LinearIssue[] } }>(
    apiKey,
    `query GetIssueByIdentifier($teamKey: String!, $number: Float!) {
      issues(
        first: 1
        filter: {
          team: { key: { eq: $teamKey } }
          number: { eq: $number }
        }
      ) {
        nodes {
          ${ISSUE_SELECTION}
        }
      }
    }`,
    {
      teamKey: parsed.teamKey,
      number: parsed.number,
    },
    signal,
  );

  return data.issues.nodes[0];
}

export async function resolveIssueId(
  apiKey: string,
  issueRef: string,
  signal?: AbortSignal,
): Promise<string> {
  const identifierIssue = await fetchIssueByIdentifier(apiKey, issueRef, signal);
  if (identifierIssue?.id) return identifierIssue.id;

  return issueRef.trim();
}

export async function resolveTeamId(
  apiKey: string,
  options: { teamId?: string; teamKey?: string },
  signal?: AbortSignal,
): Promise<string> {
  if (options.teamId?.trim()) {
    return options.teamId.trim();
  }

  const teamKey = options.teamKey?.trim();
  if (!teamKey) {
    throw new Error('Either teamId or teamKey must be provided.');
  }

  const data = await linearGraphQL<{ teams: { nodes: Array<{ id: string }> } }>(
    apiKey,
    `query ResolveTeam($teamKey: String!) {
      teams(first: 1, filter: { key: { eq: $teamKey } }) {
        nodes {
          id
        }
      }
    }`,
    { teamKey },
    signal,
  );

  const teamId = data.teams.nodes[0]?.id;
  if (!teamId) {
    throw new Error(`Linear team not found for key: ${teamKey}`);
  }

  return teamId;
}

export async function withLinearAuth<T>(
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  handler: (apiKey: string) => Promise<T>,
): Promise<T> {
  const { apiKey } = await resolveApiKey(ctx);
  if (!apiKey) {
    throw new Error('Missing Linear API key. Set LINEAR_API_KEY or run /linear-auth.');
  }

  if (signal?.aborted) {
    throw new Error('Request cancelled.');
  }

  return handler(apiKey);
}
