import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type {
  CompletedEtaRecord,
  EstimateRange,
  EtaCheckEvent,
  EtaEvent,
  EtaFinishEvent,
  EtaModelInfo,
  EtaOutcome,
  EtaProjectInfo,
  EtaStartEvent,
  EtaState,
  EtaTaskRecord,
} from './types';
import { ETA_EVENT_VERSION, ETA_OUTCOMES } from './types';
import { actualWallMinutes, asNumber, asString, isRecord } from './util';

const STORAGE_DIR = join(getAgentDir(), 'state', 'extensions', 'pi-eta');
const EVENTS_PATH = join(STORAGE_DIR, 'events.jsonl');
const LOCK_PATH = join(STORAGE_DIR, 'events.lock');
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(): Promise<() => Promise<void>> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const startedAt = Date.now();

  for (;;) {
    try {
      await fs.mkdir(LOCK_PATH);
      return async () => {
        await fs.rm(LOCK_PATH, { recursive: true, force: true });
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;

      try {
        const stat = await fs.stat(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          // Rename is the atomic takeover: exactly one contender wins the stale lock, so
          // a slow contender can never delete a fresh lock acquired after its stat call.
          const staleName = `${LOCK_PATH}.stale.${process.pid}.${Date.now().toString(36)}`;
          await fs.rename(LOCK_PATH, staleName);
          await fs.rm(staleName, { recursive: true, force: true });
          // Sweep orphans left by contenders that died between their rename and rm.
          const stalePrefix = `${basename(LOCK_PATH)}.stale.`;
          for (const entry of await fs.readdir(STORAGE_DIR)) {
            if (entry.startsWith(stalePrefix)) {
              await fs
                .rm(join(STORAGE_DIR, entry), { recursive: true, force: true })
                .catch(() => undefined);
            }
          }
          continue;
        }
      } catch (statError) {
        if (!isNodeError(statError) || statError.code !== 'ENOENT') throw statError;
      }

      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        throw new Error('Timed out waiting for pi-eta event store lock.');
      }

      await delay(40 + Math.floor(Math.random() * 40));
    }
  }
}

function parseEstimateRange(raw: unknown): EstimateRange | undefined {
  if (!isRecord(raw)) return undefined;
  const lowMinutes = asNumber(raw.lowMinutes);
  const highMinutes = asNumber(raw.highMinutes);
  if (lowMinutes === undefined || highMinutes === undefined) return undefined;
  if (lowMinutes <= 0 || highMinutes <= 0 || lowMinutes > highMinutes) return undefined;
  return { lowMinutes, highMinutes };
}

function parseModel(raw: unknown): EtaModelInfo | undefined {
  if (!isRecord(raw)) return undefined;
  const provider = asString(raw.provider);
  const id = asString(raw.id);
  const key = asString(raw.key);
  if (!provider || !id || !key) return undefined;
  const name = asString(raw.name);
  return { provider, id, key, ...(name ? { name } : {}) };
}

function parseProject(raw: unknown): EtaProjectInfo | undefined {
  if (!isRecord(raw)) return undefined;
  const cwd = asString(raw.cwd);
  const name = asString(raw.name);
  if (!cwd || !name) return undefined;
  return { cwd, name };
}

function parseOutcome(raw: unknown): EtaOutcome | undefined {
  if (typeof raw !== 'string') return undefined;
  return (ETA_OUTCOMES as readonly string[]).includes(raw) ? (raw as EtaOutcome) : undefined;
}

function parseBase(
  raw: Record<string, unknown>,
): Pick<EtaEvent, 'version' | 'eventId' | 'at'> | undefined {
  const version = raw.version === ETA_EVENT_VERSION ? ETA_EVENT_VERSION : undefined;
  const eventId = asString(raw.eventId);
  const at = asString(raw.at);
  if (!version || !eventId || !at) return undefined;
  return { version, eventId, at };
}

export function parseEtaEvent(raw: unknown): EtaEvent | undefined {
  if (!isRecord(raw)) return undefined;
  const base = parseBase(raw);
  if (!base) return undefined;

  switch (raw.type) {
    case 'reset': {
      const reason = asString(raw.reason);
      return {
        ...base,
        type: 'reset',
        ...(reason ? { reason } : {}),
      };
    }

    case 'profile_change': {
      const taskId = asString(raw.taskId);
      if (!taskId) return undefined;
      return { ...base, type: 'profile_change', taskId };
    }

    case 'check': {
      const taskSummary = asString(raw.taskSummary);
      const estimate = parseEstimateRange(raw.estimate);
      const model = parseModel(raw.model);
      const project = parseProject(raw.project);
      const sessionId = asString(raw.sessionId);
      if (!taskSummary || !estimate || !model || !project || !sessionId) return undefined;
      const sessionFile = asString(raw.sessionFile);
      const thinkingLevel = asString(raw.thinkingLevel);
      return {
        ...base,
        type: 'check',
        taskSummary,
        estimate,
        model,
        ...(thinkingLevel ? { thinkingLevel } : {}),
        project,
        sessionId,
        ...(sessionFile ? { sessionFile } : {}),
      };
    }

    case 'start': {
      const taskId = asString(raw.taskId);
      const taskSummary = asString(raw.taskSummary);
      const estimate = parseEstimateRange(raw.estimate);
      const model = parseModel(raw.model);
      const project = parseProject(raw.project);
      const sessionId = asString(raw.sessionId);
      const startedAt = asString(raw.startedAt);
      if (!taskId || !taskSummary || !estimate || !model || !project || !sessionId || !startedAt) {
        return undefined;
      }
      const sessionFile = asString(raw.sessionFile);
      const calibratedRange = parseEstimateRange(raw.calibratedRange);
      const thinkingLevel = asString(raw.thinkingLevel);
      return {
        ...base,
        type: 'start',
        taskId,
        taskSummary,
        estimate,
        ...(calibratedRange ? { calibratedRange } : {}),
        model,
        ...(thinkingLevel ? { thinkingLevel } : {}),
        project,
        sessionId,
        startedAt,
        ...(sessionFile ? { sessionFile } : {}),
      };
    }

    case 'finish': {
      const taskId = asString(raw.taskId);
      const outcome = parseOutcome(raw.outcome);
      const model = parseModel(raw.model);
      const project = parseProject(raw.project);
      const sessionId = asString(raw.sessionId);
      const finishedAt = asString(raw.finishedAt);
      if (!taskId || !outcome || !model || !project || !sessionId || !finishedAt) return undefined;
      const sessionFile = asString(raw.sessionFile);
      const note = asString(raw.note);
      const actualWallMs = asNumber(raw.actualWallMs);
      const thinkingLevel = asString(raw.thinkingLevel);
      return {
        ...base,
        type: 'finish',
        taskId,
        outcome,
        model,
        ...(thinkingLevel ? { thinkingLevel } : {}),
        project,
        sessionId,
        finishedAt,
        ...(sessionFile ? { sessionFile } : {}),
        ...(note ? { note } : {}),
        ...(actualWallMs !== undefined ? { actualWallMs } : {}),
      };
    }

    default:
      return undefined;
  }
}

async function readEventsUnlocked(): Promise<EtaEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(EVENTS_PATH, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return parseEtaEvent(JSON.parse(line));
      } catch {
        return undefined;
      }
    })
    .filter((event): event is EtaEvent => event !== undefined);
}

function applyResets(events: EtaEvent[]): { activeEvents: EtaEvent[]; resetCount: number } {
  let lastResetIndex = -1;
  let resetCount = 0;
  events.forEach((event, index) => {
    if (event.type === 'reset') {
      lastResetIndex = index;
      resetCount += 1;
    }
  });
  return { activeEvents: events.slice(lastResetIndex + 1), resetCount };
}

function completedRecord(record: EtaTaskRecord): CompletedEtaRecord | undefined {
  if (record.finish?.outcome !== 'completed') return undefined;
  const computedMinutes = actualWallMinutes(record.startedAt, record.finish.finishedAt);
  const actualWallMs = record.finish.actualWallMs ?? (computedMinutes ?? 0) * 60000;
  if (!Number.isFinite(actualWallMs) || actualWallMs <= 0) return undefined;
  return {
    ...record,
    finish: record.finish as EtaFinishEvent & { outcome: 'completed' },
    actualWallMs,
  };
}

function isProfileMismatch(start: EtaStartEvent, finish: EtaFinishEvent): boolean {
  if (start.model.key !== finish.model.key) return true;
  return (
    start.thinkingLevel !== undefined &&
    finish.thinkingLevel !== undefined &&
    start.thinkingLevel !== finish.thinkingLevel
  );
}

export function buildEtaState(events: EtaEvent[]): EtaState {
  const { activeEvents, resetCount } = applyResets(events);
  const starts = new Map<string, EtaStartEvent>();
  const finishes = new Map<string, EtaFinishEvent>();
  const profileChanges = new Set<string>();
  const checks: EtaCheckEvent[] = [];

  for (const event of activeEvents) {
    if (event.type === 'check') checks.push(event);
    if (event.type === 'start') starts.set(event.taskId, event);
    if (event.type === 'finish') finishes.set(event.taskId, event);
    if (event.type === 'profile_change') profileChanges.add(event.taskId);
  }

  const records = [...starts.values()].map((start): EtaTaskRecord => {
    const finish = finishes.get(start.taskId);
    return {
      taskId: start.taskId,
      taskSummary: start.taskSummary,
      estimate: start.estimate,
      ...(start.calibratedRange ? { calibratedRange: start.calibratedRange } : {}),
      model: start.model,
      ...(start.thinkingLevel ? { thinkingLevel: start.thinkingLevel } : {}),
      project: start.project,
      sessionId: start.sessionId,
      ...(start.sessionFile ? { sessionFile: start.sessionFile } : {}),
      startedAt: start.startedAt,
      ...(finish ? { finish } : {}),
      mixedProfile:
        profileChanges.has(start.taskId) || (finish ? isProfileMismatch(start, finish) : false),
    };
  });

  const openRecords = records.filter((record) => !record.finish);
  const closedRecords = records.filter((record) => record.finish);
  const completedRecords = records
    .map(completedRecord)
    .filter((record): record is CompletedEtaRecord => record !== undefined);

  return {
    events: activeEvents,
    checks,
    records,
    openRecords,
    closedRecords,
    completedRecords,
    trainingRecords: completedRecords.filter((record) => !record.mixedProfile),
    resetCount,
  };
}

export async function readEtaState(): Promise<EtaState> {
  return buildEtaState(await readEventsUnlocked());
}

export async function appendEtaEvent(event: EtaEvent): Promise<void> {
  const release = await acquireLock();
  try {
    await fs.mkdir(dirname(EVENTS_PATH), { recursive: true });
    await fs.appendFile(EVENTS_PATH, `${JSON.stringify(event)}\n`, 'utf8');
  } finally {
    await release();
  }
}

export async function commitEtaEvent<T>(
  build: (
    state: EtaState,
  ) => Promise<{ event?: EtaEvent; value: T }> | { event?: EtaEvent; value: T },
): Promise<T> {
  const release = await acquireLock();
  try {
    const state = buildEtaState(await readEventsUnlocked());
    const result = await build(state);
    if (result.event) {
      await fs.appendFile(EVENTS_PATH, `${JSON.stringify(result.event)}\n`, 'utf8');
    }
    return result.value;
  } finally {
    await release();
  }
}

export function findOpenTaskForSession(
  state: EtaState,
  sessionId: string,
): EtaTaskRecord | undefined {
  return [...state.openRecords].reverse().find((record) => record.sessionId === sessionId);
}

export function findTaskById(state: EtaState, taskId: string): EtaTaskRecord | undefined {
  return state.records.find((record) => record.taskId === taskId);
}

export function getEventsPath(): string {
  return EVENTS_PATH;
}
