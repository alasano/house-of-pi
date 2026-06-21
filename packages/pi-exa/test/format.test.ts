import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatAgentEventListResponse,
  formatAgentRunResponse,
  formatContentsResponse,
  formatSearchResponse,
} from '../extensions/format';
import { truncateToolOutput } from '../extensions/output';

describe('Exa formatting', () => {
  it('includes summary, highlights, and text when all are returned', () => {
    const formatted = formatSearchResponse({
      context: 'Combined Exa context',
      results: [
        {
          title: 'React Compiler',
          url: 'https://react.dev/learn/react-compiler',
          summary: 'Compiler summary',
          highlights: ['Compiler highlight'],
          text: 'Full compiler text',
        },
      ],
    });

    expect(formatted).toContain('Context:');
    expect(formatted).toContain('Combined Exa context');
    expect(formatted).toContain('Summary:');
    expect(formatted).toContain('Compiler summary');
    expect(formatted).toContain('Highlights:');
    expect(formatted).toContain('Compiler highlight');
    expect(formatted).toContain('Text:');
    expect(formatted).toContain('Full compiler text');
  });

  it('renders successful contents and per-result errors together', () => {
    const formatted = formatContentsResponse({
      results: [
        {
          title: 'Example',
          url: 'https://example.com',
          text: 'Fetched text',
        },
      ],
      statuses: [
        {
          id: 'https://missing.example',
          status: 'error',
          error: { tag: 'not_found' },
        },
      ],
    });

    expect(formatted).toContain('Fetched text');
    expect(formatted).toContain('Error fetching https://missing.example: not_found');
  });

  it('renders agent run output, sources, usage, and cost', () => {
    const formatted = formatAgentRunResponse({
      id: 'agent_run_test',
      status: 'completed',
      stopReason: 'schema_satisfied',
      createdAt: '2026-06-20T12:00:00.000Z',
      completedAt: '2026-06-20T12:00:10.000Z',
      request: { query: 'Research Example Inc.' },
      output: {
        text: 'Example Inc. is a sample company.',
        structured: {
          company: 'Example Inc.',
          recommendations: [
            {
              name: 'Example Product',
              tradeoffs: ['first full item', 'second full item'],
            },
          ],
        },
        grounding: [
          {
            field: 'company',
            confidence: 'high',
            citations: [{ title: 'Example', url: 'https://example.com' }],
          },
        ],
      },
      usage: { agentComputeUnits: 0.1, searches: 2, emails: 0, phoneNumbers: 0 },
      costDollars: { total: 0.02, agentCompute: 0.01, search: 0.01 },
    });

    expect(formatted).toContain('# Exa Agent Run: agent_run_test');
    expect(formatted).toContain('Status: completed | Stop reason: schema_satisfied');
    expect(formatted).toContain('Structured output:');
    expect(formatted).toContain('"company": "Example Inc."');
    expect(formatted).toContain('"recommendations"');
    expect(formatted).toContain('"first full item"');
    expect(formatted).toContain('Sources:');
    expect(formatted).toContain('- Example - https://example.com');
    expect(formatted).toContain('Citation grounding:');
    expect(formatted).toContain('"field": "company"');
    expect(formatted).toContain('Usage: agentComputeUnits: 0.1 | searches: 2');
    expect(formatted).toContain('Cost: total: 0.02');
  });

  it('renders agent events with pagination metadata', () => {
    const formatted = formatAgentEventListResponse({
      data: [
        {
          id: '1',
          event: 'agent_run.created',
          data: { id: 'agent_run_test', status: 'queued' },
        },
      ],
      hasMore: true,
      nextCursor: 'next',
    });

    expect(formatted).toContain('Agent run events: 1');
    expect(formatted).toContain('agent_run.created');
    expect(formatted).toContain('nextCursor: next');
  });

  it('truncates large tool output and saves the full payload', async () => {
    const output = await truncateToolOutput(
      Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n'),
      'format-test',
      'Use a narrower request. ',
      { maxLines: 3, maxBytes: 10_000 },
    );

    expect(output.text).toContain('Output truncated');
    expect(output.text).toContain('Full output saved to:');
    expect(output.fullOutputPath).toBeTruthy();

    if (output.fullOutputPath) {
      await rm(dirname(output.fullOutputPath), { recursive: true, force: true });
    }
  });
});
