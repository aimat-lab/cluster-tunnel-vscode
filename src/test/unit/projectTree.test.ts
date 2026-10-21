import * as assert from "assert";
import { test } from "node:test";
import {
  droppedProject,
  hiddenAfterShowing,
  hiddenToShowOnly,
  isHiddenBy,
  withoutNested,
  leafName,
  nestingDepth,
  normalizeProject,
  parentProject,
  renamedProject,
  selfAndAncestors,
  totalsWithNested,
  treeOrder,
  withRenamed,
} from "../../projectTree";

test("a `/` in a project name nests it", () => {
  assert.strictEqual(normalizeProject("/htfm//multihead/"), "htfm/multihead");
  assert.strictEqual(normalizeProject("/"), "");
  assert.strictEqual(leafName("htfm/multihead"), "multihead");
  assert.strictEqual(nestingDepth("htfm/multihead"), 1);
  assert.strictEqual(parentProject("htfm/multihead"), "htfm");
  assert.strictEqual(parentProject("htfm"), undefined);
  assert.deepStrictEqual(selfAndAncestors("a/b/c"), ["a", "a/b", "a/b/c"]);
});

test("totals count the jobs of nested projects in every project above", () => {
  const totals = totalsWithNested(new Map([["a", 1], ["a/b", 2], ["a/b/c", 3], ["d", 4]]));
  assert.deepStrictEqual([...totals], [["a", 6], ["a/b", 5], ["a/b/c", 3], ["d", 4]]);
});

test("tree order puts parents before children, siblings by name, and the last one at the end", () => {
  assert.deepStrictEqual(treeOrder(["b", "unassigned", "a/z", "a", "a/b", "a-b"], "unassigned"), ["a", "a/b", "a/z", "a-b", "b", "unassigned"]);
});

test("a project is hidden when it or a project above it is", () => {
  const hidden = new Set(["htfm"]);
  assert.ok(isHiddenBy("htfm/eval/old", hidden));
  assert.ok(isHiddenBy("htfm", hidden));
  assert.ok(!isHiddenBy("htfm2", hidden)); // a name prefix is no parent
});

test("showing only a project hides what lies beside it and above it, not below it", () => {
  const known = ["htfm", "htfm/eval", "htfm/eval/old", "htfm/train", "legacy", "unassigned"];
  assert.deepStrictEqual([...hiddenToShowOnly("htfm/eval", known)].sort(), ["htfm/train", "legacy", "unassigned"]);
  assert.deepStrictEqual([...hiddenToShowOnly("legacy", known)].sort(), ["htfm", "unassigned"]);
});

test("showing a project below a hidden one keeps the rest of that project hidden", () => {
  const known = ["htfm", "htfm/eval", "htfm/eval/old", "htfm/eval/new", "htfm/train", "legacy"];
  assert.deepStrictEqual([...hiddenAfterShowing("htfm/eval/old", new Set(["htfm", "legacy"]), known)].sort(), [
    "htfm/eval/new",
    "htfm/train",
    "legacy",
  ]);
  assert.deepStrictEqual([...hiddenAfterShowing("legacy", new Set(["htfm", "legacy"]), known)], ["htfm"]);
});

test("removing a project removes the projects nested in it, not its siblings", () => {
  const drafts = ["htfm", "htfm/mh", "htfm/mh/lr", "htfmx", "sweeps"];
  assert.deepStrictEqual([...withoutNested(drafts, "htfm/mh")], ["htfm", "htfmx", "sweeps"]);
});

test("renaming a project renames the projects nested in it, not its siblings", () => {
  assert.strictEqual(renamedProject("htfm/mh", "htfm", "archive/htfm"), "archive/htfm/mh");
  assert.strictEqual(renamedProject("htfm", "htfm", "archive/htfm"), "archive/htfm");
  assert.strictEqual(renamedProject("htfmx", "htfm", "archive/htfm"), undefined);
  assert.deepStrictEqual([...withRenamed(["htfm", "htfm/mh", "sweeps"], "htfm", "eval")], ["eval", "eval/mh", "sweeps"]);
});

test("a dropped project keeps its own name below the target", () => {
  assert.strictEqual(droppedProject("htfm/mh", "eval"), "eval/mh");
  assert.strictEqual(droppedProject("htfm/mh", undefined), "mh");
  assert.strictEqual(droppedProject("htfm/mh", "htfm"), undefined); // already there
  assert.strictEqual(droppedProject("htfm", "htfm/mh"), undefined); // into itself
  assert.strictEqual(droppedProject("htfm", "htfm"), undefined);
  assert.strictEqual(droppedProject("htfm", "htfmx"), "htfmx/htfm");
});
