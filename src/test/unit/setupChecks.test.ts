import * as assert from "assert";
import { test } from "node:test";
import { SetupInputs, setupChecks } from "../../setupChecks";

const WORKING: SetupInputs = {
  ctunPath: "ctun",
  refreshed: true,
  ctunError: undefined,
  clusterCount: 2,
  loginMethod: "vscode",
  skill: { installed: true, skillDir: "home/.claude/skills/cluster-tunnel" },
  projects: { source: "record", addOn: undefined },
  addOnChecks: [{ label: "W&B", health: "off", description: "add-on off" }],
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
    "Claude skill: ok installed",
    "Projects: plain from ctun's --project",
    "W&B: off add-on off",
  ]);
});

test("a missing ctun is broken and its clusters wait for it", () => {
  const rows = summary({ ...WORKING, ctunError: { kind: "not_found", message: "ctun not found; set ctun.path" } });
  assert.deepStrictEqual(rows.slice(0, 2), ["ctun: broken not found at ctun", "Clusters: checking needs a working ctun"]);
});

test("an empty ctun config is broken", () => {
  assert.strictEqual(summary({ ...WORKING, clusterCount: 0 })[1], "Clusters: broken none in the ctun config");
});

test("a missing Claude skill is off, not broken, and offers the install", () => {
  const skill = setupChecks({ ...WORKING, skill: { installed: false, skillDir: "d" } })[3];
  assert.deepStrictEqual([skill.health, skill.description, skill.fix], ["off", "not installed", { kind: "command", command: "ctun.installSkill" }]);
});

test("projects from an add-on need that add-on on", () => {
  const projectsRow = (projects: SetupInputs["projects"]) => summary({ ...WORKING, projects })[4];
  assert.strictEqual(projectsRow({ source: "wandb", addOn: { label: "W&B", active: true } }), "Projects: ok from W&B");
  assert.strictEqual(projectsRow({ source: "wandb", addOn: { label: "W&B", active: false } }), "Projects: broken W&B add-on is off");
  assert.strictEqual(projectsRow({ source: "mlflow", addOn: undefined }), 'Projects: broken no add-on "mlflow"');
});
