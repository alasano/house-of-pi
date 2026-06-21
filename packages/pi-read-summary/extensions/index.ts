import type { Component } from '@earendil-works/pi-tui';
import { Box } from '@earendil-works/pi-tui';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createReadTool, isToolCallEventType } from '@earendil-works/pi-coding-agent';
import { getOrCreateEntry, markEntryFailed, type ReadBatch } from './batches';
import { normalizeDisplayPath } from './paths';
import {
  getReadStartLine,
  extractReadLineCount,
  isImageReadResult,
  type ToolContentBlock,
} from './read-result';
import { addLineRange } from './ranges';
import { createReadSummaryComponent } from './render';

type RenderContextWithToolCallId = {
  toolCallId: string;
};

type ReadSummaryMeta = {
  __readSummary?: {
    batchId: string;
    toolCallId: string;
  };
};

const batchesRef = new Map<string, ReadBatch>();

function emptyComponent(): Component {
  return { render: () => [], invalidate() {} };
}

function mergeDetailsWithMeta(
  details: unknown,
  meta: NonNullable<ReadSummaryMeta['__readSummary']>,
): Record<string, unknown> {
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return {
      ...(details as Record<string, unknown>),
      __readSummary: meta,
    };
  }

  return { __readSummary: meta };
}

function getSummaryMeta(details: unknown): ReadSummaryMeta['__readSummary'] | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;

  const raw = (details as ReadSummaryMeta).__readSummary;
  if (!raw) return undefined;
  if (typeof raw.batchId !== 'string') return undefined;
  if (typeof raw.toolCallId !== 'string') return undefined;
  return raw;
}

export default function readSummaryExtension(pi: ExtensionAPI) {
  const originalRead = createReadTool(process.cwd());
  const batches = batchesRef;
  const toolCallToBatch = new Map<string, string>();
  const toolCallToPath = new Map<string, string>();

  let activeBatchId: string | undefined;
  let batchCounter = 0;

  function clearState(): void {
    batches.clear();
    toolCallToBatch.clear();
    toolCallToPath.clear();
    activeBatchId = undefined;
    batchCounter = 0;
  }

  function createBatch(anchorToolCallId: string): ReadBatch {
    batchCounter += 1;
    const batch: ReadBatch = {
      id: `read-batch-${batchCounter}`,
      anchorToolCallId,
      entries: [],
      inFlight: 0,
      pendingFinalize: false,
      done: false,
    };

    batches.set(batch.id, batch);
    activeBatchId = batch.id;
    return batch;
  }

  function startReadCall(toolCallId: string, path: string): ReadBatch {
    let batch = activeBatchId ? batches.get(activeBatchId) : undefined;

    if (!batch || batch.done || batch.pendingFinalize) {
      batch = createBatch(toolCallId);
    }

    const entry = getOrCreateEntry(batch, path);
    if (entry) {
      entry.inFlight += 1;
    }

    batch.inFlight += 1;
    toolCallToBatch.set(toolCallId, batch.id);
    toolCallToPath.set(toolCallId, path);
    return batch;
  }

  function markActiveBatchPendingFinalize(): void {
    if (!activeBatchId) return;

    const batch = batches.get(activeBatchId);
    if (!batch) {
      activeBatchId = undefined;
      return;
    }

    batch.pendingFinalize = true;
    if (batch.inFlight === 0) {
      batch.done = true;
      activeBatchId = undefined;
    }
  }

  function completeReadCall(toolCallId: string): void {
    const batchId = toolCallToBatch.get(toolCallId);
    if (!batchId) return;

    const batch = batches.get(batchId);
    if (!batch) return;

    batch.inFlight = Math.max(0, batch.inFlight - 1);

    const path = toolCallToPath.get(toolCallId);
    if (path) {
      const entry = getOrCreateEntry(batch, path);
      if (entry) {
        entry.inFlight = Math.max(0, entry.inFlight - 1);
      }
    }

    if (batch.pendingFinalize && batch.inFlight === 0) {
      batch.done = true;
      if (activeBatchId === batch.id) {
        activeBatchId = undefined;
      }
    }
  }

  pi.on('tool_call', async (event) => {
    if (isToolCallEventType('read', event)) {
      startReadCall(event.toolCallId, normalizeDisplayPath(event.input.path));
      return;
    }

    markActiveBatchPendingFinalize();
  });

  pi.on('message_end', async (event) => {
    if (event.message.role === 'assistant' && event.message.stopReason !== 'toolUse') {
      markActiveBatchPendingFinalize();
    }
  });

  pi.on('agent_end', async () => {
    markActiveBatchPendingFinalize();
  });

  pi.on('session_start', async () => {
    clearState();
  });

  pi.registerTool({
    name: 'read',
    label: originalRead.label,
    description: originalRead.description,
    parameters: originalRead.parameters,
    renderShell: 'self',

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const path = normalizeDisplayPath(params.path, ctx.cwd);
      let batchId = toolCallToBatch.get(toolCallId);
      if (!batchId) {
        batchId = startReadCall(toolCallId, path).id;
      }

      try {
        const result = await originalRead.execute(toolCallId, params, signal, onUpdate);

        const batch = batches.get(batchId);
        const entry = batch ? getOrCreateEntry(batch, path) : undefined;
        if (entry) {
          const resultLike = {
            content: result.content as ToolContentBlock[] | undefined,
            details: result.details,
          };
          entry.isImage = entry.isImage || isImageReadResult(resultLike);

          if (!entry.isImage) {
            const lineCount = extractReadLineCount(resultLike);
            if (typeof lineCount === 'number') {
              entry.ranges = addLineRange(entry.ranges, getReadStartLine(params), lineCount);
            }
          }
        }

        return {
          ...result,
          details: mergeDetailsWithMeta(result.details, { batchId, toolCallId }),
        };
      } catch (error) {
        markEntryFailed(batches, batchId, path);
        throw error;
      } finally {
        completeReadCall(toolCallId);
      }
    },

    renderCall() {
      return emptyComponent();
    },

    renderResult(result, options, theme, context: RenderContextWithToolCallId) {
      let meta = getSummaryMeta(result.details);
      if (!meta) {
        const batchId = toolCallToBatch.get(context.toolCallId);
        if (batchId) {
          meta = { batchId, toolCallId: context.toolCallId };
        }
      }

      if (!meta) return emptyComponent();

      const batch = batches.get(meta.batchId);
      if (!batch || batch.anchorToolCallId !== meta.toolCallId) {
        return emptyComponent();
      }

      const box = new Box(1, 0);
      box.addChild(createReadSummaryComponent(meta.batchId, batches, theme, options.expanded));
      return box;
    },
  });
}
