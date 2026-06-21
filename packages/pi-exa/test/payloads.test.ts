import { describe, expect, it } from 'vitest';
import type { AgentRunTracker } from '../extensions/agent-tracker';
import { buildWebAnswerRequest } from '../extensions/tools/web-answer';
import { buildWebAgentRequest } from '../extensions/tools/web-agent';
import {
  buildAgentEventReplayRequest,
  buildAgentPaginationRequest,
} from '../extensions/tools/web-agent-runs';
import { buildWebFetchRequest } from '../extensions/tools/web-fetch';
import { buildWebSearchRequest } from '../extensions/tools/web-search';
import { buildWebSearchAdvancedRequest } from '../extensions/tools/web-search-advanced';
import { createExaTools } from '../extensions/tools';

describe('Exa request payloads', () => {
  it('builds simple search payloads with auto search and highlights', () => {
    const request = buildWebSearchRequest({ query: 'category:news AI policy', numResults: 3 });
    expect(request).toEqual({
      query: 'AI policy',
      type: 'auto',
      numResults: 3,
      category: 'news',
      contents: { highlights: true },
    });
    expect(request.contents).not.toHaveProperty('text');
  });

  it('builds advanced search payloads with text enabled by default', () => {
    expect(buildWebSearchAdvancedRequest({ query: 'React 19 compiler docs' })).toEqual({
      query: 'React 19 compiler docs',
      type: 'auto',
      numResults: 10,
      contents: {
        text: true,
      },
    });
  });

  it('builds advanced search payloads with capped text and opt-in extras', () => {
    expect(
      buildWebSearchAdvancedRequest({
        query: 'React 19 compiler docs',
        includeDomains: ['react.dev'],
        textMaxCharacters: 500,
        contextMaxCharacters: 1200,
        enableHighlights: true,
        highlightsQuery: 'compiler examples',
        enableSummary: true,
        summaryQuery: 'compiler constraints',
        maxAgeHours: 0,
      }),
    ).toEqual({
      query: 'React 19 compiler docs',
      type: 'auto',
      numResults: 10,
      includeDomains: ['react.dev'],
      contents: {
        text: { maxCharacters: 500 },
        context: { maxCharacters: 1200 },
        summary: { query: 'compiler constraints' },
        highlights: { query: 'compiler examples' },
        maxAgeHours: 0,
      },
    });
  });

  it('omits advanced highlights unless enabled', () => {
    expect(
      buildWebSearchAdvancedRequest({
        query: 'Exa docs',
        highlightsMaxCharacters: 300,
        highlightsQuery: 'agents',
      }),
    ).toEqual({
      query: 'Exa docs',
      type: 'auto',
      numResults: 10,
      contents: {
        text: true,
      },
    });
  });

  it('uses modern top-level contents payload shape with a compact default', () => {
    expect(buildWebFetchRequest({ urls: ['https://example.com'] })).toEqual({
      urls: ['https://example.com'],
      text: { maxCharacters: 3000 },
    });
    expect(buildWebFetchRequest({ urls: ['https://example.com'], maxCharacters: 1200 })).toEqual({
      urls: ['https://example.com'],
      text: { maxCharacters: 1200 },
    });
  });

  it('builds answer payloads without streaming', () => {
    expect(
      buildWebAnswerRequest({
        query: 'What changed in Exa MCP?',
        text: false,
        outputSchema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      }),
    ).toEqual({
      query: 'What changed in Exa MCP?',
      text: false,
      outputSchema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
      },
    });
  });

  it('keeps answer output schema optional', () => {
    expect(buildWebAnswerRequest({ query: 'What is Exa?' })).toEqual({
      query: 'What is Exa?',
    });
  });

  it('builds agent run payloads without pi-only execution controls', () => {
    expect(
      buildWebAgentRequest({
        query: 'Find current AI infrastructure seed rounds and cite sources.',
        systemPrompt: 'Prefer primary sources.',
        effort: 'medium',
        input: {
          data: [{ company: 'Example', domain: 'example.com' }],
          exclusion: [{ company: 'Old Example' }],
        },
        outputSchema: {
          type: 'object',
          properties: {
            companies: {
              type: 'array',
              maxItems: 5,
              items: { type: 'object' },
            },
          },
        },
        previousRunId: 'agent_run_previous',
        metadata: { source: 'test' },
        mode: 'background',
        monitor: 'poll',
        pollIntervalMs: 5000,
        timeoutMs: 10000,
      }),
    ).toEqual({
      query: 'Find current AI infrastructure seed rounds and cite sources.',
      systemPrompt: 'Prefer primary sources.',
      effort: 'medium',
      input: {
        data: [{ company: 'Example', domain: 'example.com' }],
        exclusion: [{ company: 'Old Example' }],
      },
      outputSchema: {
        type: 'object',
        properties: {
          companies: {
            type: 'array',
            maxItems: 5,
            items: { type: 'object' },
          },
        },
      },
      previousRunId: 'agent_run_previous',
      metadata: { source: 'test' },
    });
  });

  it('builds agent pagination query parameters', () => {
    expect(buildAgentPaginationRequest({ limit: 10, cursor: 'next' })).toEqual({
      limit: 10,
      cursor: 'next',
    });
    expect(buildAgentPaginationRequest({})).toEqual({});
  });

  it('builds agent event replay parameters without JSON pagination fields', () => {
    expect(
      buildAgentEventReplayRequest({
        runId: 'agent_run_test',
        limit: 20,
        cursor: 'cursor',
        replay: true,
        lastEventId: '3',
      }),
    ).toEqual({
      lastEventId: '3',
    });
  });

  it('registers only the supported modern tool names', () => {
    const tools = createExaTools({} as AgentRunTracker);
    expect(tools.map((tool) => tool.name)).toEqual([
      'web_search_exa',
      'web_search_advanced_exa',
      'web_fetch_exa',
      'web_answer_exa',
      'web_agent_exa',
      'web_agent_get_exa',
      'web_agent_list_exa',
      'web_agent_cancel_exa',
      'web_agent_delete_exa',
      'web_agent_events_exa',
    ]);
    expect(tools.every((tool) => typeof tool.renderCall === 'function')).toBe(true);
    expect(tools.every((tool) => typeof tool.renderResult === 'function')).toBe(true);
  });
});
