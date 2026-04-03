import { GREEN_DARK_FG, GREEN_FG } from './utils';
import { truncateToWidth } from '@mariozechner/pi-tui';
import {
  computePanelWidths,
  framePanelBody,
  renderRow,
  SEPARATOR_WIDTH,
  type BuiltPanel,
} from './panel';

export type GitInfo = {
  inRepo: boolean;
  worktree: string;
  branch: string;
  tracking: string;
  ahead: number;
  behind: number;
};

export const EMPTY_GIT_STATE: GitInfo = {
  inRepo: false,
  worktree: '-',
  branch: '-',
  tracking: '(no repository)',
  ahead: 0,
  behind: 0,
};

type GitRow = {
  label: string;
  value: string;
  labelColor?: string;
};

export function buildGitPanel(snapshot: GitInfo, maxInner: number): BuiltPanel {
  const worktreeValue = snapshot.inRepo ? snapshot.worktree : '(not a git repository)';
  const branchValue = snapshot.inRepo ? snapshot.branch : '-';
  const trackingValue = snapshot.inRepo ? snapshot.tracking : '-';

  const expectedTracking = `origin/${branchValue}`;
  const shouldShowTracking =
    snapshot.inRepo && (trackingValue === '(no upstream)' || trackingValue !== expectedTracking);

  const rows: GitRow[] = shouldShowTracking
    ? [
        { label: 'worktree', value: worktreeValue, labelColor: GREEN_FG },
        { label: 'branch', value: branchValue, labelColor: GREEN_DARK_FG },
        { label: 'tracking', value: trackingValue, labelColor: GREEN_DARK_FG },
      ]
    : [
        { label: 'worktree', value: worktreeValue, labelColor: GREEN_FG },
        { label: 'branch', value: branchValue, labelColor: GREEN_DARK_FG },
      ];

  const labelWidth = rows.reduce((max, row) => Math.max(max, row.label.length), 0);

  const right = `↑${snapshot.ahead} ↓${snapshot.behind}`;

  const naturalContentWidth = rows.reduce(
    (max, row) => Math.max(max, labelWidth + SEPARATOR_WIDTH + row.value.length),
    0,
  );

  const { inner, contentWidth } = computePanelWidths({
    title: 'GIT',
    rightText: right,
    naturalContentWidth,
    maxInner,
    minInner: 24,
  });

  return framePanelBody({
    title: 'GIT',
    rightText: right,
    bodyLines: rows.map((entry) =>
      renderRow(entry.label, entry.labelColor, labelWidth, contentWidth, (vw) =>
        truncateToWidth(entry.value, vw, '…', true),
      ),
    ),
    inner,
    contentWidth,
  });
}
