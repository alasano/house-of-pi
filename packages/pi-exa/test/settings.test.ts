import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_NAMES, normalizeExaToolSettings } from '../extensions/settings';

describe('Exa tool settings', () => {
  it('normalizes unknown tools away', () => {
    expect(
      normalizeExaToolSettings({
        disabledTools: ['web_search_exa', 'not_an_exa_tool'],
      }),
    ).toEqual({
      disabledTools: ['web_search_exa'],
    });
  });

  it('keeps agent lifecycle tools all on or all off', () => {
    expect(
      normalizeExaToolSettings({
        disabledTools: ['web_agent_get_exa'],
      }),
    ).toEqual({
      disabledTools: [...AGENT_TOOL_NAMES],
    });
  });
});
