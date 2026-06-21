import type { AgentRunTracker } from '../agent-tracker';
import { createWebAnswerTool } from './web-answer';
import { createWebAgentTool } from './web-agent';
import {
  createWebAgentCancelTool,
  createWebAgentDeleteTool,
  createWebAgentEventsTool,
  createWebAgentGetTool,
  createWebAgentListTool,
} from './web-agent-runs';
import { createWebFetchTool } from './web-fetch';
import { createWebSearchTool } from './web-search';
import { createWebSearchAdvancedTool } from './web-search-advanced';

export function createExaTools(tracker: AgentRunTracker) {
  return [
    createWebSearchTool(),
    createWebSearchAdvancedTool(),
    createWebFetchTool(),
    createWebAnswerTool(),
    createWebAgentTool(tracker),
    createWebAgentGetTool(),
    createWebAgentListTool(),
    createWebAgentCancelTool(),
    createWebAgentDeleteTool(),
    createWebAgentEventsTool(),
  ];
}
