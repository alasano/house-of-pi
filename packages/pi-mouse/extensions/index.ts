import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from '@mariozechner/pi-coding-agent';

const DEBOUNCE_MS = 420;
const TICK_MS = 65;
const CURSOR_ALIGNMENT_OFFSET = 1;
const MOVE_STEP = 2;
const IDLE_CYCLE_TICKS = 6;

const LEFT_FRAMES = ['<:3 )~~~', '<:3 )~^~', '<:3 )~~^'];
const RIGHT_FRAMES = ['~~~( Ɛ:>', '~^~( Ɛ:>', '^~~( Ɛ:>'];

type Facing = 'left' | 'right';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function overlayLine(width: number, sprite: string, x: number): string {
  if (width <= 0) return '';
  const line = Array.from({ length: width }, () => ' ');
  for (let i = 0; i < sprite.length; i++) {
    const col = x + i;
    if (col < 0 || col >= width) continue;
    line[col] = sprite[i]!;
  }
  return line.join('');
}

class CursorMouseEditor extends CustomEditor {
  private noseX = 2;
  private targetNoseX = 2;
  private facing: Facing = 'left';

  private tailFrame = 0;
  private idleTick = 0;
  private lastRenderWidth = 80;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private animTimer: ReturnType<typeof setInterval> | null = null;

  constructor(...args: ConstructorParameters<typeof CustomEditor>) {
    super(...args);

    this.animTimer = setInterval(() => {
      let changed = false;

      const delta = this.targetNoseX - this.noseX;
      if (delta !== 0) {
        this.syncFacingToTarget();

        const step = Math.abs(delta) <= MOVE_STEP ? Math.abs(delta) : MOVE_STEP;
        this.noseX += this.facing === 'right' ? step : -step;
        this.tailFrame = (this.tailFrame + 1) % LEFT_FRAMES.length;
        changed = true;
      } else {
        this.idleTick = (this.idleTick + 1) % IDLE_CYCLE_TICKS;
        if (this.idleTick === 0) {
          this.tailFrame = (this.tailFrame + 1) % LEFT_FRAMES.length;
          changed = true;
        }
      }

      if (changed) this.tui.requestRender();
    }, TICK_MS);
  }

  private currentSprite(): string {
    return this.facing === 'right' ? RIGHT_FRAMES[this.tailFrame]! : LEFT_FRAMES[this.tailFrame]!;
  }

  private contentWidth(): number {
    return Math.max(1, this.lastRenderWidth - (this.getPaddingX() * 2 + 2));
  }

  private syncFacingToTarget(): void {
    const delta = this.targetNoseX - this.noseX;
    if (delta === 0) return;
    this.facing = delta > 0 ? 'right' : 'left';
  }

  private updateTargetFromCursor(): void {
    const cursor = this.getCursor();
    const visualCol = cursor.col % this.contentWidth();

    this.targetNoseX = clamp(
      this.getPaddingX() + CURSOR_ALIGNMENT_OFFSET + visualCol,
      0,
      Math.max(0, this.lastRenderWidth - 1),
    );

    // Flip as soon as debounce finishes, before movement starts.
    this.syncFacingToTarget();
    this.tui.requestRender();
  }

  private scheduleMoveToCursor(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.updateTargetFromCursor(), DEBOUNCE_MS);
  }

  override handleInput(data: string): void {
    super.handleInput(data);
    this.scheduleMoveToCursor();
  }

  override render(width: number): string[] {
    const editorLines = super.render(width);
    if (width <= 0) return editorLines;

    this.lastRenderWidth = width;

    const sprite = this.currentSprite();
    const noseAnchor = this.facing === 'left' ? 0 : sprite.length - 1;

    this.noseX = clamp(this.noseX, 0, width - 1);
    this.targetNoseX = clamp(this.targetNoseX, 0, width - 1);

    const left = this.noseX - noseAnchor;
    const mouseLine = overlayLine(width, sprite, left);

    return [mouseLine, ...editorLines];
  }

  public dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.animTimer) clearInterval(this.animTimer);
  }
}

export default function cursorMouseExtension(pi: ExtensionAPI) {
  let enabled = true;

  const applyEditor = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    if (!enabled) {
      ctx.ui.setEditorComponent(undefined);
      return;
    }

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => new CursorMouseEditor(tui, theme, keybindings),
    );
  };

  pi.registerCommand('cursor-mouse', {
    description: 'Enable or disable cursor mouse editor (usage: /cursor-mouse <on|off>)',
    handler: async (args, ctx) => {
      const mode = args?.trim().toLowerCase();
      if (mode !== 'on' && mode !== 'off') {
        ctx.ui.notify('Usage: /cursor-mouse <on|off>', 'warning');
        return;
      }

      enabled = mode === 'on';

      applyEditor(ctx);
      ctx.ui.notify(enabled ? 'Cursor mouse enabled' : 'Cursor mouse disabled', 'info');
    },
  });

  pi.on('session_start', async (_event, ctx) => applyEditor(ctx));
  pi.on('session_switch', async (_event, ctx) => applyEditor(ctx));
  pi.on('session_shutdown', async (_event, ctx) => {
    ctx.ui.setEditorComponent(undefined);
  });
}
