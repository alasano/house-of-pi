import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  resolveApiKey,
  readCredentials,
  writeCredentials,
  readProjectWorkspace,
  writeProjectWorkspace,
  clearProjectWorkspace,
  getProjectConfigPath,
  type WorkspaceCredentials,
} from '../extensions/client';
import { workspaceTools } from '../extensions/tools/workspaces';
import { executeTool, toolByName } from './harness';

const PROJECT_KEY = 'lin_api_project_key';
const GLOBAL_KEY = 'lin_api_global_key';
const ENV_KEY = 'lin_api_env_key';

let agentDir: string;
let projectDir: string;
let originalAgentDir: string | undefined;
let originalEnv: string | undefined;

beforeEach(async () => {
  originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  originalEnv = process.env.LINEAR_API_KEY;
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-linear-agent-'));
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-linear-project-'));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.LINEAR_API_KEY;
});

afterEach(async () => {
  if (originalAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  else delete process.env.PI_CODING_AGENT_DIR;
  if (originalEnv !== undefined) process.env.LINEAR_API_KEY = originalEnv;
  else delete process.env.LINEAR_API_KEY;
  await fs.rm(agentDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

function ctx(cwd: string | undefined): ExtensionContext {
  return { hasUI: false, cwd } as unknown as ExtensionContext;
}

function creds(): WorkspaceCredentials {
  return {
    activeWorkspace: 'global',
    authPreference: 'workspace',
    workspaces: {
      global: { apiKey: GLOBAL_KEY },
      project: { apiKey: PROJECT_KEY },
    },
  };
}

describe('project workspace config', () => {
  it('returns undefined when no config file exists', async () => {
    expect(await readProjectWorkspace(projectDir)).toBeUndefined();
  });

  it('writes and reads the workspace', async () => {
    const filePath = await writeProjectWorkspace(projectDir, 'project');

    expect(filePath).toBe(getProjectConfigPath(projectDir));
    expect(await readProjectWorkspace(projectDir)).toBe('project');
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual({ workspace: 'project' });
  });

  it('preserves unrelated config keys when writing', async () => {
    const filePath = getProjectConfigPath(projectDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ other: true }), 'utf8');

    await writeProjectWorkspace(projectDir, 'project');

    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual({
      other: true,
      workspace: 'project',
    });
  });

  it('clears the workspace and removes an otherwise empty config', async () => {
    await writeProjectWorkspace(projectDir, 'project');

    await clearProjectWorkspace(projectDir);

    expect(await readProjectWorkspace(projectDir)).toBeUndefined();
    await expect(fs.stat(getProjectConfigPath(projectDir))).rejects.toThrow();
  });

  it('keeps unrelated keys when clearing', async () => {
    const filePath = getProjectConfigPath(projectDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ other: true, workspace: 'project' }), 'utf8');

    await clearProjectWorkspace(projectDir);

    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual({ other: true });
  });
});

describe('resolveApiKey project precedence', () => {
  it('uses the project workspace over the global active workspace', async () => {
    await writeCredentials(creds());
    await writeProjectWorkspace(projectDir, 'project');

    const result = await resolveApiKey(ctx(projectDir), { promptIfMissing: false });

    expect(result).toEqual({ apiKey: PROJECT_KEY, source: 'project' });
  });

  it('uses the project workspace over LINEAR_API_KEY when env is preferred', async () => {
    await writeCredentials({ ...creds(), authPreference: 'env' });
    process.env.LINEAR_API_KEY = ENV_KEY;
    await writeProjectWorkspace(projectDir, 'project');

    const result = await resolveApiKey(ctx(projectDir), { promptIfMissing: false });

    expect(result).toEqual({ apiKey: PROJECT_KEY, source: 'project' });
  });

  it('falls back to the global active workspace when no project config exists', async () => {
    await writeCredentials(creds());

    const result = await resolveApiKey(ctx(projectDir), { promptIfMissing: false });

    expect(result).toEqual({ apiKey: GLOBAL_KEY, source: 'workspace' });
  });

  it('throws when the project config names an unknown workspace', async () => {
    await writeCredentials(creds());
    await writeProjectWorkspace(projectDir, 'missing');

    await expect(resolveApiKey(ctx(projectDir), { promptIfMissing: false })).rejects.toThrow(
      'selects Linear workspace "missing"',
    );
  });
});

describe('linear_switch_workspace project scope', () => {
  it('writes the project config and reports project scope', async () => {
    const tool = toolByName(workspaceTools(creds()), 'linear_switch_workspace');

    const result = (await executeTool(
      tool,
      { name: 'project', scope: 'project' },
      ctx(projectDir),
    )) as { details: { active: string; scope: string; configPath: string } };

    expect(result.details.scope).toBe('project');
    expect(result.details.active).toBe('project');
    expect(await readProjectWorkspace(projectDir)).toBe('project');
  });

  it('defaults to global scope', async () => {
    await writeCredentials(creds());
    const tool = toolByName(workspaceTools(creds()), 'linear_switch_workspace');

    const result = (await executeTool(tool, { name: 'project' }, ctx(projectDir))) as {
      details: { active: string | null; scope: string };
    };

    expect(result.details.scope).toBe('global');
    expect(await readProjectWorkspace(projectDir)).toBeUndefined();
    expect((await readCredentials()).activeWorkspace).toBe('project');
  });

  it('throws for an unknown workspace', async () => {
    const tool = toolByName(workspaceTools(creds()), 'linear_switch_workspace');

    await expect(executeTool(tool, { name: 'nope' }, ctx(projectDir))).rejects.toThrow(
      'is not configured',
    );
  });
});
