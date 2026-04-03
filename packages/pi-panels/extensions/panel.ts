import { gold, padVisible, tint, visibleWidth } from './utils';

export type BuiltPanel = {
  lines: string[];
  width: number;
};

const SEPARATOR = ' │ ';
export const SEPARATOR_WIDTH = 3;

type PanelWidthOptions = {
  title: string;
  rightText?: string;
  naturalContentWidth: number;
  maxInner: number;
  minInner?: number;
};

type PanelFrameOptions = {
  title: string;
  bodyLines: string[];
  inner: number;
  contentWidth?: number;
  rightText?: string;
};

function panelHeaderLeft(title: string): string {
  return `─ ${title} `;
}

export function computePanelWidths({
  title,
  rightText,
  naturalContentWidth,
  maxInner,
  minInner = 24,
}: PanelWidthOptions): { inner: number; contentWidth: number } {
  const leftHeader = panelHeaderLeft(title);
  const rightSegment = rightText ? ` ${rightText} ` : '';
  const minHeaderInner = leftHeader.length + rightSegment.length + 1;
  const naturalInner = Math.max(minHeaderInner, naturalContentWidth + 2);
  const inner = Math.max(minInner, Math.min(maxInner, naturalInner));
  const contentWidth = Math.max(8, inner - 2);

  return { inner, contentWidth };
}

export function framePanelBody({
  title,
  bodyLines,
  inner,
  contentWidth: passedContentWidth,
  rightText,
}: PanelFrameOptions): BuiltPanel {
  const leftHeader = panelHeaderLeft(title);
  const rightSegment = rightText ? ` ${rightText} ` : '';
  const fill = Math.max(1, inner - leftHeader.length - rightSegment.length);

  const top =
    gold('╭') +
    gold(leftHeader) +
    gold('─'.repeat(fill)) +
    (rightSegment ? gold(rightSegment) : '') +
    gold('╮');

  const bottom = gold('╰') + gold('─'.repeat(inner)) + gold('╯');
  const contentWidth = passedContentWidth ?? Math.max(8, inner - 2);

  const framedBody = bodyLines.map(
    (line) => gold('│ ') + padVisible(line, contentWidth) + gold(' │'),
  );
  const lines = [top, ...framedBody, bottom];
  return { lines, width: visibleWidth(top) };
}

export function renderRow(
  label: string,
  labelColor: string | undefined,
  labelWidth: number,
  contentWidth: number,
  renderValue: (valueWidth: number) => string,
): string {
  const paddedLabel = label.padEnd(labelWidth, ' ');
  const coloredLabel = labelColor ? tint(paddedLabel, labelColor) : paddedLabel;
  const valueWidth = Math.max(1, contentWidth - (labelWidth + SEPARATOR_WIDTH));
  return `${coloredLabel}${SEPARATOR}${renderValue(valueWidth)}`;
}
