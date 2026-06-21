import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { getCredentialFilePath, resolveApiKey, writeCredentials } from '../extensions/auth';

const originalEnv = process.env.EXA_API_KEY;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let tempDir: string | undefined;

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = originalEnv;

  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

async function useTempAgentDir() {
  tempDir = await mkdtemp(join(tmpdir(), 'pi-exa-test-'));
  process.env.PI_CODING_AGENT_DIR = tempDir;
}

describe('Exa auth', () => {
  it('uses EXA_API_KEY first', async () => {
    await useTempAgentDir();
    process.env.EXA_API_KEY = 'env-key';
    await writeCredentials('stored-key');

    await expect(resolveApiKey()).resolves.toEqual({ apiKey: 'env-key', source: 'env' });
  });

  it('uses the pi-exa credential path without legacy fallback', async () => {
    await useTempAgentDir();
    delete process.env.EXA_API_KEY;
    await writeCredentials('stored-key');

    expect(getCredentialFilePath()).toContain(join('extensions', 'pi-exa', 'credentials.json'));
    await expect(resolveApiKey()).resolves.toEqual({
      apiKey: 'stored-key',
      source: 'credentials',
    });
  });

  it('reports no key when env and pi-exa credentials are absent', async () => {
    await useTempAgentDir();
    delete process.env.EXA_API_KEY;

    await expect(resolveApiKey()).resolves.toEqual({ source: 'none' });
  });
});
