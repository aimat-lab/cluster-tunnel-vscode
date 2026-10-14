import * as assert from "assert";
import { test } from "node:test";
import { SetupInputs, setupChecks } from "../../setupChecks";

const WORKING: SetupInputs = {
  ctunPath: "ctun",
  refreshed: true,
  ctunError: undefined,
  clusterCount: 2,
  loginMethod: "vscode",
  wandb: { hasKey: true, entity: "" },
};

/** Each row as `label: health description`, children indented. */
function summary(inputs: SetupInputs): string[] {
  return setupChecks(inputs).flatMap((check) => [
    `${check.label}: ${check.health} ${check.description}`,
    ...(check.children ?? []).map((child) => `  ${child.label}: ${child.health} ${child.description}`),
  ]);
}

test("a working setup is all ok", () => {
  assert.deepStrictEqual(summary(WORKING), [
    "ctun: ok ctun",
    "Clusters: ok 2 configured",
    "Login: plain VS Code input boxes",
    "W&B: ok the key's own entity",
    "  API key: ok stored",
    "  Entity: plain the key's own",
    "  Tag runs in the training script: plain how to",
  ]);
});

test("a missing ctun is broken and its clusters wait for it", () => {
  const rows = summary({ ...WORKING, ctunError: { kind: "not_found", message: "ctun not found; set ctun.path" } });
  assert.deepStrictEqual(rows.slice(0, 2), ["ctun: broken not found at ctun", "Clusters: checking needs a working ctun"]);
});

test("an empty ctun config is broken", () => {
  assert.strictEqual(summary({ ...WORKING, clusterCount: 0 })[1], "Clusters: broken none in the ctun config");
});

test("W&B without a key is off, not broken", () => {
  const rows = summary({ ...WORKING, wandb: { hasKey: false, entity: "" } });
  assert.deepStrictEqual(rows.slice(3, 5), ["W&B: off off; set a key to show projects and runs", "  API key: off missing"]);
});

test("W&B with a team entity names it", () => {
  assert.strictEqual(summary({ ...WORKING, wandb: { hasKey: true, entity: "aimat" } })[3], "W&B: ok aimat");
});
