import { truncateToWidth } from '@mariozechner/pi-tui';
import { clamp, GREEN_DARK_FG, GREEN_FG, visibleWidth } from './utils';
import {
  computePanelWidths,
  framePanelBody,
  renderRow,
  SEPARATOR_WIDTH,
  type BuiltPanel,
} from './panel';

const ORANGE_LIGHT_FG = '\x1b[38;2;242;145;62m';
const ORANGE_RED_FG = '\x1b[38;2;222;92;44m';

export type PlayerState = 'playing' | 'paused' | 'stopped';

export type SpotifyInfo = {
  running: boolean;
  state: PlayerState;
  track: string;
  artist: string;
  positionSec: number;
  durationMs: number;
};

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;

  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderOrangeFill(count: number, blinkPhase: number): string {
  if (count <= 0) return '';

  let out = '';
  for (let i = 0; i < count; i++) {
    const isNewestTick = i === count - 1;
    const color = isNewestTick && blinkPhase % 2 === 0 ? ORANGE_LIGHT_FG : ORANGE_RED_FG;
    out += `${color}█\x1b[39m`;
  }
  return out;
}

export function buildNowPlayingPanel(
  spotify: SpotifyInfo,
  phase: number,
  maxInner: number,
): BuiltPanel | undefined {
  if (!spotify.running) return undefined;

  const icon = spotify.state === 'playing' ? '▶' : '⏸';
  const right = `Spotify ${icon}`;

  const songValueRaw = spotify.artist
    ? `${spotify.track || '(unknown)'} • ${spotify.artist}`
    : spotify.track || '(unknown)';

  const durationSec = spotify.durationMs > 0 ? spotify.durationMs / 1000 : 0;
  const ratio = durationSec > 0 ? clamp(spotify.positionSec / durationSec, 0, 1) : 0;
  const timeTextRaw = `${formatTime(spotify.positionSec)} / ${formatTime(durationSec)}`;

  const labels = ['song', 'time'];
  const labelWidth = Math.max(...labels.map((l) => l.length));
  const desiredBarWidth = 20;
  const timeMeasure = desiredBarWidth + 1 + timeTextRaw.length;
  const naturalContentWidth = Math.max(
    labelWidth + SEPARATOR_WIDTH + songValueRaw.length,
    labelWidth + SEPARATOR_WIDTH + timeMeasure,
  );

  const { inner, contentWidth } = computePanelWidths({
    title: 'NOW PLAYING',
    rightText: right,
    naturalContentWidth,
    maxInner,
    minInner: 28,
  });

  const renderTimeValue = (valueWidth: number) => {
    const availableForBar = valueWidth - (timeTextRaw.length + 1);
    const barWidth = availableForBar > 0 ? Math.min(20, availableForBar) : 0;
    const formattedTime =
      barWidth > 0 ? timeTextRaw : truncateToWidth(timeTextRaw, valueWidth, '…');

    const filled = barWidth > 0 ? Math.round(ratio * barWidth) : 0;
    const empty = Math.max(0, barWidth - filled);

    const fillPart =
      spotify.state === 'playing' ? renderOrangeFill(filled, phase) : '█'.repeat(filled);

    const emptyPart = '░'.repeat(empty);
    const separator = barWidth > 0 ? ' ' : '';

    const shown = `${fillPart}${emptyPart}${separator}${formattedTime}`;
    const deficit = valueWidth - visibleWidth(shown);
    return deficit > 0 ? `${shown}${' '.repeat(deficit)}` : shown;
  };

  return framePanelBody({
    title: 'NOW PLAYING',
    rightText: right,
    bodyLines: [
      renderRow('song', GREEN_FG, labelWidth, contentWidth, (vw) =>
        truncateToWidth(songValueRaw, vw, '…', true),
      ),
      renderRow('time', GREEN_DARK_FG, labelWidth, contentWidth, renderTimeValue),
    ],
    inner,
    contentWidth,
  });
}
