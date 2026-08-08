import { describe, it, expect } from 'vitest';
import { allLinearTools } from '../extensions/index';
import { TOOL_CATEGORIES } from '../extensions/settings';
import type { WorkspaceCredentials } from '../extensions/client';

// Two workspaces so workspaceTools registers linear_switch_workspace.
const creds: WorkspaceCredentials = {
  activeWorkspace: 'primary',
  authPreference: 'workspace',
  workspaces: { primary: { apiKey: 'key-1' }, secondary: { apiKey: 'key-2' } },
};

describe('settings registration parity', () => {
  it('settings categories list exactly the registered linear tools', () => {
    const registered = allLinearTools(creds).map((tool) => tool.name);
    const listed = TOOL_CATEGORIES.flatMap((category) => category.tools);
    expect([...listed].sort()).toEqual([...registered].sort());
  });
});
