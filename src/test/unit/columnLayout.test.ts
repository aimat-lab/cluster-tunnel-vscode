import * as assert from "assert";
import { test } from "node:test";
import {
  DEFAULT_COLUMN_LAYOUT,
  MIN_COLUMN_WIDTH,
  moveColumn,
  normalizeLayout,
  setColumnWidth,
  shownColumns,
  toggleColumn,
} from "../../columnLayout";

test("a stored layout keeps known columns once, ID first and shown, and widths not below the minimum", () => {
  const layout = normalizeLayout({
    order: ["state", "gone", "id", "state", "note"],
    hidden: ["id", "partition", "gone"],
    widths: { state: 20, note: 300, name: "wide", start: 151.6 },
  });
  assert.deepStrictEqual(layout.order, ["id", "state", "note", "name", "start", "elapsed", "partition"]);
  assert.deepStrictEqual(layout.hidden, ["partition"]);
  assert.deepStrictEqual(layout.widths, { state: MIN_COLUMN_WIDTH, start: 152 });
  assert.deepStrictEqual(normalizeLayout(undefined), DEFAULT_COLUMN_LAYOUT);
});

test("a moved column lands after a target to its right and before one to its left; ID stays first", () => {
  const order = (layout: { order: string[] }) => layout.order.join(" ");
  assert.strictEqual(order(moveColumn(DEFAULT_COLUMN_LAYOUT, "name", "state")), "id note state name start elapsed partition");
  assert.strictEqual(order(moveColumn(DEFAULT_COLUMN_LAYOUT, "partition", "name")), "id partition name note state start elapsed");
  assert.strictEqual(moveColumn(DEFAULT_COLUMN_LAYOUT, "name", "id"), DEFAULT_COLUMN_LAYOUT);
});

test("a column hides and shows again, but ID never hides and Note takes no width", () => {
  const hidden = toggleColumn(DEFAULT_COLUMN_LAYOUT, "note");
  assert.deepStrictEqual(shownColumns(hidden).map((column) => column.id), ["id", "name", "state", "start", "elapsed", "partition"]);
  assert.deepStrictEqual(toggleColumn(hidden, "note").hidden, []);
  assert.strictEqual(toggleColumn(DEFAULT_COLUMN_LAYOUT, "id"), DEFAULT_COLUMN_LAYOUT);
  assert.strictEqual(setColumnWidth(DEFAULT_COLUMN_LAYOUT, "note", 400), DEFAULT_COLUMN_LAYOUT);
  assert.deepStrictEqual(setColumnWidth(DEFAULT_COLUMN_LAYOUT, "state", 10).widths, { state: MIN_COLUMN_WIDTH });
});
