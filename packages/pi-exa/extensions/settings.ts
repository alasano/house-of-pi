import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir, getSettingsListTheme } from '@earendil-works/pi-coding-agent';
import { type SettingItem, SettingsList } from '@earendil-works/pi-tui';
import { isRecord } from './util';

const SETTINGS_PATH = join(getAgentDir(), 'state', 'extensions', 'pi-exa', 'tool-settings.json');
const OVERLAY_MAX_INNER = 60;
const GOLD_FG = '\x1b[38;2;212;162;46m';
const RESET_FG = '\x1b[39m';
const ANSI_RE = new RegExp(String.fromCharCode(0x1b) + '\\[[0-9;]*m', 'g');

const PRIMARY_TOOL_ITEMS = [
  { id: 'web_search_exa', label: 'web_search_exa' },
  { id: 'web_search_advanced_exa', label: 'web_search_advanced_exa' },
  { id: 'web_fetch_exa', label: 'web_fetch_exa' },
  { id: 'web_answer_exa', label: 'web_answer_exa' },
] as const;

export const AGENT_TOOL_NAMES = [
  'web_agent_exa',
  'web_agent_get_exa',
  'web_agent_list_exa',
  'web_agent_cancel_exa',
  'web_agent_delete_exa',
  'web_agent_events_exa',
] as const;

export const ALL_EXA_TOOLS = [
  ...PRIMARY_TOOL_ITEMS.map((item) => item.id),
  ...AGENT_TOOL_NAMES,
] as const;

type ToolSettings = {
  disabledTools: string[];
};

function checkboxValue(enabled: boolean): string {
  return enabled ? '[x]' : '[ ]';
}

function gold(text: string): string {
  return `${GOLD_FG}${text}${RESET_FG}`;
}

function isKnownExaTool(tool: string): tool is (typeof ALL_EXA_TOOLS)[number] {
  return (ALL_EXA_TOOLS as readonly string[]).includes(tool);
}

export function normalizeExaToolSettings(raw: unknown): ToolSettings {
  if (!isRecord(raw) || !Array.isArray(raw.disabledTools)) return { disabledTools: [] };

  const disabled = raw.disabledTools.filter(
    (tool: unknown): tool is string => typeof tool === 'string' && isKnownExaTool(tool),
  );
  const agentDisabled = disabled.some((tool) =>
    (AGENT_TOOL_NAMES as readonly string[]).includes(tool),
  );

  return {
    disabledTools: [
      ...PRIMARY_TOOL_ITEMS.flatMap((item) => (disabled.includes(item.id) ? [item.id] : [])),
      ...(agentDisabled ? [...AGENT_TOOL_NAMES] : []),
    ],
  };
}

function createDefaultSettings(): ToolSettings {
  return { disabledTools: [] };
}

async function loadSettings(): Promise<ToolSettings> {
  try {
    return normalizeExaToolSettings(JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf8')));
  } catch {
    return createDefaultSettings();
  }
}

async function saveSettings(settings: ToolSettings): Promise<boolean> {
  try {
    await fs.mkdir(dirname(SETTINGS_PATH), { recursive: true });
    await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function applySettings(pi: ExtensionAPI, settings: ToolSettings): void {
  const currentTools = pi.getActiveTools();
  const nonExaTools = currentTools.filter((tool) => !isKnownExaTool(tool));
  const enabledExaTools = ALL_EXA_TOOLS.filter((tool) => !settings.disabledTools.includes(tool));
  pi.setActiveTools([...nonExaTools, ...enabledExaTools]);
}

function isToolEnabled(settings: ToolSettings, tool: string): boolean {
  return !settings.disabledTools.includes(tool);
}

function areAgentToolsEnabled(settings: ToolSettings): boolean {
  return AGENT_TOOL_NAMES.every((tool) => isToolEnabled(settings, tool));
}

function buildItems(settings: ToolSettings): SettingItem[] {
  return [
    ...PRIMARY_TOOL_ITEMS.map((tool) => ({
      id: tool.id,
      label: tool.label,
      currentValue: checkboxValue(isToolEnabled(settings, tool.id)),
      values: ['[x]', '[ ]'],
    })),
    {
      id: 'agent-tools',
      label: `web_agent_exa + ${AGENT_TOOL_NAMES.length - 1} other tools`,
      currentValue: checkboxValue(areAgentToolsEnabled(settings)),
      values: ['[x]', '[ ]'],
    },
  ];
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

function padVisible(text: string, width: number): string {
  const deficit = width - visibleWidth(text);
  if (deficit <= 0) return text;
  return `${text}${' '.repeat(deficit)}`;
}

function computeOverlayInner(bodyLines: string[], availableWidth: number): number {
  const maxInner = Math.max(24, Math.min(availableWidth - 2, OVERLAY_MAX_INNER));
  return Math.max(
    24,
    Math.min(
      maxInner,
      Math.max(...bodyLines.map((line) => visibleWidth(line)), visibleWidth('─ EXA TOOLS ')) + 2,
    ),
  );
}

function frameBody(title: string, bodyLines: string[], inner: number): string[] {
  const leftHeader = `─ ${title} `;
  const fill = Math.max(1, inner - leftHeader.length);
  const top = gold('╭') + gold(leftHeader) + gold('─'.repeat(fill)) + gold('╮');
  const bottom = gold('╰') + gold('─'.repeat(inner)) + gold('╯');
  const contentWidth = Math.max(8, inner - 2);
  const framedBody = bodyLines.map(
    (line) => gold('│ ') + padVisible(line, contentWidth) + gold(' │'),
  );
  return [top, ...framedBody, bottom];
}

async function showToolSettingsOverlay(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  settings: ToolSettings,
): Promise<void> {
  const items = buildItems(settings);
  const settingsTheme = getSettingsListTheme();
  const maxVisibleItems = Math.min(items.length + 2, 12);

  const probeList = new SettingsList(
    items,
    maxVisibleItems,
    settingsTheme,
    () => {},
    () => {},
  );
  const probeLines = probeList.render(Math.max(8, OVERLAY_MAX_INNER - 2));
  const overlayBodyLines = ['Configure Exa tools', '', ...probeLines];
  const overlayWidth = computeOverlayInner(overlayBodyLines, OVERLAY_MAX_INNER + 2) + 2;

  await ctx.ui.custom(
    (_tui, theme, _kb, done) => {
      const settingsList = new SettingsList(
        items,
        maxVisibleItems,
        settingsTheme,
        async (id, newValue) => {
          const nextEnabled = newValue === '[x]';

          if (id === 'agent-tools') {
            settings.disabledTools = nextEnabled
              ? settings.disabledTools.filter(
                  (tool) => !(AGENT_TOOL_NAMES as readonly string[]).includes(tool),
                )
              : [
                  ...settings.disabledTools.filter(
                    (tool) => !(AGENT_TOOL_NAMES as readonly string[]).includes(tool),
                  ),
                  ...AGENT_TOOL_NAMES,
                ];
          } else if (nextEnabled) {
            settings.disabledTools = settings.disabledTools.filter((tool) => tool !== id);
          } else {
            settings.disabledTools = [...settings.disabledTools.filter((tool) => tool !== id), id];
          }

          const normalized = normalizeExaToolSettings(settings);
          settings.disabledTools = normalized.disabledTools;
          settingsList.updateValue('agent-tools', checkboxValue(areAgentToolsEnabled(settings)));

          await saveSettings(settings);
          applySettings(pi, settings);
        },
        () => done(undefined),
      );

      return {
        render(width: number) {
          const safeWidth = Math.max(24, width);
          const provisionalInner = Math.max(24, Math.min(safeWidth - 2, OVERLAY_MAX_INNER));
          const listLines = settingsList.render(Math.max(8, provisionalInner - 2));
          const bodyLines = [theme.fg('muted', 'Configure Exa tools'), '', ...listLines];
          const naturalInner = computeOverlayInner(bodyLines, safeWidth);
          return frameBody('EXA TOOLS', bodyLines, naturalInner);
        },
        invalidate() {
          settingsList.invalidate();
        },
        handleInput(data: string) {
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

export async function registerExaSettings(pi: ExtensionAPI): Promise<void> {
  let settings = await loadSettings();

  pi.registerCommand('exa-settings', {
    description: 'Open Exa tool settings',
    handler: async (_args, ctx) => {
      settings = await loadSettings();
      await showToolSettingsOverlay(pi, ctx, settings);
    },
  });

  pi.on('session_start', async (_event, _ctx) => {
    settings = await loadSettings();
    applySettings(pi, settings);
  });

  pi.on('session_before_switch', async (_event, _ctx) => {
    settings = await loadSettings();
    applySettings(pi, settings);
  });
}
