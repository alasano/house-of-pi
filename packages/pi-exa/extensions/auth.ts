import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAgentDir, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { asString, isRecord } from './util';

const CREDENTIALS_FILENAME = 'credentials.json';

interface ExaCredentials {
  apiKey?: string;
}

export function getCredentialFilePath() {
  return join(getAgentDir(), 'extensions', 'pi-exa', CREDENTIALS_FILENAME);
}

export async function readCredentials(): Promise<ExaCredentials> {
  try {
    const raw = await fs.readFile(getCredentialFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return { apiKey: asString(parsed.apiKey) };
  } catch {
    return {};
  }
}

export async function writeCredentials(apiKey: string): Promise<void> {
  const filePath = getCredentialFilePath();
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ apiKey }, null, 2), { mode: 0o600 });
  await fs.chmod(filePath, 0o600).catch(() => undefined);
}

export async function clearCredentials(): Promise<void> {
  await fs.rm(getCredentialFilePath(), { force: true }).catch(() => undefined);
}

export async function resolveApiKey(
  ctx?: ExtensionContext,
  options?: { promptIfMissing?: boolean },
): Promise<{ apiKey?: string; source: 'env' | 'credentials' | 'none' }> {
  const envApiKey = asString(process.env.EXA_API_KEY);
  if (envApiKey) return { apiKey: envApiKey, source: 'env' };

  const credentials = await readCredentials();
  if (credentials.apiKey) return { apiKey: credentials.apiKey, source: 'credentials' };

  const promptIfMissing = options?.promptIfMissing ?? false;
  if (promptIfMissing && ctx?.hasUI) {
    const shouldSetKey = await ctx.ui.confirm(
      'Exa API key required',
      'No EXA_API_KEY env var or pi-exa credential is configured. Would you like to set one now?',
    );
    if (!shouldSetKey) return { source: 'none' };

    const keyInput = await ctx.ui.input('Exa API key', 'exa_...');
    const apiKey = asString(keyInput);
    if (!apiKey) return { source: 'none' };

    await writeCredentials(apiKey);
    ctx.ui.notify('Exa API key saved for pi-exa', 'info');
    return { apiKey, source: 'credentials' };
  }

  return { source: 'none' };
}
