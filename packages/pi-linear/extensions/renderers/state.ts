export type LinearToolRenderContext = {
  args?: unknown;
  toolCallId?: string;
  invalidate?: () => void;
};

let defaultJsonView = false;
const invalidators = new Map<string, () => void>();

export function getDefaultJsonView(): boolean {
  return defaultJsonView;
}

export function setDefaultJsonView(value: boolean): void {
  defaultJsonView = value;
}

export function registerLinearResultRenderer(context?: LinearToolRenderContext): void {
  if (typeof context?.invalidate !== 'function') return;

  const key = context.toolCallId;
  if (!key) return;

  invalidators.set(key, context.invalidate);
}

export function invalidateLinearResultRenderers(): void {
  for (const invalidate of invalidators.values()) {
    try {
      invalidate();
    } catch {
      // Ignore stale renderer invalidators. They are best-effort UI refresh hooks.
    }
  }
}
