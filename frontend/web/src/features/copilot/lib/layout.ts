/** Copilot 三列布局 — 桌面"会话历史 | 主区 | 上下文"，窄屏折叠为单列。 */

export type ColumnMode = 'three-column' | 'two-column' | 'stacked';

export type Viewport = {
  width: number;
  height: number;
};

export type ColumnVisibility = {
  /** 左侧会话历史列。 */
  sessions: boolean;
  /** 中间主对话列（始终可见，恒为 true）。 */
  main: boolean;
  /** 右侧上下文 / 引用列。 */
  details: boolean;
};

export type LayoutConfig = {
  /** 桌面上始终可见会话历史与上下文的最小宽度。 */
  threeColumnMinWidth: number;
  /** 桌面上至少能容纳主列 + 单侧的最小宽度。 */
  twoColumnMinWidth: number;
  /** 单侧列宽最小保留宽度（拖拽不可低于）。 */
  minSideColumnWidth: number;
  /** 默认侧栏宽度。 */
  defaultSessionsWidth: number;
  defaultDetailsWidth: number;
};

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  threeColumnMinWidth: 1280,
  twoColumnMinWidth: 900,
  minSideColumnWidth: 220,
  defaultSessionsWidth: 280,
  defaultDetailsWidth: 320,
};

export function resolveColumnMode(
  viewport: Viewport,
  visibility: ColumnVisibility,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): ColumnMode {
  if (viewport.width >= config.threeColumnMinWidth && visibility.sessions && visibility.details) {
    return 'three-column';
  }
  if (viewport.width >= config.twoColumnMinWidth && (visibility.sessions || visibility.details)) {
    return 'two-column';
  }
  return 'stacked';
}

export type GridTemplate = {
  columns: string;
  rows?: string;
  areas?: string;
};

export function gridTemplateForMode(
  mode: ColumnMode,
  cfg: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
  widths: { sessions?: number; details?: number } = {},
): GridTemplate {
  const sessionsW = widths.sessions ?? cfg.defaultSessionsWidth;
  const detailsW = widths.details ?? cfg.defaultDetailsWidth;
  switch (mode) {
    case 'three-column':
      return {
        columns: `${sessionsW}px minmax(0, 1fr) ${detailsW}px`,
        rows: '100%',
        areas: '"sessions main details"',
      };
    case 'two-column':
      return {
        columns: `minmax(0, 1fr) ${detailsW}px`,
        rows: '100%',
        areas: '"main details"',
      };
    case 'stacked':
    default:
      return {
        columns: 'minmax(0, 1fr)',
        rows: 'auto auto auto',
        areas: '"main"',
      };
  }
}

/** 推荐：每个侧栏默认的最小 / 最大宽度约束。 */
export function columnWidthConstraints(cfg: LayoutConfig = DEFAULT_LAYOUT_CONFIG) {
  return {
    min: cfg.minSideColumnWidth,
    max: Math.max(cfg.minSideColumnWidth + 200, Math.round(cfg.defaultSessionsWidth * 2)),
  };
}

/** 当上下文被钉住时，无论 viewport 宽度如何，都升级为三列布局。 */
export function effectiveColumnMode(
  viewport: Viewport,
  visibility: ColumnVisibility,
  detailsPinned: boolean,
  cfg: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): ColumnMode {
  if (detailsPinned && visibility.details && visibility.sessions) {
    return viewport.width >= cfg.twoColumnMinWidth ? 'three-column' : 'stacked';
  }
  return resolveColumnMode(viewport, visibility, cfg);
}

export function sessionHistoryPresentation(viewportWidth: number): 'pinned' | 'drawer' {
  return viewportWidth >= DEFAULT_LAYOUT_CONFIG.twoColumnMinWidth ? 'pinned' : 'drawer';
}