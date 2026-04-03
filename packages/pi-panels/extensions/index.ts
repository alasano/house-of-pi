import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { getAgentDir, getSettingsListTheme } from '@mariozechner/pi-coding-agent';
import {
  decodeKittyPrintable,
  matchesKey,
  parseKey,
  type SettingItem,
  SettingsList,
  truncateToWidth,
} from '@mariozechner/pi-tui';
import { buildGitPanel, EMPTY_GIT_STATE, type GitInfo } from './git';
import { buildInfoPanel, type InfoSnapshot } from './info';
import { framePanelBody } from './panel';
import { buildNowPlayingPanel, type PlayerState, type SpotifyInfo } from './now-playing';
import { maxVisibleWidth, padVisible, visibleWidth } from './utils';

const SETTINGS_OVERLAY_MAX_INNER = 56;

function computeSettingsOverlayInner(bodyLines: string[], availableWidth: number): number {
  const maxInner = Math.max(24, Math.min(availableWidth - 2, SETTINGS_OVERLAY_MAX_INNER));
  return Math.max(
    24,
    Math.min(maxInner, Math.max(maxVisibleWidth(bodyLines), visibleWidth('─ STATUS PANELS ')) + 2),
  );
}

function getPrintableTypingKey(data: string): string | undefined {
  const kittyPrintable = decodeKittyPrintable(data);
  if (kittyPrintable && kittyPrintable !== ' ') {
    return kittyPrintable;
  }

  const parsed = parseKey(data);
  if (parsed && parsed.length === 1 && parsed !== ' ') {
    return parsed;
  }

  if (data.length === 1 && data !== ' ' && /^[\x21-\x7E]$/.test(data)) {
    return data;
  }

  return undefined;
}

const WIDGET_ID = 'status-panels';
const REFRESH_MS = 5000;
const NOW_PLAYING_FETCH_PLAYING_MS = 1000;
const NOW_PLAYING_FETCH_IDLE_MS = 2500;
const TICK_MS = 250;
const GAP = ' ';
const CONFIG_PATH = join(getAgentDir(), 'state', 'extensions', 'status-panels', 'config.json');

const PANEL_DEFS = [
  { id: 'git', label: 'Git', defaultEnabled: true },
  { id: 'info', label: 'Info', defaultEnabled: true },
  { id: 'nowPlaying', label: 'Spotify', defaultEnabled: true },
] as const;

type PanelId = (typeof PANEL_DEFS)[number]['id'];
type PanelState = Record<PanelId, boolean>;

type StatusPanelsConfig = {
  enabled: boolean;
  panels: PanelState;
};

function createPanelState(enabled: boolean): PanelState {
  return PANEL_DEFS.reduce((panels, panel) => {
    panels[panel.id] = enabled;
    return panels;
  }, {} as PanelState);
}

function createDefaultConfig(): StatusPanelsConfig {
  return {
    enabled: true,
    panels: createPanelState(true),
  };
}

function normalizeConfig(raw: unknown): StatusPanelsConfig {
  const defaults = createDefaultConfig();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }

  const input = raw as { enabled?: unknown; panels?: Record<string, unknown> };
  const panels = { ...defaults.panels };

  for (const panel of PANEL_DEFS) {
    const value = input.panels?.[panel.id];
    if (typeof value === 'boolean') {
      panels[panel.id] = value;
    }
  }

  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : defaults.enabled,
    panels,
  };
}

function loadConfig(): StatusPanelsConfig {
  if (!existsSync(CONFIG_PATH)) {
    return createDefaultConfig();
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return normalizeConfig(raw);
  } catch (error) {
    console.error(`Failed to load status panels config from ${CONFIG_PATH}:`, error);
    return createDefaultConfig();
  }
}

function saveConfig(config: StatusPanelsConfig): boolean {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    console.error(`Failed to save status panels config to ${CONFIG_PATH}:`, error);
    return false;
  }
}

function parseCount(raw: string): { behind: number; ahead: number } {
  const [behindRaw, aheadRaw] = raw.trim().split(/\s+/);
  return {
    behind: Number.parseInt(behindRaw || '0', 10) || 0,
    ahead: Number.parseInt(aheadRaw || '0', 10) || 0,
  };
}

function combineSideBySide(left: string[], leftWidth: number, right: string[]): string[] {
  const rows = Math.max(left.length, right.length);
  const output: string[] = [];

  for (let i = 0; i < rows; i++) {
    const l = left[i] ?? ' '.repeat(leftWidth);
    const r = right[i] ?? '';
    output.push(`${padVisible(l, leftWidth)}${GAP}${r}`);
  }

  return output;
}

function emptySpotifyState(): SpotifyInfo {
  return {
    running: false,
    state: 'stopped',
    track: '',
    artist: '',
    positionSec: 0,
    durationMs: 0,
  };
}

export default function statusPanelsExtension(pi: ExtensionAPI) {
  let ctxRef: ExtensionContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let config = loadConfig();
  let fetchingSpotify = false;
  let lastGitRefreshAt = 0;
  let lastSpotifyFetchAt = 0;
  let gradientPhase = 0;
  let gradientTick = 0;

  let gitState: GitInfo = EMPTY_GIT_STATE;

  let infoState: InfoSnapshot = {
    percent: null,
    tokens: null,
    contextWindow: 0,
    modelText: '(no model)',
  };

  let spotifyState: SpotifyInfo = emptySpotifyState();

  function isPanelEnabled(panelId: PanelId): boolean {
    return config.panels[panelId];
  }

  function checkboxValue(enabled: boolean): string {
    return enabled ? '[x]' : '[ ]';
  }

  function persistConfig(ctx?: ExtensionContext): boolean {
    const ok = saveConfig(config);
    if (!ok && ctx?.hasUI) {
      ctx.ui.notify('Failed to save status panels preferences', 'error');
    }
    return ok;
  }

  function applyConfig(ctx?: ExtensionContext) {
    if (ctx) ctxRef = ctx;

    if (!isPanelEnabled('nowPlaying')) {
      spotifyState = emptySpotifyState();
    }

    if (!config.enabled) {
      stop();
      return;
    }

    stop();
    start();
  }

  function setMasterEnabled(nextEnabled: boolean, ctx?: ExtensionContext) {
    config = {
      enabled: nextEnabled,
      panels: createPanelState(nextEnabled),
    };
    persistConfig(ctx);
    applyConfig(ctx);
  }

  function setPanelEnabled(panelId: PanelId, nextEnabled: boolean, ctx?: ExtensionContext) {
    config = {
      ...config,
      panels: {
        ...config.panels,
        [panelId]: nextEnabled,
      },
    };
    persistConfig(ctx);
    applyConfig(ctx);
  }

  async function runGit(args: string[]): Promise<string | undefined> {
    try {
      const result = await pi.exec('git', args, { timeout: 2000 });
      if (result.code !== 0) return undefined;
      const value = result.stdout.trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  async function readGitInfo(): Promise<GitInfo> {
    const inside = await runGit(['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') {
      return EMPTY_GIT_STATE;
    }

    const topLevel = (await runGit(['rev-parse', '--show-toplevel'])) || '-';
    const worktree = topLevel.split('/').filter(Boolean).pop() || topLevel;

    const branch =
      (await runGit(['branch', '--show-current'])) ||
      (await runGit(['rev-parse', '--short', 'HEAD'])) ||
      '(detached)';

    const upstream = await runGit([
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{upstream}',
    ]);

    if (!upstream) {
      return {
        inRepo: true,
        worktree,
        branch,
        tracking: '(no upstream)',
        ahead: 0,
        behind: 0,
      };
    }

    const countsRaw = await runGit(['rev-list', '--left-right', '--count', `${upstream}...HEAD`]);
    const { behind, ahead } = parseCount(countsRaw || '0 0');

    return {
      inRepo: true,
      worktree,
      branch,
      tracking: upstream,
      ahead,
      behind,
    };
  }

  function readInfoState(ctx: ExtensionContext): InfoSnapshot {
    const usage = ctx.getContextUsage();

    const modelId = ctx.model?.id || '(no model)';
    const thinking = pi.getThinkingLevel();

    return {
      percent: usage?.percent ?? null,
      tokens: usage?.tokens ?? null,
      contextWindow: usage?.contextWindow ?? 0,
      modelText: `${modelId} • ${thinking}`,
    };
  }

  async function readSpotify(): Promise<SpotifyInfo> {
    const script = `
if application "Spotify" is running then
  tell application "Spotify"
    set ps to player state as string
    if ps is "stopped" then
      return "RUNNING\nstopped\n\n\n0\n0"
    end if
    set tName to name of current track
    set tArtist to artist of current track
    set tPos to player position
    set tDur to duration of current track
    return "RUNNING\n" & ps & "\n" & tName & "\n" & tArtist & "\n" & (tPos as string) & "\n" & (tDur as string)
  end tell
else
  return "NOT_RUNNING"
end if
`.trim();

    try {
      const result = await pi.exec('osascript', ['-e', script], { timeout: 2000 });
      if (result.code !== 0) {
        return emptySpotifyState();
      }

      const output = result.stdout.trim();
      if (output === 'NOT_RUNNING') {
        return emptySpotifyState();
      }

      const lines = output.split('\n');
      const stateRaw = (lines[1] || 'stopped').trim();
      const state: PlayerState =
        stateRaw === 'playing' ? 'playing' : stateRaw === 'paused' ? 'paused' : 'stopped';

      const positionSec = Number.parseFloat((lines[4] || '0').replace(',', '.'));
      const durationMs = Number.parseInt(lines[5] || '0', 10);

      return {
        running: true,
        state,
        track: lines[2] || '',
        artist: lines[3] || '',
        positionSec: Number.isFinite(positionSec) ? positionSec : 0,
        durationMs: Number.isFinite(durationMs) ? durationMs : 0,
      };
    } catch {
      return emptySpotifyState();
    }
  }

  function buildTopBlock(safeWidth: number): string[] {
    const panels: Array<{ lines: string[]; width: number }> = [];

    if (isPanelEnabled('git')) {
      panels.push(buildGitPanel(gitState, safeWidth - 2));
    }

    if (isPanelEnabled('info')) {
      panels.push(buildInfoPanel(infoState, safeWidth - 2));
    }

    if (panels.length === 0) {
      return [];
    }

    if (panels.length === 1) {
      return panels[0]!.lines;
    }

    const [first, second] = panels;
    const naturalCombined = first!.width + visibleWidth(GAP) + second!.width;
    if (naturalCombined <= safeWidth) {
      return combineSideBySide(first!.lines, first!.width, second!.lines);
    }

    const leftOuterTarget = Math.max(28, Math.floor((safeWidth - visibleWidth(GAP)) * 0.55));
    const rightOuterTarget = Math.max(28, safeWidth - visibleWidth(GAP) - leftOuterTarget);

    const gitCompact = buildGitPanel(gitState, Math.max(24, leftOuterTarget - 2));
    const infoCompact = buildInfoPanel(infoState, Math.max(24, rightOuterTarget - 2));

    const compactCombined = gitCompact.width + visibleWidth(GAP) + infoCompact.width;
    if (compactCombined <= safeWidth) {
      return combineSideBySide(gitCompact.lines, gitCompact.width, infoCompact.lines);
    }

    return [...first!.lines, ...second!.lines];
  }

  function renderPanels() {
    if (!config.enabled || !ctxRef?.hasUI) return;

    ctxRef.ui.setWidget(
      WIDGET_ID,
      (_tui, _theme) => ({
        invalidate() {},
        render(width: number) {
          const safeWidth = Math.max(1, width);
          const clampLines = (lines: string[]) =>
            lines.map((line) => truncateToWidth(line, safeWidth));

          const topBlock = buildTopBlock(safeWidth);
          if (!isPanelEnabled('nowPlaying')) {
            return clampLines(topBlock);
          }

          const nowPlayingNatural = buildNowPlayingPanel(
            spotifyState,
            gradientPhase,
            safeWidth - 2,
          );
          if (!nowPlayingNatural) {
            return clampLines(topBlock);
          }

          if (topBlock.length === 0) {
            return clampLines(nowPlayingNatural.lines);
          }

          const topWidth = maxVisibleWidth(topBlock);
          const gapWidth = visibleWidth(GAP);

          if (topWidth + gapWidth + nowPlayingNatural.width <= safeWidth) {
            return clampLines(combineSideBySide(topBlock, topWidth, nowPlayingNatural.lines));
          }

          const availableForNowPlaying = safeWidth - topWidth - gapWidth;
          if (availableForNowPlaying >= 30) {
            const nowPlayingCompact = buildNowPlayingPanel(
              spotifyState,
              gradientPhase,
              Math.max(28, availableForNowPlaying - 2),
            );

            if (nowPlayingCompact && topWidth + gapWidth + nowPlayingCompact.width <= safeWidth) {
              return clampLines(combineSideBySide(topBlock, topWidth, nowPlayingCompact.lines));
            }
          }

          return clampLines([...topBlock, ...nowPlayingNatural.lines]);
        },
      }),
      { placement: 'belowEditor' },
    );
  }

  async function refreshCore(force = false) {
    if (!ctxRef) return;
    const now = Date.now();
    if (!force && now - lastGitRefreshAt < REFRESH_MS) return;

    gitState = await readGitInfo();
    infoState = readInfoState(ctxRef);
    lastGitRefreshAt = now;
  }

  async function refreshSpotify(force = false) {
    if (!ctxRef || !isPanelEnabled('nowPlaying') || fetchingSpotify) return;
    const now = Date.now();
    const interval =
      spotifyState.state === 'playing' ? NOW_PLAYING_FETCH_PLAYING_MS : NOW_PLAYING_FETCH_IDLE_MS;

    if (!force && now - lastSpotifyFetchAt < interval) return;

    fetchingSpotify = true;
    spotifyState = await readSpotify();
    fetchingSpotify = false;
    lastSpotifyFetchAt = now;
  }

  async function tick(forceCore = false, forceSpotify = false) {
    if (!config.enabled || !ctxRef?.hasUI) return;

    gradientTick = (gradientTick + 1) % 2;
    if (gradientTick === 0) {
      gradientPhase = (gradientPhase + 1) % 2;
    }

    await refreshCore(forceCore);
    await refreshSpotify(forceSpotify);
    renderPanels();
  }

  function start() {
    if (!config.enabled || !ctxRef?.hasUI) return;
    if (timer) return;

    void tick(true, true);
    timer = setInterval(() => {
      void tick(false, false);
    }, TICK_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    if (ctxRef?.hasUI) {
      ctxRef.ui.setWidget(WIDGET_ID, undefined);
    }
  }

  async function showSettingsOverlay(ctx: ExtensionContext): Promise<void> {
    ctxRef = ctx;

    const items: SettingItem[] = [
      {
        id: 'enabled',
        label: 'Show all panels',
        currentValue: checkboxValue(config.enabled),
        values: ['[x]', '[ ]'],
      },
      ...PANEL_DEFS.map((panel) => ({
        id: panel.id,
        label: panel.label,
        currentValue: checkboxValue(isPanelEnabled(panel.id)),
        values: ['[x]', '[ ]'],
      })),
    ];

    const settingsTheme = getSettingsListTheme();
    const maxVisibleItems = Math.min(items.length + 2, 10);
    const probeList = new SettingsList(
      items,
      maxVisibleItems,
      settingsTheme,
      () => {},
      () => {},
    );
    const probeLines = probeList.render(Math.max(8, SETTINGS_OVERLAY_MAX_INNER - 2));
    const overlayBodyLines = ['Choose which panels are visible', '', ...probeLines];
    const overlayWidth =
      computeSettingsOverlayInner(overlayBodyLines, SETTINGS_OVERLAY_MAX_INNER + 2) + 2;

    await ctx.ui.custom(
      (_tui, theme, _kb, done) => {
        const settingsList = new SettingsList(
          items,
          maxVisibleItems,
          settingsTheme,
          (id, newValue) => {
            const nextEnabled = newValue === '[x]';
            if (id === 'enabled') {
              setMasterEnabled(nextEnabled, ctx);
              for (const panel of PANEL_DEFS) {
                settingsList.updateValue(panel.id, checkboxValue(nextEnabled));
              }
              return;
            }

            setPanelEnabled(id as PanelId, nextEnabled, ctx);
          },
          () => done(undefined),
        );

        return {
          render(width: number) {
            const safeWidth = Math.max(24, width);
            const provisionalInner = Math.max(
              24,
              Math.min(safeWidth - 2, SETTINGS_OVERLAY_MAX_INNER),
            );
            const listLines = settingsList.render(Math.max(8, provisionalInner - 2));
            const bodyLines = [
              theme.fg('muted', 'Choose which panels are visible'),
              '',
              ...listLines,
            ];
            const naturalInner = computeSettingsOverlayInner(bodyLines, safeWidth);

            return framePanelBody({
              title: 'STATUS PANELS',
              bodyLines,
              inner: naturalInner,
            }).lines;
          },
          invalidate() {
            settingsList.invalidate();
          },
          handleInput(data: string) {
            const printableKey = getPrintableTypingKey(data);
            if (
              printableKey &&
              !matchesKey(data, 'escape') &&
              !matchesKey(data, 'return') &&
              !matchesKey(data, 'up') &&
              !matchesKey(data, 'down') &&
              !matchesKey(data, 'left') &&
              !matchesKey(data, 'right')
            ) {
              done(undefined);
              queueMicrotask(() => ctx.ui.pasteToEditor(printableKey));
              return;
            }

            settingsList.handleInput?.(data);
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: 'center',
          width: overlayWidth,
        },
      },
    );
  }

  pi.registerCommand('status-panels', {
    description: 'Open status panel settings, or use /status-panels [on|off]',
    handler: async (args, ctx) => {
      ctxRef = ctx;
      const mode = (args || '').trim().toLowerCase();

      if (mode === '' || mode === 'settings') {
        await showSettingsOverlay(ctx);
        return;
      }

      if (!['on', 'off'].includes(mode)) {
        ctx.ui.notify('Usage: /status-panels [on|off]', 'warning');
        return;
      }

      const nextEnabled = mode === 'on';
      setMasterEnabled(nextEnabled, ctx);
      ctx.ui.notify(nextEnabled ? 'Status panels visible' : 'Status panels hidden', 'info');
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    config = loadConfig();
    applyConfig(ctx);
  });

  pi.on('session_switch', async (_event, ctx) => {
    config = loadConfig();
    applyConfig(ctx);
  });

  pi.on('turn_end', async (_event, ctx) => {
    ctxRef = ctx;
    if (!config.enabled) return;
    void tick(true, true);
  });

  pi.on('model_select', async (_event, ctx) => {
    ctxRef = ctx;
    if (!config.enabled) return;
    infoState = readInfoState(ctx);
    renderPanels();
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    ctxRef = ctx;
    stop();
  });
}
