import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { getAgentDir, getSettingsListTheme } from '@mariozechner/pi-coding-agent';
import { type SettingItem, SettingsList } from '@mariozechner/pi-tui';

const SETTINGS_PATH = join(getAgentDir(), 'state', 'extensions', 'linear', 'tool-settings.json');
const OVERLAY_MAX_INNER = 60;
const GOLD_FG = '\x1b[38;2;212;162;46m';
const RESET_FG = '\x1b[39m';

function gold(text: string): string {
  return `${GOLD_FG}${text}${RESET_FG}`;
}

const ANSI_RE = new RegExp(String.fromCharCode(0x1b) + '\\[[0-9;]*m', 'g');

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

const TOOL_CATEGORIES = [
  {
    id: 'issues',
    label: 'Issues',
    tools: [
      'linear_list_issues',
      'linear_get_issue',
      'linear_create_issue',
      'linear_update_issue',
      'linear_delete_issue',
      'linear_archive_issue',
      'linear_unarchive_issue',
      'linear_search_issues',
    ],
  },
  {
    id: 'issueLabels',
    label: 'Issue Labels',
    tools: [
      'linear_list_issue_labels',
      'linear_create_issue_label',
      'linear_update_issue_label',
      'linear_delete_issue_label',
    ],
  },
  {
    id: 'issueStatuses',
    label: 'Issue Statuses',
    tools: ['linear_list_issue_statuses'],
  },
  {
    id: 'issueRelations',
    label: 'Issue Relations',
    tools: [
      'linear_list_issue_relations',
      'linear_create_issue_relation',
      'linear_update_issue_relation',
      'linear_delete_issue_relation',
    ],
  },
  {
    id: 'comments',
    label: 'Comments',
    tools: [
      'linear_list_comments',
      'linear_create_comment',
      'linear_update_comment',
      'linear_delete_comment',
    ],
  },
  {
    id: 'projects',
    label: 'Projects',
    tools: [
      'linear_list_projects',
      'linear_get_project',
      'linear_save_project',
      'linear_delete_project',
      'linear_archive_project',
      'linear_unarchive_project',
    ],
  },
  {
    id: 'projectLabels',
    label: 'Project Labels',
    tools: [
      'linear_list_project_labels',
      'linear_create_project_label',
      'linear_update_project_label',
      'linear_delete_project_label',
    ],
  },
  {
    id: 'projectRelations',
    label: 'Project Relations',
    tools: [
      'linear_list_project_relations',
      'linear_create_project_relation',
      'linear_update_project_relation',
      'linear_delete_project_relation',
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    tools: [
      'linear_list_documents',
      'linear_get_document',
      'linear_create_document',
      'linear_update_document',
      'linear_delete_document',
      'linear_unarchive_document',
    ],
  },
  {
    id: 'initiatives',
    label: 'Initiatives',
    tools: [
      'linear_list_initiatives',
      'linear_get_initiative',
      'linear_save_initiative',
      'linear_delete_initiative',
      'linear_archive_initiative',
      'linear_unarchive_initiative',
    ],
  },
  {
    id: 'milestones',
    label: 'Milestones',
    tools: [
      'linear_list_milestones',
      'linear_get_milestone',
      'linear_save_milestone',
      'linear_delete_milestone',
    ],
  },
  {
    id: 'teams',
    label: 'Teams',
    tools: ['linear_list_teams', 'linear_get_team'],
  },
  {
    id: 'users',
    label: 'Users',
    tools: ['linear_list_users', 'linear_get_user'],
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    tools: ['linear_switch_workspace'],
  },
] as const;

const ALL_LINEAR_TOOLS = TOOL_CATEGORIES.flatMap((c) => c.tools);

type ToolSettings = {
  disabledTools: string[];
};

function createDefaultSettings(): ToolSettings {
  return { disabledTools: [] };
}

function loadSettings(): ToolSettings {
  if (!existsSync(SETTINGS_PATH)) {
    return createDefaultSettings();
  }
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.disabledTools)) {
      return createDefaultSettings();
    }
    return {
      disabledTools: raw.disabledTools.filter((t: unknown) => typeof t === 'string'),
    };
  } catch {
    return createDefaultSettings();
  }
}

function saveSettings(settings: ToolSettings): boolean {
  try {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function applySettings(pi: ExtensionAPI, settings: ToolSettings): void {
  const currentTools = pi.getActiveTools();
  const nonLinearTools = currentTools.filter(
    (t) => !(ALL_LINEAR_TOOLS as readonly string[]).includes(t),
  );
  const enabledLinearTools = ALL_LINEAR_TOOLS.filter((t) => !settings.disabledTools.includes(t));
  pi.setActiveTools([...nonLinearTools, ...enabledLinearTools]);
}

function isToolEnabled(settings: ToolSettings, tool: string): boolean {
  return !settings.disabledTools.includes(tool);
}

function checkboxValue(enabled: boolean): string {
  return enabled ? '[x]' : '[ ]';
}

function categoryValue(settings: ToolSettings, tools: readonly string[]): string {
  const enabledCount = tools.filter((t) => isToolEnabled(settings, t)).length;
  if (enabledCount === tools.length) return '[x]';
  if (enabledCount === 0) return '[ ]';
  return '[~]';
}

function categoryLabelText(
  label: string,
  settings: ToolSettings,
  tools: readonly string[],
): string {
  const enabledCount = tools.filter((t) => isToolEnabled(settings, t)).length;
  return `${label} (${enabledCount}/${tools.length})`;
}

function getCategoryForTool(tool: string): (typeof TOOL_CATEGORIES)[number] | undefined {
  return TOOL_CATEGORIES.find((c) => c.tools.includes(tool as never));
}

function computeOverlayInner(bodyLines: string[], availableWidth: number): number {
  const maxInner = Math.max(24, Math.min(availableWidth - 2, OVERLAY_MAX_INNER));
  return Math.max(
    24,
    Math.min(
      maxInner,
      Math.max(...bodyLines.map((line) => visibleWidth(line)), visibleWidth('─ LINEAR TOOLS ')) + 2,
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

function buildItems(settings: ToolSettings): SettingItem[] {
  const items: SettingItem[] = [];
  for (const category of TOOL_CATEGORIES) {
    items.push({
      id: `category:${category.id}`,
      label: categoryLabelText(category.label, settings, category.tools),
      currentValue: categoryValue(settings, category.tools),
      values: ['[x]', '[ ]'],
    });
    for (const tool of category.tools) {
      items.push({
        id: tool,
        label: `  ${tool}`,
        currentValue: checkboxValue(isToolEnabled(settings, tool)),
        values: ['[x]', '[ ]'],
      });
    }
  }
  return items;
}

function refreshCategoryItem(
  items: SettingItem[],
  settingsList: SettingsList,
  settings: ToolSettings,
  category: (typeof TOOL_CATEGORIES)[number],
): void {
  const categoryItemId = `category:${category.id}`;
  const item = items.find((i) => i.id === categoryItemId);
  if (item) {
    item.label = categoryLabelText(category.label, settings, category.tools);
  }
  settingsList.updateValue(categoryItemId, categoryValue(settings, category.tools));
}

async function showToolSettingsOverlay(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  settings: ToolSettings,
): Promise<void> {
  const items = buildItems(settings);
  const settingsTheme = getSettingsListTheme();
  const maxVisibleItems = Math.min(items.length + 2, 20);

  const probeList = new SettingsList(
    items,
    maxVisibleItems,
    settingsTheme,
    () => {},
    () => {},
  );
  const probeLines = probeList.render(Math.max(8, OVERLAY_MAX_INNER - 2));
  const overlayBodyLines = ['Toggle Linear tools by category or individually', '', ...probeLines];
  const overlayWidth = computeOverlayInner(overlayBodyLines, OVERLAY_MAX_INNER + 2) + 2;

  await ctx.ui.custom(
    (_tui, theme, _kb, done) => {
      const settingsList = new SettingsList(
        items,
        maxVisibleItems,
        settingsTheme,
        (id, newValue) => {
          const nextEnabled = newValue === '[x]';

          if (id.startsWith('category:')) {
            const categoryId = id.slice('category:'.length);
            const category = TOOL_CATEGORIES.find((c) => c.id === categoryId);
            if (!category) return;

            if (nextEnabled) {
              settings.disabledTools = settings.disabledTools.filter(
                (t) => !category.tools.includes(t as never),
              );
            } else {
              const toDisable = category.tools.filter((t) => !settings.disabledTools.includes(t));
              settings.disabledTools = [...settings.disabledTools, ...toDisable];
            }

            for (const tool of category.tools) {
              settingsList.updateValue(tool, checkboxValue(isToolEnabled(settings, tool)));
            }
            refreshCategoryItem(items, settingsList, settings, category);
          } else {
            if (nextEnabled) {
              settings.disabledTools = settings.disabledTools.filter((t) => t !== id);
            } else {
              settings.disabledTools = [...settings.disabledTools, id];
            }

            const category = getCategoryForTool(id);
            if (category) {
              refreshCategoryItem(items, settingsList, settings, category);
            }
          }

          saveSettings(settings);
          applySettings(pi, settings);
        },
        () => done(undefined),
        { enableSearch: true },
      );

      return {
        render(width: number) {
          const safeWidth = Math.max(24, width);
          const provisionalInner = Math.max(24, Math.min(safeWidth - 2, OVERLAY_MAX_INNER));
          const listLines = settingsList.render(Math.max(8, provisionalInner - 2));
          const bodyLines = [
            theme.fg('muted', 'Toggle Linear tools by category or individually'),
            '',
            ...listLines,
          ];
          const naturalInner = computeOverlayInner(bodyLines, safeWidth);
          return frameBody('LINEAR TOOLS', bodyLines, naturalInner);
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

export function registerLinearSettings(pi: ExtensionAPI): void {
  let settings = loadSettings();

  pi.registerCommand('linear-settings', {
    description: 'Open Linear tool settings',
    handler: async (_args, ctx) => {
      settings = loadSettings();
      await showToolSettingsOverlay(pi, ctx, settings);
    },
  });

  pi.on('session_start', async (_event, _ctx) => {
    settings = loadSettings();
    applySettings(pi, settings);
  });

  pi.on('session_before_switch', async (_event, _ctx) => {
    settings = loadSettings();
    applySettings(pi, settings);
  });
}
