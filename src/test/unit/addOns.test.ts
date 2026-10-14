import * as assert from "assert";
import { afterEach, test } from "node:test";
import { loadChanges, parseGitLog } from "../../codeChanges";
import { REVIEWS_STATE_KEY, ReviewMemento, reviewKey, ReviewStore } from "../../reviews";
import { FetchLike, trainingSummary, WandbClient } from "../../wandb";
import { record } from "../fixtures/ctunOutput";
import { fakeCtun } from "../fixtures/launchFakeCtun";

afterEach(() => {
  delete process.env.FAKE_CTUN;
});

class MemoryMemento implements ReviewMemento {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

test("reviews are stored under one key per Slurm cluster and job", async () => {
  const memento = new MemoryMemento();
  const store = new ReviewStore(memento);
  const key = reviewKey(record("101"), "haicore");
  assert.strictEqual(key, "haic/101");
  assert.strictEqual(reviewKey(record("5", { slurm_cluster: null }), "haicore"), "haicore/5");

  await store.set(key, "edited", "Better text.");
  await store.set("haic/102", "discarded");
  assert.deepStrictEqual(store.get(key)?.text, "Better text.");
  assert.strictEqual(store.get("haic/102")?.status, "discarded");
  assert.deepStrictEqual(Object.keys(memento.values.get(REVIEWS_STATE_KEY) as object), ["haic/101", "haic/102"]);
});

/** A W&B GraphQL endpoint that answers from fixtures and records the requests. */
function fakeWandb(runs: unknown[], viewerEntity = "example-user") {
  const requests: { query: string; variables: Record<string, unknown>; authorization: string }[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    requests.push({ query, variables, authorization: init.headers.Authorization });
    const data = query.includes("viewer")
      ? { viewer: { entity: viewerEntity } }
      : { project: { runs: { edges: runs.map((node) => ({ node })) } } };
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  return { fetchFn, requests };
}

const RESUMED_RUN = {
  name: "k3x9p2qa",
  displayName: "2026-10-12_1319_lr1e-3_k3x9p2qa",
  state: "running",
  summaryMetrics: JSON.stringify({ epoch: 31, "val/loss": 0.6912, "val/mae_T_trans": 38.27, "val/accuracy": 0.916 }),
};

test("finds a job's W&B run by its slurm tag and reads the chosen metrics", async () => {
  const { fetchFn, requests } = fakeWandb([RESUMED_RUN]);
  const client = new WandbClient("key123", fetchFn);
  const run = await client.runForJob("", "htfm_multihead", "4821937", ["val/loss", "val/mae_T_trans", "val/missing"]);
  assert.ok(run);
  assert.strictEqual(run.url, "https://wandb.ai/example-user/htfm_multihead/runs/k3x9p2qa");
  assert.strictEqual(trainingSummary(run), "epoch 31 · val/loss 0.691 · val/mae_T_trans 38.3");

  const runQuery = requests.find((request) => request.query.includes("RunByTag"))!;
  assert.deepStrictEqual(JSON.parse(runQuery.variables.filters as string), { tags: { $in: ["slurm:4821937"] } });
  assert.strictEqual(runQuery.variables.entity, "example-user");
  assert.strictEqual(runQuery.authorization, `Basic ${Buffer.from("api:key123").toString("base64")}`);
});

test("a job without a tagged run has no W&B run", async () => {
  const { fetchFn } = fakeWandb([]);
  assert.strictEqual(await new WandbClient("k", fetchFn).runForJob("team", "p", "1", []), undefined);
});

test("parses git log lines, keeping tabs inside the subject", () => {
  assert.deepStrictEqual(parseGitLog("a60bc60\tKeep one\n\n87d86d4\tFix\tpaths\n"), [
    { hash: "a60bc60", message: "Keep one" },
    { hash: "87d86d4", message: "Fix\tpaths" },
  ]);
});

test("loads the commits between two runs through ctun run", async () => {
  const changes = await loadChanges(fakeCtun("git-log"), "haicore", "/work/repo", "a60bc60", "87d86d4");
  assert.deepStrictEqual(changes, {
    state: "loaded",
    commits: [
      { hash: "a60bc60", message: "Keep one MAGNDATA entry per formula" },
      { hash: "87d86d4", message: "Fix leftover paths\tafter the refactoring" },
    ],
  });
});

test("a failing git log becomes an error state", async () => {
  const changes = await loadChanges(fakeCtun("exit:128"), "haicore", "/work/repo", "a", "b");
  assert.strictEqual(changes.state, "error");
});

test("a key W&B rejects fails with a plain message", async () => {
  const fetchFn: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(new WandbClient("wrong", fetchFn).ownEntity(), /W&B rejected the API key/);
});

test("a key W&B accepts names its entity", async () => {
  const { fetchFn } = fakeWandb([], "luca");
  assert.strictEqual(await new WandbClient("right", fetchFn).ownEntity(), "luca");
});
