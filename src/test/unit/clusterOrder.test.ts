import * as assert from "assert";
import { test } from "node:test";
import { inOrder, movedBefore } from "../../clusterOrder";

test("sorts clusters by the stored order; new ones follow in ctun's order", () => {
  assert.deepStrictEqual(inOrder(["haicore", "kcist", "horeka", "bwuni3"], ["kcist", "haicore"]), [
    "kcist",
    "haicore",
    "horeka",
    "bwuni3",
  ]);
});

test("ignores stored clusters that are gone from the config", () => {
  assert.deepStrictEqual(inOrder(["haicore", "kcist"], ["horeka", "kcist"]), ["kcist", "haicore"]);
});

test("moves a cluster before another, or to the end", () => {
  const clusters = ["haicore", "kcist", "horeka"];
  assert.deepStrictEqual(movedBefore(clusters, "horeka", "haicore"), ["horeka", "haicore", "kcist"]);
  assert.deepStrictEqual(movedBefore(clusters, "haicore", "horeka"), ["kcist", "haicore", "horeka"]);
  assert.deepStrictEqual(movedBefore(clusters, "haicore", undefined), ["kcist", "horeka", "haicore"]);
});
