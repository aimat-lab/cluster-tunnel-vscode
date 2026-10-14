import * as assert from "assert";
import { test } from "node:test";
import type { JobRef } from "../../addOns";
import { FetchLike, TaggedRun, WandbClient } from "../../addons/wandb/client";
import { wandbSetupCheck } from "../../addons/wandb/setup";
import { jobTags, projectsByJob, runForJob, trainingSummary } from "../../addons/wandb/tags";

/** A W&B GraphQL endpoint with two projects that answers from fixtures and records the requests. */
function fakeWandb(runsByProject: Record<string, unknown[]>) {
  const requests: { query: string; variables: Record<string, unknown>; authorization: string }[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    requests.push({ query, variables, authorization: init.headers.Authorization });
    const projectNames = Object.keys(runsByProject);
    let data: unknown;
    if (query.includes("viewer")) {
      data = { viewer: { entity: "example-user" } };
    } else if (query.includes("EntityProjects")) {
      data = { entity: { projects: { edges: projectNames.map((name) => ({ node: { name } })) } } };
    } else {
      const runs = projectNames.map((name, index) => [`project${index}`, { runs: { edges: runsByProject[name].map((node) => ({ node })) } }]);
      data = Object.fromEntries(runs);
    }
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  return { fetchFn, requests };
}

const RESUMED_RUN = {
  name: "k3x9p2qa",
  displayName: "2026-10-12_1319_lr1e-3_k3x9p2qa",
  state: "running",
  tags: ["slurm:4821937", "slurm:haic:4821990", "baseline"],
  summaryMetrics: JSON.stringify({ epoch: 31, "val/loss": 0.6912, "val/mae_T_trans": 38.27, "val/accuracy": 0.916 }),
};

function job(jobId: string, slurmCluster: string | null = "haic", cluster = "haicore"): JobRef {
  return { key: `${cluster}/${jobId}`, cluster, slurmCluster, jobId, name: "train", state: "RUNNING", record: null };
}

function run(project: string, tags: string[]): TaggedRun {
  return { project, name: "r", displayName: "r", state: "running", tags, url: "", summary: {} };
}

test("searches every project of the entity for tagged runs in one request", async () => {
  const { fetchFn, requests } = fakeWandb({ htfm_multihead: [RESUMED_RUN], sweeps: [] });
  const runs = await new WandbClient("key123", fetchFn).taggedRuns("", ["slurm:haic:4821990", "slurm:4821990"], true);

  assert.deepStrictEqual(runs.map((found) => [found.project, found.name]), [["htfm_multihead", "k3x9p2qa"]]);
  assert.strictEqual(runs[0].url, "https://wandb.ai/example-user/htfm_multihead/runs/k3x9p2qa");
  assert.strictEqual(runs[0].summary.epoch, 31);

  const runsQuery = requests.at(-1)!;
  assert.strictEqual(requests.length, 3); // the key's own entity, its projects, the runs
  assert.match(runsQuery.query, /project1: project\(name: \$project1, entityName: \$entity\)/);
  assert.match(runsQuery.query, /summaryMetrics/);
  assert.deepStrictEqual(JSON.parse(runsQuery.variables.filters as string), {
    tags: { $in: ["slurm:haic:4821990", "slurm:4821990"] },
  });
  assert.deepStrictEqual([runsQuery.variables.project0, runsQuery.variables.project1], ["htfm_multihead", "sweeps"]);
  assert.strictEqual(runsQuery.authorization, `Basic ${Buffer.from("api:key123").toString("base64")}`);
});

test("asks for summaries only when told to, and nothing without tags", async () => {
  const { fetchFn, requests } = fakeWandb({ p: [] });
  const client = new WandbClient("k", fetchFn);
  await client.taggedRuns("team", ["slurm:1"], false);
  assert.doesNotMatch(requests.at(-1)!.query, /summaryMetrics/);
  assert.deepStrictEqual(await client.taggedRuns("team", [], true), []);
  assert.strictEqual(requests.length, 2);
});

test("a key W&B rejects fails with a plain message", async () => {
  const fetchFn: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(new WandbClient("wrong", fetchFn).ownEntity(), /W&B rejected the API key/);
});

test("a key W&B accepts names its entity", async () => {
  const { fetchFn } = fakeWandb({});
  assert.strictEqual(await new WandbClient("right", fetchFn).ownEntity(), "example-user");
});

test("a job's tags name its Slurm cluster first, then the bare job ID", () => {
  assert.deepStrictEqual(jobTags(job("7")), ["slurm:haic:7", "slurm:7"]);
  assert.deepStrictEqual(jobTags(job("7", null)), ["slurm:7"]);
});

test("the run with the cluster tag wins over one with the bare tag", () => {
  const bare = run("old", ["slurm:7"]);
  const qualified = run("new", ["slurm:haic:7"]);
  assert.strictEqual(runForJob(job("7"), [bare, qualified]), qualified);
  assert.strictEqual(runForJob(job("7"), [bare]), bare);
  assert.strictEqual(runForJob(job("7", "horeka"), [qualified]), undefined);
});

test("maps each job with a tagged run to the run's project, by row key", () => {
  const jobs = [job("7"), job("7", "hk", "horeka"), job("8")];
  const runs = [run("htfm", ["slurm:haic:7"]), run("sweeps", ["slurm:hk:7"])];
  assert.deepStrictEqual([...projectsByJob(jobs, runs)], [["haicore/7", "htfm"], ["horeka/7", "sweeps"]]);
});

test("summarizes the epoch and the chosen metrics", () => {
  const summary = { epoch: 31, "val/loss": 0.6912, "val/mae_T_trans": 38.27, "val/accuracy": 0.916 };
  const metrics = ["val/loss", "val/mae_T_trans", "val/missing"];
  assert.strictEqual(trainingSummary({ state: "running", summary }, metrics), "epoch 31 · val/loss 0.691 · val/mae_T_trans 38.3");
  assert.strictEqual(trainingSummary({ state: "running", summary: {} }, metrics), "running, no metrics yet");
});

test("the W&B Setup row is one grey row while off, then the key, entity and guide", () => {
  const off = wandbSetupCheck({ enabled: false, hasKey: true, entity: "" });
  assert.deepStrictEqual([off.health, off.description, off.children], ["off", "add-on off", undefined]);
  assert.deepStrictEqual(off.fix, { kind: "command", command: "ctun.addons.wandb.enable" });

  const noKey = wandbSetupCheck({ enabled: true, hasKey: false, entity: "" });
  assert.deepStrictEqual([noKey.health, noKey.description], ["broken", "API key missing"]);

  const ready = wandbSetupCheck({ enabled: true, hasKey: true, entity: "aimat" });
  assert.deepStrictEqual([ready.health, ready.description], ["ok", "aimat"]);
  assert.deepStrictEqual(ready.children?.map((child) => child.label), ["API key", "Entity", "Tag runs in the training script"]);
});
