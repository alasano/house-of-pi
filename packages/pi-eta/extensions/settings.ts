import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { EtaCalibrationMode, EtaCalibrationPolicy } from './types';
import { ETA_CALIBRATION_MODES } from './types';
import { isRecord } from './util';

export const DEFAULT_CALIBRATION_MODE: EtaCalibrationMode = 'blended';
export const DEFAULT_PROFILE_SAMPLE_THRESHOLD = 3;

export type EtaSettings = EtaCalibrationPolicy & {
  verbose: boolean;
};

export type EtaSettingsStore = {
  get(): EtaSettings;
  reload(): Promise<EtaSettings>;
  setVerbose(verbose: boolean): Promise<EtaSettings>;
};

const SETTINGS_PATH = join(getAgentDir(), 'state', 'extensions', 'pi-eta', 'settings.json');

function defaultSettings(): EtaSettings {
  return {
    verbose: false,
    calibrationMode: DEFAULT_CALIBRATION_MODE,
    profileSampleThreshold: DEFAULT_PROFILE_SAMPLE_THRESHOLD,
  };
}

function normalizeCalibrationMode(value: unknown): EtaCalibrationMode {
  return typeof value === 'string' && (ETA_CALIBRATION_MODES as readonly string[]).includes(value)
    ? (value as EtaCalibrationMode)
    : DEFAULT_CALIBRATION_MODE;
}

function normalizeProfileSampleThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? value
    : DEFAULT_PROFILE_SAMPLE_THRESHOLD;
}

export function normalizeEtaSettings(raw: unknown): EtaSettings {
  if (!isRecord(raw)) return defaultSettings();
  return {
    verbose: typeof raw.verbose === 'boolean' ? raw.verbose : false,
    calibrationMode: normalizeCalibrationMode(raw.calibrationMode),
    profileSampleThreshold: normalizeProfileSampleThreshold(raw.profileSampleThreshold),
  };
}

async function loadEtaSettings(): Promise<EtaSettings> {
  try {
    return normalizeEtaSettings(JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf8')));
  } catch {
    return defaultSettings();
  }
}

async function saveEtaSettings(settings: EtaSettings): Promise<void> {
  await fs.mkdir(dirname(SETTINGS_PATH), { recursive: true });
  const temporaryPath = `${SETTINGS_PATH}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, SETTINGS_PATH);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function createEtaSettingsStore(): Promise<EtaSettingsStore> {
  let current = await loadEtaSettings();

  return {
    get() {
      return { ...current };
    },
    async reload() {
      current = await loadEtaSettings();
      return { ...current };
    },
    async setVerbose(verbose: boolean) {
      const next = { ...current, verbose };
      await saveEtaSettings(next);
      current = next;
      return { ...current };
    },
  };
}

export function getEtaSettingsPath(): string {
  return SETTINGS_PATH;
}
