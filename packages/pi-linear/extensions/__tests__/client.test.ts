import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import {
  resolveApiKey,
  readCredentials,
  writeCredentials,
  getCredentialFilePath,
  getActiveApiKey,
  addWorkspace,
  removeWorkspace,
  switchWorkspace,
  listWorkspaceNames,
  getActiveWorkspaceName,
  type WorkspaceCredentials,
} from '../client';

function fakeCtx(hasUI = false) {
  return {
    hasUI,
    ui: { confirm: vi.fn(), input: vi.fn(), notify: vi.fn() },
  } as any;
}

const ENV_KEY = 'LINEAR_API_KEY';
const WORKSPACE_KEY = 'lin_api_workspace_key';
const ENV_VAR_KEY = 'lin_api_env_var_key';

function credsWith(overrides: Partial<WorkspaceCredentials> = {}): WorkspaceCredentials {
  return {
    activeWorkspace: 'my-workspace',
    workspaces: { 'my-workspace': { apiKey: WORKSPACE_KEY } },
    ...overrides,
  };
}

function useTmpDir() {
  const tmpDir = `/tmp/pi-linear-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let originalDir: string | undefined;

  beforeEach(async () => {
    originalDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    if (originalDir !== undefined) process.env.PI_CODING_AGENT_DIR = originalDir;
    else delete process.env.PI_CODING_AGENT_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
}

describe('readCredentials / writeCredentials', () => {
  useTmpDir();

  it('returns empty credentials when no file exists', async () => {
    const creds = await readCredentials();
    expect(creds).toEqual({ activeWorkspace: null, workspaces: {} });
  });

  it('round-trips credentials through write then read', async () => {
    const input = credsWith();
    await writeCredentials(input);
    const output = await readCredentials();
    expect(output).toEqual(input);
  });

  it('sets file permissions to 0o600', async () => {
    await writeCredentials(credsWith());
    const stat = await fs.stat(getCredentialFilePath());
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe('workspace management', () => {
  useTmpDir();

  it('addWorkspace sets first workspace as active', async () => {
    const creds = await addWorkspace('first', 'key-1');
    expect(creds.activeWorkspace).toBe('first');
    expect(creds.workspaces['first']).toEqual({ apiKey: 'key-1' });
  });

  it('addWorkspace does not change active when one already exists', async () => {
    await addWorkspace('first', 'key-1');
    const creds = await addWorkspace('second', 'key-2');
    expect(creds.activeWorkspace).toBe('first');
    expect(Object.keys(creds.workspaces)).toEqual(['first', 'second']);
  });

  it('removeWorkspace falls back to next available workspace', async () => {
    await addWorkspace('a', 'key-a');
    await addWorkspace('b', 'key-b');
    const creds = await removeWorkspace('a');
    expect(creds.activeWorkspace).toBe('b');
    expect(creds.workspaces['a']).toBeUndefined();
  });

  it('removeWorkspace sets null when last workspace removed', async () => {
    await addWorkspace('only', 'key-only');
    const creds = await removeWorkspace('only');
    expect(creds.activeWorkspace).toBeNull();
    expect(Object.keys(creds.workspaces)).toHaveLength(0);
  });

  it('switchWorkspace changes the active workspace', async () => {
    await addWorkspace('a', 'key-a');
    await addWorkspace('b', 'key-b');
    const creds = await switchWorkspace('b');
    expect(creds.activeWorkspace).toBe('b');
  });

  it('switchWorkspace throws for unknown workspace', async () => {
    await addWorkspace('a', 'key-a');
    await expect(switchWorkspace('nope')).rejects.toThrow('does not exist');
  });

  it('listWorkspaceNames returns all names', async () => {
    await addWorkspace('x', 'key-x');
    await addWorkspace('y', 'key-y');
    const creds = await readCredentials();
    expect(listWorkspaceNames(creds)).toEqual(['x', 'y']);
  });

  it('getActiveWorkspaceName returns null when none set', () => {
    expect(getActiveWorkspaceName({ activeWorkspace: null, workspaces: {} })).toBeNull();
  });

  it('getActiveApiKey returns undefined when no active workspace', () => {
    expect(getActiveApiKey({ activeWorkspace: null, workspaces: {} })).toBeUndefined();
  });
});

describe('resolveApiKey precedence', () => {
  useTmpDir();
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env[ENV_KEY] = originalEnv;
    else delete process.env[ENV_KEY];
  });

  it('env var takes precedence over credentials.json', async () => {
    await writeCredentials(credsWith());
    process.env[ENV_KEY] = ENV_VAR_KEY;

    const result = await resolveApiKey(fakeCtx(), { promptIfMissing: false });
    expect(result).toEqual({ apiKey: ENV_VAR_KEY, source: 'env' });
  });

  it('falls back to credentials.json when env var is not set', async () => {
    await writeCredentials(credsWith());

    const result = await resolveApiKey(fakeCtx(), { promptIfMissing: false });
    expect(result).toEqual({ apiKey: WORKSPACE_KEY, source: 'workspace' });
  });

  it('falls back to credentials.json when env var is empty string', async () => {
    await writeCredentials(credsWith());
    process.env[ENV_KEY] = '';

    const result = await resolveApiKey(fakeCtx(), { promptIfMissing: false });
    expect(result).toEqual({ apiKey: WORKSPACE_KEY, source: 'workspace' });
  });

  it('falls back to credentials.json when env var is whitespace', async () => {
    await writeCredentials(credsWith());
    process.env[ENV_KEY] = '   ';

    const result = await resolveApiKey(fakeCtx(), { promptIfMissing: false });
    expect(result).toEqual({ apiKey: WORKSPACE_KEY, source: 'workspace' });
  });

  it('uses env var even when no credentials file exists', async () => {
    process.env[ENV_KEY] = ENV_VAR_KEY;

    const result = await resolveApiKey(fakeCtx(), { promptIfMissing: false });
    expect(result).toEqual({ apiKey: ENV_VAR_KEY, source: 'env' });
  });

  it('returns none when neither env var nor credentials exist', async () => {
    const result = await resolveApiKey(fakeCtx(false), { promptIfMissing: false });
    expect(result).toEqual({ source: 'none' });
  });
});
