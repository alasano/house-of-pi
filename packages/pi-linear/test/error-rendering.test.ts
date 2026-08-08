import { describe, it, expect, beforeAll } from 'vitest';
import { initTheme, type Theme } from '@earendil-works/pi-coding-agent';
import { teamTools } from '../extensions/tools/teams';
import { userTools } from '../extensions/tools/users';
import { issueStatusTools } from '../extensions/tools/issue-statuses';
import { projectLabelTools } from '../extensions/tools/project-labels';
import { milestoneTools } from '../extensions/tools/milestones';
import { commentTools } from '../extensions/tools/comments';
import { documentTools } from '../extensions/tools/documents';
import { initiativeTools } from '../extensions/tools/initiatives';
import { issueLabelTools } from '../extensions/tools/issue-labels';
import { projectTools } from '../extensions/tools/projects';
import { issueTools } from '../extensions/tools/issues';
import { issueRelationTools } from '../extensions/tools/issue-relations';
import { projectRelationTools } from '../extensions/tools/project-relations';
import { workspaceTools } from '../extensions/tools/workspaces';

beforeAll(() => {
  initTheme('light');
});

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

// Two workspaces so workspaceTools registers linear_switch_workspace.
const creds = {
  activeWorkspace: 'primary',
  authPreference: 'workspace' as const,
  workspaces: { primary: { apiKey: 'key-1' }, secondary: { apiKey: 'key-2' } },
};

const tools = [
  ...teamTools(),
  ...userTools(),
  ...issueStatusTools(),
  ...projectLabelTools(),
  ...milestoneTools(),
  ...commentTools(),
  ...documentTools(),
  ...initiativeTools(),
  ...issueLabelTools(),
  ...projectTools(),
  ...issueTools(),
  ...issueRelationTools(),
  ...projectRelationTools(),
  ...workspaceTools(creds),
];

describe('tool renderers on failed calls', () => {
  it.each(tools.map((tool) => ({ name: tool.name, tool })))(
    '$name renders the error instead of a misleading summary',
    ({ tool }) => {
      const renderResult = tool.renderResult as (
        result: unknown,
        options: unknown,
        theme: unknown,
        context: unknown,
      ) => { render: (width: number) => string[] };
      expect(typeof renderResult).toBe('function');

      const text = renderResult(
        { content: [{ type: 'text', text: 'Linear GraphQL error: rate limited' }] },
        { isPartial: false, expanded: false },
        theme,
        { isError: true },
      )
        .render(120)
        .join('\n');

      expect(text).toContain('✗ Linear GraphQL error: rate limited');
      expect(text).not.toContain('✓');
      expect(text).not.toMatch(/No .* found/);
    },
  );
});
