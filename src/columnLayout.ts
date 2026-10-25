import type { Memento } from "vscode";

/** The jobs table's columns in their default order, with default widths in px. Note has none: it takes the rest. */
export const COLUMNS = [
  { id: "id", label: "ID", width: 180 },
  { id: "name", label: "Job", width: 140 },
  { id: "note", label: "Note", width: undefined },
  { id: "state", label: "State", width: 120 },
  { id: "start", label: "Start", width: 140 },
  { id: "elapsed", label: "Elapsed / limit", width: 160 },
  { id: "partition", label: "Partition", width: 100 },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];

/** How the person arranged the columns: their order, the hidden ones and the widths they dragged. */
export interface ColumnLayout {
  order: ColumnId[];
  hidden: ColumnId[];
  widths: Partial<Record<ColumnId, number>>;
}

/** Where the layout is kept: `globalState`, not synced, since widths suit one screen. */
export const COLUMN_LAYOUT_STATE_KEY = "ctun.jobsColumns";
/** ID carries the nesting indent, so it stays first and shown. */
export const PINNED_COLUMN: ColumnId = "id";
export const MIN_COLUMN_WIDTH = 60;

const COLUMN_IDS: readonly ColumnId[] = COLUMNS.map((column) => column.id);

export const DEFAULT_COLUMN_LAYOUT: ColumnLayout = { order: [...COLUMN_IDS], hidden: [], widths: {} };

export function columnLabel(id: ColumnId): string {
  return COLUMNS.find((column) => column.id === id)!.label;
}

/** The column's width in px; undefined for Note, which takes the rest. */
export function columnWidth(layout: ColumnLayout, id: ColumnId): number | undefined {
  const defaultWidth = COLUMNS.find((column) => column.id === id)!.width;
  return defaultWidth === undefined ? undefined : layout.widths[id] ?? defaultWidth;
}

/** The shown columns in their order. */
export function shownColumns(layout: ColumnLayout): (typeof COLUMNS)[number][] {
  return layout.order.filter((id) => !layout.hidden.includes(id)).map((id) => COLUMNS.find((column) => column.id === id)!);
}

/** A stored layout made valid: known columns only, every column once, ID first and shown, widths not below the minimum. */
export function normalizeLayout(stored: unknown): ColumnLayout {
  const value = (typeof stored === "object" && stored !== null ? stored : {}) as Partial<Record<keyof ColumnLayout, unknown>>;
  const isColumn = (id: unknown): id is ColumnId => COLUMN_IDS.includes(id as ColumnId);
  const listed = Array.isArray(value.order) ? value.order.filter(isColumn) : [];
  const order = [...new Set([PINNED_COLUMN, ...listed, ...COLUMN_IDS])];
  const hidden = Array.isArray(value.hidden) ? [...new Set(value.hidden.filter(isColumn))].filter((id) => id !== PINNED_COLUMN) : [];
  const storedWidths = typeof value.widths === "object" && value.widths !== null ? (value.widths as Record<string, unknown>) : {};
  const widths: Partial<Record<ColumnId, number>> = {};
  for (const id of COLUMN_IDS) {
    const width = storedWidths[id];
    if (typeof width === "number" && Number.isFinite(width) && columnWidth(DEFAULT_COLUMN_LAYOUT, id) !== undefined) {
      widths[id] = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    }
  }
  return { order, hidden, widths };
}

/** Moves `column` to where `target` is: after it when it came from the left, before it otherwise. ID never moves. */
export function moveColumn(layout: ColumnLayout, column: ColumnId, target: ColumnId): ColumnLayout {
  if (column === target || column === PINNED_COLUMN || target === PINNED_COLUMN) {
    return layout;
  }
  const order = layout.order.filter((id) => id !== column);
  const comesFromLeft = layout.order.indexOf(column) < layout.order.indexOf(target);
  order.splice(order.indexOf(target) + (comesFromLeft ? 1 : 0), 0, column);
  return { ...layout, order };
}

/** Hides a shown column and shows a hidden one; ID stays shown. */
export function toggleColumn(layout: ColumnLayout, column: ColumnId): ColumnLayout {
  if (column === PINNED_COLUMN) {
    return layout;
  }
  const hidden = layout.hidden.includes(column) ? layout.hidden.filter((id) => id !== column) : [...layout.hidden, column];
  return { ...layout, hidden };
}

/** Sets the dragged width of `column`, not below the minimum; Note has none to set. */
export function setColumnWidth(layout: ColumnLayout, column: ColumnId, width: number): ColumnLayout {
  if (columnWidth(DEFAULT_COLUMN_LAYOUT, column) === undefined || !Number.isFinite(width)) {
    return layout;
  }
  return { ...layout, widths: { ...layout.widths, [column]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)) } };
}

/** The jobs table's column layout in the extension's `globalState`. */
export class ColumnLayoutStore {
  constructor(private readonly memento: Memento) {}

  get(): ColumnLayout {
    return normalizeLayout(this.memento.get(COLUMN_LAYOUT_STATE_KEY));
  }

  set(layout: ColumnLayout): Thenable<void> {
    return this.memento.update(COLUMN_LAYOUT_STATE_KEY, layout);
  }
}
