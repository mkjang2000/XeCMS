import type { GridPlacement } from "@xecms/admin-apps";

/** Fixed base geometry from the CPB-0/§4.2 decisions. */
export const GRID_COLUMNS = 48;
export const CANVAS_WIDTH = 1152; // 48 columns × 24px
export const SHELL_WIDTH = 1440; // common base width
export const ROW_HEIGHT = 8; // logical row in px at scale 1
export const MIN_SCALE = 0.7; // lower clamp (§D-22)
export const MAX_SCALE = 1; // never enlarge (§D-16)

export type LayoutProfile = "16:9" | "4:3";

/** Base viewport height per aspect profile (common 1440 width). */
export function baseViewportHeight(profile: LayoutProfile): number {
  return profile === "4:3" ? 1080 : 810;
}

/**
 * The single scale applied to the whole App shell. Never enlarges (≤1) and is
 * clamped to a readable floor; smaller viewports scroll rather than reflow.
 */
export function computeShellScale(
  viewportWidth: number,
  viewportHeight: number,
  profile: LayoutProfile,
): number {
  const raw = Math.min(
    MAX_SCALE,
    viewportWidth / SHELL_WIDTH,
    viewportHeight / baseViewportHeight(profile),
  );
  if (!Number.isFinite(raw) || raw <= 0) return MIN_SCALE;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw));
}

export interface GridStyle {
  readonly gridColumn: string;
  readonly gridRow: string;
}

/** Maps integer grid coordinates to a CSS grid placement (1-based lines). */
export function placementStyle(placement: GridPlacement): GridStyle {
  return {
    gridColumn: `${placement.x + 1} / span ${placement.width}`,
    gridRow: `${placement.y + 1} / span ${placement.height}`,
  };
}

/** Width of one grid column in canvas px (CANVAS_WIDTH / GRID_COLUMNS). */
export const COLUMN_WIDTH = CANVAS_WIDTH / GRID_COLUMNS; // 24px

export interface GridCell {
  readonly x: number;
  readonly y: number;
}

/** Snaps a canvas-space pixel offset to the nearest grid cell (Builder drag). */
export function pointToCell(offsetX: number, offsetY: number): GridCell {
  return {
    x: Math.round(offsetX / COLUMN_WIDTH),
    y: Math.round(offsetY / ROW_HEIGHT),
  };
}

/** Clamps a placement into the canvas bounds without changing its size intent. */
export function clampPlacement(placement: GridPlacement): GridPlacement {
  const width = Math.max(1, Math.min(GRID_COLUMNS, Math.round(placement.width)));
  const height = Math.max(1, Math.round(placement.height));
  const x = Math.max(0, Math.min(GRID_COLUMNS - width, Math.round(placement.x)));
  const y = Math.max(0, Math.round(placement.y));
  return { x, y, width, height };
}

/** Rectangles overlap when they intersect on both axes (D-02 collision). */
export function placementsOverlap(a: GridPlacement, b: GridPlacement): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}
